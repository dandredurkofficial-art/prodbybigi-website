const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

// ✅ Safe fetch: Node 20 has global fetch, fallback to node-fetch if needed
const fetchFn = global.fetch
  ? global.fetch
  : (...args) =>
      import("node-fetch").then(({ default: fetch }) => fetch(...args));

// ✅ ADD: Firebase Storage
const { getStorage } = require("firebase-admin/storage");

// ✅ ADD: Firestore triggers (for emails)
const {
  onDocumentCreated,
  onDocumentUpdated,
} = require("firebase-functions/v2/firestore");

// ✅ ADD: SendGrid
const sgMail = require("@sendgrid/mail");

admin.initializeApp();

const db = admin.firestore();
const bucket = getStorage().bucket(); // ✅ ADD

// Secrets (names only!)
const DARAJA_CONSUMER_KEY = defineSecret("DARAJA_CONSUMER_KEY");
const DARAJA_CONSUMER_SECRET = defineSecret("DARAJA_CONSUMER_SECRET");
const MPESA_SHORTCODE = defineSecret("MPESA_SHORTCODE");
const MPESA_PASSKEY = defineSecret("MPESA_PASSKEY");
const MPESA_CALLBACK_URL = defineSecret("MPESA_CALLBACK_URL");

// ✅ ADD: SendGrid secrets
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const SENDGRID_FROM = defineSecret("SENDGRID_FROM");
const ADMIN_NOTIFY_EMAIL = defineSecret("ADMIN_NOTIFY_EMAIL");

// ✅ ADD: PayPal secrets
const PAYPAL_CLIENT_ID = defineSecret("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = defineSecret("PAYPAL_CLIENT_SECRET");
// Your PayPal Webhook ID (from PayPal dashboard for that webhook endpoint)
const PAYPAL_WEBHOOK_ID = defineSecret("PAYPAL_WEBHOOK_ID");
// optional: "live" or "sandbox" (default sandbox if missing)
const PAYPAL_MODE = defineSecret("PAYPAL_MODE");

// Daraja endpoints (Sandbox)
const OAUTH_URL =
  "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
const STK_PUSH_URL =
  "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

function nowTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

async function getAccessToken(consumerKey, consumerSecret) {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const res = await fetchFn(OAUTH_URL, {
    method: "GET",
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OAuth failed: ${res.status} ${txt}`);
  }

  const data = await res.json();
  return data.access_token;
}

/* =========================================================
✅ SENDGRID EMAIL HELPERS
========================================================= */
let SENDGRID_READY = false;

function initSendgrid() {
  if (SENDGRID_READY) return;
  const key = SENDGRID_API_KEY.value();
  if (!key) throw new Error("Missing SENDGRID_API_KEY secret");
  sgMail.setApiKey(key);
  SENDGRID_READY = true;
}

async function sendEmail({ to, subject, text, html }) {
  initSendgrid();
  const from = SENDGRID_FROM.value();
  if (!from) throw new Error("Missing SENDGRID_FROM secret");

  await sgMail.send({
    to,
    from,
    subject,
    text: text || "",
    html: html || "",
  });
}

function safeStr(v) {
  return v === null || v === undefined ? "" : String(v);
}

function isProducerProfile(userData) {
  const role = safeStr(userData?.role || userData?.userType).toLowerCase().trim();
  return role === "producer";
}

function money(n) {
  const v = Number(n || 0);
  if (!isFinite(v)) return "$0.00";
  return "$" + v.toFixed(2);
}

/* =========================================================
✅ PAYPAL HELPERS (NEW)
========================================================= */
function paypalBaseUrl() {
  const mode = safeStr(PAYPAL_MODE.value() || "sandbox").toLowerCase().trim();
  return mode === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken() {
  const cid = PAYPAL_CLIENT_ID.value();
  const cs = PAYPAL_CLIENT_SECRET.value();
  if (!cid || !cs) throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET secret");

  const auth = Buffer.from(`${cid}:${cs}`).toString("base64");
  const res = await fetchFn(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PayPal OAuth failed: ${res.status} ${txt}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function verifyPayPalWebhookSignature(req) {
  // PayPal sends these headers:
  // PAYPAL-TRANSMISSION-ID, PAYPAL-TRANSMISSION-TIME, PAYPAL-TRANSMISSION-SIG,
  // PAYPAL-CERT-URL, PAYPAL-AUTH-ALGO
  const transmissionId =
    req.header("paypal-transmission-id") || req.header("PAYPAL-TRANSMISSION-ID");
  const transmissionTime =
    req.header("paypal-transmission-time") || req.header("PAYPAL-TRANSMISSION-TIME");
  const transmissionSig =
    req.header("paypal-transmission-sig") || req.header("PAYPAL-TRANSMISSION-SIG");
  const certUrl = req.header("paypal-cert-url") || req.header("PAYPAL-CERT-URL");
  const authAlgo = req.header("paypal-auth-algo") || req.header("PAYPAL-AUTH-ALGO");

  const webhookId = PAYPAL_WEBHOOK_ID.value();
  if (!webhookId) throw new Error("Missing PAYPAL_WEBHOOK_ID secret");
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    throw new Error("Missing PayPal signature headers");
  }

  // In Cloud Functions, req.body is already parsed (object). PayPal expects the original body JSON.
  // We'll send the parsed object as `webhook_event`, which PayPal API accepts.
  const accessToken = await getPayPalAccessToken();

  const payload = {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: webhookId,
    webhook_event: req.body,
  };

  const res = await fetchFn(`${paypalBaseUrl()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PayPal verify failed: ${res.status} ${txt}`);
  }

  const data = await res.json();
  return safeStr(data.verification_status).toUpperCase() === "SUCCESS";
}

function parseAmountFromPayPalEvent(event) {
  // Best-effort: handle PAYMENT.CAPTURE.COMPLETED primarily
  const resource = event?.resource || {};
  // capture
  const amt = resource?.amount?.value;
  const cur = resource?.amount?.currency_code;
  if (amt && cur) return { value: Number(amt), currency: String(cur) };
  // checkout order (approved) doesn't guarantee captured amount yet
  const pu = resource?.purchase_units?.[0];
  const orderAmt = pu?.amount?.value;
  const orderCur = pu?.amount?.currency_code;
  if (orderAmt && orderCur) return { value: Number(orderAmt), currency: String(orderCur) };
  return { value: 0, currency: "USD" };
}

async function creditProducerWallet({ producerId, orderId, grossAmount, currency, source }) {
  // 10% platform fee, 90% producer
  const gross = Number(grossAmount || 0);
  const fee = Math.round(gross * 0.10 * 100) / 100;
  const net = Math.round((gross - fee) * 100) / 100;

  // atomic: increment producer wallet and store platform earnings
  const producerRef = db.collection("users").doc(producerId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(producerRef);
    if (!snap.exists) throw new Error("Producer profile missing");

    tx.set(
      producerRef,
      {
        availableBalance: admin.firestore.FieldValue.increment(net),
        walletUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // platform revenue log (optional but useful)
    const revRef = db.collection("platformRevenue").doc(orderId);
    tx.set(
      revRef,
      {
        orderId,
        producerId,
        gross,
        fee,
        net,
        currency: currency || "USD",
        source: source || "paypal",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return { gross, fee, net };
}

/**
 * ✅ NEW: POST /paypalWebhook
 * PayPal will call this. We verify signature and then:
 * - create/update order in Firestore
 * - create unlock if it is a beat purchase
 * - credit producer wallet (net after 10% fee)
 *
 * IMPORTANT: You should include metadata in your PayPal Checkout order:
 * - beatId
 * - producerId
 * - buyerEmail/uid/phone (optional)
 */
exports.paypalWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_MODE],
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).send("Use POST");

      // 1) Verify signature (very important)
      const ok = await verifyPayPalWebhookSignature(req);
      if (!ok) return res.status(401).send("Invalid signature");

      const event = req.body || {};
      const eventType = safeStr(event.event_type).trim();
      const resource = event.resource || {};
      const resourceId = safeStr(resource.id || event.id);

      // Store raw webhook for audit (idempotent)
      await db
        .collection("paypalWebhooks")
        .doc(safeStr(event.id || resourceId || String(Date.now())))
        .set(
          {
            eventType,
            resourceId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            raw: event,
          },
          { merge: true }
        );

      // We mainly act on CAPTURE COMPLETED (money actually received)
      if (eventType !== "PAYMENT.CAPTURE.COMPLETED") {
        return res.status(200).json({ received: true, ignored: eventType });
      }

      const { value, currency } = parseAmountFromPayPalEvent(event);

      // Pull custom metadata if you included it
      // You can attach metadata via:
      // purchase_units[0].custom_id or invoice_id
      // or resource.supplementary_data / payee / etc
      const customId =
        safeStr(resource?.custom_id) ||
        safeStr(resource?.invoice_id) ||
        safeStr(resource?.supplementary_data?.related_ids?.order_id) ||
        "";

      // We’ll try to read beatId + producerId from customId if you format it like:
      // "beatId=XYZ|producerId=ABC|buyer=..."
      const meta = {};
      if (customId) {
        customId.split("|").forEach((part) => {
          const [k, ...rest] = part.split("=");
          const key = safeStr(k).trim();
          const val = safeStr(rest.join("=")).trim();
          if (key) meta[key] = val;
        });
      }

      const beatId = safeStr(meta.beatId || meta.beat || "");
      let producerId = safeStr(meta.producerId || meta.producer || "");

      // If producerId not provided, read from beat doc
      if (beatId && !producerId) {
        const beatSnap = await db.collection("beats").doc(beatId).get();
        if (beatSnap.exists) producerId = safeStr(beatSnap.data()?.producerId || "");
      }

      // Create order doc (idempotent using capture id)
      const orderId = `pp_${safeStr(resource.id || event.id || Date.now())}`;
      const orderRef = db.collection("orders").doc(orderId);

      const existing = await orderRef.get();
      if (!existing.exists) {
        await orderRef.set({
          orderId,
          provider: "paypal",
          providerEventId: safeStr(event.id),
          providerCaptureId: safeStr(resource.id),
          providerStatus: safeStr(resource.status),
          beatId: beatId || null,
          producerId: producerId || null,
          amount: Number(value || 0),
          currency: currency || "USD",
          status: "PAID",
          payerEmail: safeStr(resource?.payer?.email_address),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          raw: event,
        });
      } else {
        await orderRef.set(
          {
            providerStatus: safeStr(resource.status),
            status: "PAID",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      // If it's a beat purchase, unlock + credit producer wallet
      if (beatId && producerId) {
        // 1) create unlock (idempotent)
        await db.collection("unlocks").doc(orderId).set(
          {
            orderId,
            beatId,
            phone: null,
            amount: Number(value || 0),
            receipt: safeStr(resource.id),
            transactionDate: Date.now(),
            checkoutRequestId: null,
            provider: "paypal",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        // 2) credit wallet once (idempotent) by checking a marker
        const creditedRef = db.collection("orders").doc(orderId);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(creditedRef);
          const d = snap.data() || {};
          if (d.walletCredited === true) return;

          tx.set(
            creditedRef,
            {
              walletCredited: true,
              walletCreditedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        });

        // after marker set, credit (safe if repeated: our transaction prevents repeats)
        await creditProducerWallet({
          producerId,
          orderId,
          grossAmount: Number(value || 0),
          currency,
          source: "paypal",
        });
      }

      return res.status(200).json({ received: true, eventType });
    } catch (e) {
      console.error("paypalWebhook error:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

/**
 * ✅ NEW: PRODUCER WITHDRAW (PAYPAL)
 * Producers create a doc in /payouts with method=paypal, amount, destination(email)
 * This trigger will:
 * - validate balance
 * - create PayPal payout
 * - decrement producer wallet
 * - update payout status
 */
exports.onPaypalPayoutRequest = onDocumentCreated(
  {
    region: "us-central1",
    document: "payouts/{payoutId}",
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE],
  },
  async (event) => {
    try {
      const payoutId = event.params.payoutId;
      const data = event.data?.data() || {};

      const method = safeStr(data.method || data.withdrawMethod || "").toLowerCase().trim();
      if (method !== "paypal") return; // ignore mpesa or others

      const producerId = safeStr(data.producerId);
      const destination = safeStr(data.destination || data.email || data.paypalEmail).trim();
      const amount = Number(data.amount || 0);

      if (!producerId || !destination || !amount || amount <= 0) {
        await db.collection("payouts").doc(payoutId).set(
          {
            status: "FAILED",
            error: "Missing producerId/destination/amount",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return;
      }

      const producerRef = db.collection("users").doc(producerId);
      const payoutRef = db.collection("payouts").doc(payoutId);

      // 1) lock + check balance + decrement
      let newBalance = 0;
      await db.runTransaction(async (tx) => {
        const pSnap = await tx.get(producerRef);
        if (!pSnap.exists) throw new Error("Producer profile missing");
        const prof = pSnap.data() || {};
        const bal = Number(
          prof.availableBalance ?? prof.walletBalance ?? prof.balance ?? prof.wallet ?? 0
        );
        if (!isFinite(bal) || bal < amount) throw new Error("Insufficient balance");

        newBalance = Math.round((bal - amount) * 100) / 100;

        // mark payout processing
        tx.set(
          payoutRef,
          {
            status: "PROCESSING",
            provider: "paypal",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        // decrement balance
        tx.set(
          producerRef,
          {
            availableBalance: admin.firestore.FieldValue.increment(-amount),
            walletUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      // 2) create PayPal payout
      const accessToken = await getPayPalAccessToken();

      const payoutPayload = {
        sender_batch_header: {
          sender_batch_id: `audiory_${payoutId}_${Date.now()}`,
          email_subject: "You have a payout from Audiory",
          email_message:
            "Your Audiory payout has been sent. Thank you for using Audiory!",
        },
        items: [
          {
            recipient_type: "EMAIL",
            amount: {
              value: amount.toFixed(2),
              currency: "USD",
            },
            receiver: destination,
            note: "Audiory producer withdrawal",
            sender_item_id: payoutId,
          },
        ],
      };

      const r = await fetchFn(`${paypalBaseUrl()}/v1/payments/payouts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payoutPayload),
      });

      const respText = await r.text();
      let respJson = {};
      try {
        respJson = JSON.parse(respText);
      } catch (e) {
        respJson = { raw: respText };
      }

      if (!r.ok) {
        // rollback wallet if PayPal failed
        await db.runTransaction(async (tx) => {
          tx.set(
            producerRef,
            { availableBalance: admin.firestore.FieldValue.increment(amount) },
            { merge: true }
          );
          tx.set(
            payoutRef,
            {
              status: "FAILED",
              error: `PayPal payout failed: ${r.status} ${safeStr(respText)}`.slice(0, 1000),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        });
        return;
      }

      // Mark payout submitted
      await payoutRef.set(
        {
          status: "SUBMITTED",
          paypalBatchId: safeStr(respJson?.batch_header?.payout_batch_id),
          paypalResponse: respJson,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          balanceAfter: newBalance,
        },
        { merge: true }
      );
    } catch (e) {
      console.error("onPaypalPayoutRequest error:", e);
      const payoutId = event.params.payoutId;
      try {
        await db.collection("payouts").doc(payoutId).set(
          {
            status: "FAILED",
            error: safeStr(e.message || e).slice(0, 1000),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } catch (_) {}
    }
  }
);

/**
 * ✅ OPTIONAL: Admin can check payout batch status (manual)
 * GET /paypalPayoutStatus?payoutBatchId=XXXX
 */
exports.paypalPayoutStatus = onRequest(
  {
    region: "us-central1",
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE],
  },
  async (req, res) => {
    try {
      const payoutBatchId = safeStr(req.query?.payoutBatchId).trim();
      if (!payoutBatchId) return res.status(400).json({ error: "payoutBatchId is required" });

      const accessToken = await getPayPalAccessToken();
      const r = await fetchFn(`${paypalBaseUrl()}/v1/payments/payouts/${payoutBatchId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const txt = await r.text();
      let j = {};
      try {
        j = JSON.parse(txt);
      } catch (e) {
        j = { raw: txt };
      }

      return res.status(r.ok ? 200 : 400).json(j);
    } catch (e) {
      console.error("paypalPayoutStatus error:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

/**
 * POST /stkpush
 * body: { phone: "2547XXXXXXXX", amount: 10, beatId: "BEAT_123" }
 */
exports.stkpush = onRequest(
  {
    region: "us-central1",
    secrets: [
      DARAJA_CONSUMER_KEY,
      DARAJA_CONSUMER_SECRET,
      MPESA_SHORTCODE,
      MPESA_PASSKEY,
      MPESA_CALLBACK_URL,
    ],
  },
  async (req, res) => {
    try {
      if (req.method !== "POST")
        return res.status(405).json({ error: "Use POST" });

      const { phone, amount, beatId } = req.body || {};
      if (!phone || !amount || !beatId) {
        return res
          .status(400)
          .json({ error: "phone, amount, and beatId are required" });
      }

      // 1) Create an order in Firestore (PENDING)
      const orderRef = db.collection("orders").doc();
      await orderRef.set({
        beatId,
        phone,
        amount: Number(amount),
        status: "PENDING",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const timestamp = nowTimestamp();
      const password = Buffer.from(
        `${MPESA_SHORTCODE.value()}${MPESA_PASSKEY.value()}${timestamp}`
      ).toString("base64");

      const token = await getAccessToken(
        DARAJA_CONSUMER_KEY.value(),
        DARAJA_CONSUMER_SECRET.value()
      );

      const payload = {
        BusinessShortCode: Number(MPESA_SHORTCODE.value()),
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: Number(amount),
        PartyA: phone,
        PartyB: Number(MPESA_SHORTCODE.value()),
        PhoneNumber: phone,
        CallBackURL: MPESA_CALLBACK_URL.value(),
        AccountReference: orderRef.id,
        TransactionDesc: `Beat ${beatId}`,
      };

      const r = await fetchFn(STK_PUSH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await r.json();

      await orderRef.set(
        {
          checkoutRequestId: data.CheckoutRequestID || null,
          merchantRequestId: data.MerchantRequestID || null,
          stkResponse: data,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return res.status(r.ok ? 200 : 400).json({
        orderId: orderRef.id,
        ...data,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }
);

// Callback endpoint
exports.stkCallback = onRequest({ region: "us-central1" }, async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) return res.json({ ResultCode: 0 });

    const {
      CheckoutRequestID,
      MerchantRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata,
    } = callback;

    const metadata = {};
    CallbackMetadata?.Item?.forEach((item) => {
      metadata[item.Name] = item.Value ?? null;
    });

    await db.collection("mpesaPayments").doc(CheckoutRequestID).set({
      checkoutRequestId: CheckoutRequestID,
      merchantRequestId: MerchantRequestID || null,
      resultCode: ResultCode,
      resultDesc: ResultDesc,
      amount: metadata.Amount || null,
      phone: metadata.PhoneNumber || null,
      receipt: metadata.MpesaReceiptNumber || null,
      transactionDate: metadata.TransactionDate || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      raw: callback,
    });

    const orderSnap = await db
      .collection("orders")
      .where("checkoutRequestId", "==", CheckoutRequestID)
      .limit(1)
      .get();

    if (!orderSnap.empty) {
      const orderDoc = orderSnap.docs[0];
      const paid = Number(ResultCode) === 0;

      await orderDoc.ref.set(
        {
          status: paid ? "PAID" : "FAILED",
          receipt: metadata.MpesaReceiptNumber || null,
          transactionDate: metadata.TransactionDate || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      if (paid) {
        await db.collection("unlocks").doc(orderDoc.id).set({
          orderId: orderDoc.id,
          beatId: orderDoc.data().beatId,
          phone: metadata.PhoneNumber || null,
          amount: metadata.Amount || null,
          receipt: metadata.MpesaReceiptNumber || null,
          transactionDate: metadata.TransactionDate || null,
          checkoutRequestId: CheckoutRequestID,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error(err);
    return res.json({ ResultCode: 0 });
  }
});

/**
 * 🔐 POST /secureDownload
 * body: { beatId: "BEAT_123", phone?: "2547..." }
 */
exports.secureDownload = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Use POST" });
      }

      const { beatId, phone } = req.body || {};
      if (!beatId) {
        return res.status(400).json({ error: "beatId is required" });
      }

      const unlockSnap = await db
        .collection("unlocks")
        .where("beatId", "==", beatId)
        .limit(1)
        .get();

      if (unlockSnap.empty) {
        return res.status(403).json({ error: "Beat not unlocked" });
      }

      if (phone) {
        const unlock = unlockSnap.docs[0].data();
        if (unlock.phone && unlock.phone !== phone) {
          return res.status(403).json({ error: "Unauthorized phone" });
        }
      }

      const beatDoc = await db.collection("beats").doc(beatId).get();
      if (!beatDoc.exists) {
        return res.status(404).json({ error: "Beat not found" });
      }

      const { filePath } = beatDoc.data();
      if (!filePath) {
        return res.status(500).json({ error: "File path missing" });
      }

      const [url] = await bucket.file(filePath).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 10 * 60 * 1000,
      });

      return res.json({ url });
    } catch (err) {
      console.error("secureDownload error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  }
);

/**
 * 🔐 POST /licenseDownload
 * body: { beatId: "BEAT_123", phone?: "2547..." }
 */
exports.licenseDownload = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Use POST" });
      }

      const { beatId, phone } = req.body || {};
      if (!beatId) {
        return res.status(400).json({ error: "beatId is required" });
      }

      // 1) Check unlock
      const unlockSnap = await db
        .collection("unlocks")
        .where("beatId", "==", beatId)
        .limit(1)
        .get();

      if (unlockSnap.empty) {
        return res.status(403).json({ error: "Beat not unlocked" });
      }

      // Optional phone check
      if (phone) {
        const unlock = unlockSnap.docs[0].data();
        if (unlock.phone && unlock.phone !== phone) {
          return res.status(403).json({ error: "Unauthorized phone" });
        }
      }

      // 2) Get licensePath from beat doc
      const beatDoc = await db.collection("beats").doc(beatId).get();
      if (!beatDoc.exists) {
        return res.status(404).json({ error: "Beat not found" });
      }

      const { licensePath } = beatDoc.data();
      if (!licensePath) {
        return res.status(500).json({ error: "licensePath missing on beat doc" });
      }

      // 3) Signed URL (10 min)
      const [url] = await bucket.file(licensePath).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 10 * 60 * 1000,
        responseDisposition: "attachment", // forces download
        responseType: "application/pdf",
      });

      return res.json({ url });
    } catch (err) {
      console.error("licenseDownload error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  }
);

/* =========================================================
✅ EMAIL TRIGGERS (SendGrid)
========================================================= */

/**
 * 1) Producer signup:
 * - Trigger when /users/{uid} is created AND role/userType === "producer"
 * - Email admin
 * - Email producer welcome
 */
exports.onProducerSignup = onDocumentCreated(
  {
    region: "us-central1",
    document: "users/{uid}",
    secrets: [SENDGRID_API_KEY, SENDGRID_FROM, ADMIN_NOTIFY_EMAIL],
  },
  async (event) => {
    try {
      const data = event.data?.data() || {};
      if (!isProducerProfile(data)) return;

      const uid = event.params.uid;
      const email = safeStr(data.email);
      const name = safeStr(data.displayName || data.name || "Producer");

      const adminTo = ADMIN_NOTIFY_EMAIL.value();
      if (adminTo) {
        await sendEmail({
          to: adminTo,
          subject: "New producer signup on Audiory",
          text: `A new producer signed up.\n\nName: ${name}\nEmail: ${
            email || "—"
          }\nUID: ${uid}`,
          html: `
            <h2>New producer signup</h2>
            <p><b>Name:</b> ${name}</p>
            <p><b>Email:</b> ${email || "—"}</p>
            <p><b>UID:</b> ${uid}</p>
          `,
        });
      }

      if (email) {
        await sendEmail({
          to: email,
          subject: "Welcome to Audiory 👋",
          text:
            `Hey ${name}, welcome to Audiory!\n\n` +
            `You can now upload beats, set prices, and start selling.\n\n` +
            `If you need help, reply to this email.\n\n` +
            `— Audiory Team`,
          html: `
            <h2>Welcome to Audiory 👋</h2>
            <p>Hey ${name},</p>
            <p>Welcome to <b>Audiory</b>! You can now upload beats, set prices, and start selling.</p>
            <p>If you need help, just reply to this email.</p>
            <p style="margin-top:14px;">— Audiory Team</p>
          `,
        });
      }
    } catch (e) {
      console.error("onProducerSignup email error:", e);
    }
  }
);

/**
 * 2) Payout requests:
 * - Trigger when /payouts/{id} is created
 * - Email admin
 */
exports.onPayoutRequest = onDocumentCreated(
  {
    region: "us-central1",
    document: "payouts/{payoutId}",
    secrets: [SENDGRID_API_KEY, SENDGRID_FROM, ADMIN_NOTIFY_EMAIL],
  },
  async (event) => {
    try {
      const data = event.data?.data() || {};
      const payoutId = event.params.payoutId;

      const adminTo = ADMIN_NOTIFY_EMAIL.value();
      if (!adminTo) return;

      await sendEmail({
        to: adminTo,
        subject: "New payout request on Audiory",
        text:
          `A producer requested a payout.\n\n` +
          `Payout ID: ${payoutId}\n` +
          `Producer ID: ${safeStr(data.producerId)}\n` +
          `Email: ${safeStr(data.email)}\n` +
          `Amount: ${money(data.amount)}\n` +
          `Status: ${safeStr(data.status || "requested")}`,
        html: `
          <h2>New payout request</h2>
          <p><b>Payout ID:</b> ${payoutId}</p>
          <p><b>Producer ID:</b> ${safeStr(data.producerId)}</p>
          <p><b>Email:</b> ${safeStr(data.email) || "—"}</p>
          <p><b>Amount:</b> ${money(data.amount)}</p>
          <p><b>Status:</b> ${safeStr(data.status || "requested")}</p>
        `,
      });
    } catch (e) {
      console.error("onPayoutRequest email error:", e);
    }
  }
);

/**
 * 3) Buyer pays (order becomes PAID):
 * - Trigger when /orders/{id} status changes to "PAID"
 * - Email admin
 */
exports.onOrderPaid = onDocumentUpdated(
  {
    region: "us-central1",
    document: "orders/{orderId}",
    secrets: [SENDGRID_API_KEY, SENDGRID_FROM, ADMIN_NOTIFY_EMAIL],
  },
  async (event) => {
    try {
      const before = event.data?.before?.data() || {};
      const after = event.data?.after?.data() || {};
      const orderId = event.params.orderId;

      const beforeStatus = safeStr(before.status).toUpperCase();
      const afterStatus = safeStr(after.status).toUpperCase();

      if (beforeStatus === afterStatus) return;
      if (afterStatus !== "PAID") return;

      const adminTo = ADMIN_NOTIFY_EMAIL.value();
      if (!adminTo) return;

      // Try to fetch beat details for nicer email
      let beatTitle = "";
      try {
        const beatId = safeStr(after.beatId);
        if (beatId) {
          const beatSnap = await db.collection("beats").doc(beatId).get();
          if (beatSnap.exists) {
            const b = beatSnap.data() || {};
            beatTitle = safeStr(b.title || b.beatTitle || "");
          }
        }
      } catch (e) {
        // ignore
      }

      await sendEmail({
        to: adminTo,
        subject: "Beat purchase (PAID) on Audiory",
        text:
          `A buyer completed payment.\n\n` +
          `Order ID: ${orderId}\n` +
          `Beat ID: ${safeStr(after.beatId)}\n` +
          `Beat: ${beatTitle || "—"}\n` +
          `Amount: ${money(after.amount)}\n` +
          `Phone: ${safeStr(after.phone)}\n` +
          `Receipt: ${safeStr(after.receipt) || "—"}`,
        html: `
          <h2>Order paid ✅</h2>
          <p><b>Order ID:</b> ${orderId}</p>
          <p><b>Beat ID:</b> ${safeStr(after.beatId)}</p>
          <p><b>Beat:</b> ${beatTitle || "—"}</p>
          <p><b>Amount:</b> ${money(after.amount)}</p>
          <p><b>Phone:</b> ${safeStr(after.phone) || "—"}</p>
          <p><b>Receipt:</b> ${safeStr(after.receipt) || "—"}</p>
        `,
      });
    } catch (e) {
      console.error("onOrderPaid email error:", e);
    }

    /**
 * Trigger:
 * producerFollows/{producerId}/followers/{uid}
 *
 * When a follow doc is created -> increment users/{producerId}.followersCount
 * When deleted -> decrement users/{producerId}.followersCount
 */
exports.onProducerFollowWrite = functions.firestore
  .document("producerFollows/{producerId}/followers/{uid}")
  .onWrite(async (change, context) => {
    const { producerId } = context.params;

    const producerRef = db.collection("users").doc(producerId);

    // Created
    if (!change.before.exists && change.after.exists) {
      await producerRef.set(
        { followersCount: admin.firestore.FieldValue.increment(1) },
        { merge: true }
      );
      return;
    }

    // Deleted
    if (change.before.exists && !change.after.exists) {
      await producerRef.set(
        { followersCount: admin.firestore.FieldValue.increment(-1) },
        { merge: true }
      );
      return;
    }

    // Updated (not used)
    return;
  });
  }
);
