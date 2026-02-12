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
  return (v === null || v === undefined) ? "" : String(v);
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
          text: `A new producer signed up.\n\nName: ${name}\nEmail: ${email || "—"}\nUID: ${uid}`,
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
