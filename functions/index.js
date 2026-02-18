const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

// ✅ Safe fetch: Node 20 has global fetch, fallback to node-fetch if needed
const fetchFn = global.fetch
  ? global.fetch
  : (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

// ✅ Firebase Storage
const { getStorage } = require("firebase-admin/storage");

// ✅ Firestore triggers (v2)
const {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} = require("firebase-functions/v2/firestore");

// ✅ SendGrid
const sgMail = require("@sendgrid/mail");

admin.initializeApp({
  storageBucket: "audiory-beat-store.firebasestorage.app",
});

const db = admin.firestore();
const bucket = getStorage().bucket("audiory-beat-store.firebasestorage.app");

// Secrets (names only!)
const DARAJA_CONSUMER_KEY = defineSecret("DARAJA_CONSUMER_KEY");
const DARAJA_CONSUMER_SECRET = defineSecret("DARAJA_CONSUMER_SECRET");
const MPESA_SHORTCODE = defineSecret("MPESA_SHORTCODE");
const MPESA_PASSKEY = defineSecret("MPESA_PASSKEY");
const MPESA_CALLBACK_URL = defineSecret("MPESA_CALLBACK_URL");

// ✅ SendGrid secrets
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const SENDGRID_FROM = defineSecret("SENDGRID_FROM");
const ADMIN_NOTIFY_EMAIL = defineSecret("ADMIN_NOTIFY_EMAIL");

// ✅ PayPal secrets
const PAYPAL_CLIENT_ID = defineSecret("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = defineSecret("PAYPAL_CLIENT_SECRET");
const PAYPAL_WEBHOOK_ID = defineSecret("PAYPAL_WEBHOOK_ID");
const PAYPAL_MODE = defineSecret("PAYPAL_MODE");

// Daraja endpoints (Sandbox)
const OAUTH_URL =
  "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
const STK_PUSH_URL =
  "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

function safeStr(v) {
  return v === null || v === undefined ? "" : String(v);
}

function money(n) {
  const v = Number(n || 0);
  if (!isFinite(v)) return "$0.00";
  return "$" + v.toFixed(2);
}

function isProducerProfile(userData) {
  const role = safeStr(userData?.role || userData?.userType).toLowerCase().trim();
  return role === "producer";
}

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

/* =========================================================
   ✅ CORS helper (keeps browser fetch working)
========================================================= */
function setCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

/* =========================================================
   ✅ DARAJA HELPERS
========================================================= */
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
   ✅ PAYPAL HELPERS
========================================================= */
function paypalBaseUrl() {
  const mode = safeStr(PAYPAL_MODE.value() || "sandbox").toLowerCase().trim();
  return mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
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

  const res = await fetchFn(
    `${paypalBaseUrl()}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PayPal verify failed: ${res.status} ${txt}`);
  }

  const data = await res.json();
  return safeStr(data.verification_status).toUpperCase() === "SUCCESS";
}

function parseAmountFromPayPalEvent(event) {
  const resource = event?.resource || {};
  const amt = resource?.amount?.value;
  const cur = resource?.amount?.currency_code;
  if (amt && cur) return { value: Number(amt), currency: String(cur) };

  const pu = resource?.purchase_units?.[0];
  const orderAmt = pu?.amount?.value;
  const orderCur = pu?.amount?.currency_code;
  if (orderAmt && orderCur) return { value: Number(orderAmt), currency: String(orderCur) };

  return { value: 0, currency: "USD" };
}

async function creditProducerWallet({ producerId, orderId, grossAmount, currency, source }) {
  const gross = Number(grossAmount || 0);
  const fee = Math.round(gross * 0.10 * 100) / 100;
  const net = Math.round((gross - fee) * 100) / 100;

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

/* =========================================================
   ✅ HTTP: createOrder (THIS is what your frontend calls now)
   URL shown in Firebase Console as:
   https://createorder-xxxxx-uc.a.run.app
========================================================= */
exports.createOrder = onRequest(
  {
    region: "us-central1",
    cors: ["https://audiory.site"],
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE],
  },
  async (req, res) => {
    try {
      setCors(res);
      if (req.method === "OPTIONS") return res.status(204).send("");
      if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

      const { beatId, licenseKey } = req.body || {};
      if (!beatId || !licenseKey) {
        return res.status(400).json({ error: "beatId and licenseKey are required" });
      }

      // Fetch beat
      const beatSnap = await db.collection("beats").doc(String(beatId)).get();
      if (!beatSnap.exists) return res.status(404).json({ error: "Beat not found" });

      const beat = beatSnap.data() || {};
      const producerId = safeStr(beat.producerId || "");

      // Price from beat.licenses
      const lic = beat.licenses || {};
      const selected = lic?.[licenseKey] || {};
      const price = Number(selected.price || beat.price || 0);

      if (!price || price <= 0) {
        return res.status(400).json({ error: "Invalid price for this license" });
      }

      const accessToken = await getPayPalAccessToken();

      // Metadata for webhook unlock/wallet credit
      const customId = `beatId=${beatId}|licenseKey=${licenseKey}|producerId=${producerId}`;

      const payload = {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: String(beatId),
            custom_id: customId,
            amount: { currency_code: "USD", value: price.toFixed(2) },
            description: `${safeStr(beat.title || "Beat")} - ${licenseKey} license`,
          },
        ],
        application_context: {
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
        },
      };

      const r = await fetchFn(`${paypalBaseUrl()}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(400).json({
          error: data?.message || "PayPal create order failed",
          details: data,
        });
      }

      const approve =
        (data.links || []).find((l) => l.rel === "approve") ||
        (data.links || []).find((l) => l.rel === "payer-action");

      return res.json({
        orderId: data.id,
        approveLinks: data.links || [],
        approveUrl: approve?.href || null,
      });
    } catch (e) {
      console.error("createOrder error:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

/* =========================================================
   ✅ PayPal webhook (unchanged behavior)
========================================================= */
exports.paypalWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_MODE],
    cors: true,
  },
  async (req, res) => {
    try {
      setCors(res);
      if (req.method === "OPTIONS") return res.status(204).send("");
      if (req.method !== "POST") return res.status(405).send("Use POST");

      const ok = await verifyPayPalWebhookSignature(req);
      if (!ok) return res.status(401).send("Invalid signature");

      const event = req.body || {};
      const eventType = safeStr(event.event_type).trim();
      const resource = event.resource || {};
      const resourceId = safeStr(resource.id || event.id);

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

      if (eventType !== "PAYMENT.CAPTURE.COMPLETED") {
        return res.status(200).json({ received: true, ignored: eventType });
      }

      const { value, currency } = parseAmountFromPayPalEvent(event);

      const customId =
        safeStr(resource?.custom_id) ||
        safeStr(resource?.invoice_id) ||
        safeStr(resource?.supplementary_data?.related_ids?.order_id) ||
        "";

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

      if (beatId && !producerId) {
        const beatSnap = await db.collection("beats").doc(beatId).get();
        if (beatSnap.exists) producerId = safeStr(beatSnap.data()?.producerId || "");
      }

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

      if (beatId && producerId) {
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

        // idempotent marker
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(orderRef);
          const d = snap.data() || {};
          if (d.walletCredited === true) return;
          tx.set(
            orderRef,
            {
              walletCredited: true,
              walletCreditedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        });

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

/* =========================================================
   ✅ PayPal payouts + status (kept)
========================================================= */
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
      if (method !== "paypal") return;

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

        tx.set(
          payoutRef,
          { status: "PROCESSING", provider: "paypal", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );

        tx.set(
          producerRef,
          {
            availableBalance: admin.firestore.FieldValue.increment(-amount),
            walletUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      const accessToken = await getPayPalAccessToken();

      const payoutPayload = {
        sender_batch_header: {
          sender_batch_id: `audiory_${payoutId}_${Date.now()}`,
          email_subject: "You have a payout from Audiory",
          email_message: "Your Audiory payout has been sent. Thank you for using Audiory!",
        },
        items: [
          {
            recipient_type: "EMAIL",
            amount: { value: amount.toFixed(2), currency: "USD" },
            receiver: destination,
            note: "Audiory producer withdrawal",
            sender_item_id: payoutId,
          },
        ],
      };

      const r = await fetchFn(`${paypalBaseUrl()}/v1/payments/payouts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payoutPayload),
      });

      const respText = await r.text();
      let respJson = {};
      try { respJson = JSON.parse(respText); } catch { respJson = { raw: respText }; }

      if (!r.ok) {
        await db.runTransaction(async (tx) => {
          tx.set(producerRef, { availableBalance: admin.firestore.FieldValue.increment(amount) }, { merge: true });
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

exports.paypalPayoutStatus = onRequest(
  { region: "us-central1", secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE], cors: true },
  async (req, res) => {
    try {
      setCors(res);
      if (req.method === "OPTIONS") return res.status(204).send("");

      const payoutBatchId = safeStr(req.query?.payoutBatchId).trim();
      if (!payoutBatchId) return res.status(400).json({ error: "payoutBatchId is required" });

      const accessToken = await getPayPalAccessToken();
      const r = await fetchFn(`${paypalBaseUrl()}/v1/payments/payouts/${payoutBatchId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const txt = await r.text();
      let j = {};
      try { j = JSON.parse(txt); } catch { j = { raw: txt }; }

      return res.status(r.ok ? 200 : 400).json(j);
    } catch (e) {
      console.error("paypalPayoutStatus error:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

/* =========================================================
   ✅ M-PESA STK push + callback (kept)
========================================================= */
exports.stkpush = onRequest(
  {
    region: "us-central1",
    secrets: [DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CALLBACK_URL],
    cors: true,
  },
  async (req, res) => {
    try {
      setCors(res);
      if (req.method === "OPTIONS") return res.status(204).send("");
      if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

      const { phone, amount, beatId } = req.body || {};
      if (!phone || !amount || !beatId) {
        return res.status(400).json({ error: "phone, amount, and beatId are required" });
      }

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

      const token = await getAccessToken(DARAJA_CONSUMER_KEY.value(), DARAJA_CONSUMER_SECRET.value());

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
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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

      return res.status(r.ok ? 200 : 400).json({ orderId: orderRef.id, ...data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }
);

exports.stkCallback = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  try {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(204).send("");

    const callback = req.body?.Body?.stkCallback;
    if (!callback) return res.json({ ResultCode: 0 });

    const { CheckoutRequestID, MerchantRequestID, ResultCode, ResultDesc, CallbackMetadata } = callback;

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

    const orderSnap = await db.collection("orders").where("checkoutRequestId", "==", CheckoutRequestID).limit(1).get();

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

/* =========================================================
   ✅ Secure downloads (kept)
========================================================= */
exports.secureDownload = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  try {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    const { beatId, phone } = req.body || {};
    if (!beatId) return res.status(400).json({ error: "beatId is required" });

    const unlockSnap = await db.collection("unlocks").where("beatId", "==", beatId).limit(1).get();
    if (unlockSnap.empty) return res.status(403).json({ error: "Beat not unlocked" });

    if (phone) {
      const unlock = unlockSnap.docs[0].data();
      if (unlock.phone && unlock.phone !== phone) return res.status(403).json({ error: "Unauthorized phone" });
    }

    const beatDoc = await db.collection("beats").doc(beatId).get();
    if (!beatDoc.exists) return res.status(404).json({ error: "Beat not found" });

    const { filePath } = beatDoc.data();
    if (!filePath) return res.status(500).json({ error: "File path missing" });

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
});

exports.licenseDownload = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  try {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    const { beatId, phone } = req.body || {};
    if (!beatId) return res.status(400).json({ error: "beatId is required" });

    const unlockSnap = await db.collection("unlocks").where("beatId", "==", beatId).limit(1).get();
    if (unlockSnap.empty) return res.status(403).json({ error: "Beat not unlocked" });

    if (phone) {
      const unlock = unlockSnap.docs[0].data();
      if (unlock.phone && unlock.phone !== phone) return res.status(403).json({ error: "Unauthorized phone" });
    }

    const beatDoc = await db.collection("beats").doc(beatId).get();
    if (!beatDoc.exists) return res.status(404).json({ error: "Beat not found" });

    const { licensePath } = beatDoc.data();
    if (!licensePath) return res.status(500).json({ error: "licensePath missing on beat doc" });

    const [url] = await bucket.file(licensePath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 10 * 60 * 1000,
      responseDisposition: "attachment",
      responseType: "application/pdf",
    });

    return res.json({ url });
  } catch (err) {
    console.error("licenseDownload error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/* =========================================================
   ✅ EMAIL TRIGGERS (SendGrid) (kept)
========================================================= */
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
          text: `A new producer signed up.\n\nName: ${name}\nEmail: ${email || "—"}\nUID: ${uid}`,
          html: `<h2>New producer signup</h2><p><b>Name:</b> ${name}</p><p><b>Email:</b> ${
            email || "—"
          }</p><p><b>UID:</b> ${uid}</p>`,
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
          html: `<h2>Welcome to Audiory 👋</h2><p>Hey ${name},</p><p>Welcome to <b>Audiory</b>! You can now upload beats, set prices, and start selling.</p><p>If you need help, just reply to this email.</p><p style="margin-top:14px;">— Audiory Team</p>`,
        });
      }
    } catch (e) {
      console.error("onProducerSignup email error:", e);
    }
  }
);

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
        html: `<h2>New payout request</h2><p><b>Payout ID:</b> ${payoutId}</p><p><b>Producer ID:</b> ${safeStr(
          data.producerId
        )}</p><p><b>Email:</b> ${safeStr(data.email) || "—"}</p><p><b>Amount:</b> ${money(
          data.amount
        )}</p><p><b>Status:</b> ${safeStr(data.status || "requested")}</p>`,
      });
    } catch (e) {
      console.error("onPayoutRequest email error:", e);
    }
  }
);

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
      } catch {}

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
        html: `<h2>Order paid ✅</h2><p><b>Order ID:</b> ${orderId}</p><p><b>Beat ID:</b> ${safeStr(
          after.beatId
        )}</p><p><b>Beat:</b> ${beatTitle || "—"}</p><p><b>Amount:</b> ${money(
          after.amount
        )}</p><p><b>Phone:</b> ${safeStr(after.phone) || "—"}</p><p><b>Receipt:</b> ${
          safeStr(after.receipt) || "—"
        }</p>`,
      });
    } catch (e) {
      console.error("onOrderPaid email error:", e);
    }
  }
);

/* =========================================================
   ✅ Producer follow count (kept, fixed to v2)
========================================================= */
exports.onProducerFollowWrite = onDocumentWritten(
  { region: "us-central1", document: "producerFollows/{producerId}/followers/{uid}" },
  async (event) => {
    const producerId = event.params.producerId;
    const producerRef = db.collection("users").doc(producerId);

    const beforeExists = !!event.data?.before?.exists;
    const afterExists = !!event.data?.after?.exists;

    // Created
    if (!beforeExists && afterExists) {
      await producerRef.set(
        { followersCount: admin.firestore.FieldValue.increment(1) },
        { merge: true }
      );
      return;
    }

    // Deleted
    if (beforeExists && !afterExists) {
      await producerRef.set(
        { followersCount: admin.firestore.FieldValue.increment(-1) },
        { merge: true }
      );
      return;
    }
  }
);
