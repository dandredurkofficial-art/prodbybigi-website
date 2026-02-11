const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore"); // ✅ ADD
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

// ✅ SendGrid
const sgMail = require("@sendgrid/mail"); // ✅ ADD
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY"); // ✅ ADD

// ✅ Safe fetch: Node 20 has global fetch, fallback to node-fetch if needed
const fetchFn = global.fetch
  ? global.fetch
  : (...args) =>
      import("node-fetch").then(({ default: fetch }) => fetch(...args));

// ✅ ADD: Firebase Storage
const { getStorage } = require("firebase-admin/storage");

admin.initializeApp();

const db = admin.firestore();
const bucket = getStorage().bucket(); // ✅ ADD

// ✅ ADD: Admin email + sender (change if you want)
const ADMIN_EMAIL = "support@audiory.site"; // ✅ ADD
const FROM_EMAIL = "no-reply@audiory.site"; // ✅ ADD
const FROM_NAME = "Audiory"; // ✅ ADD

// ✅ ADD: SendGrid init + send helper
function initSendGrid() {
  const key = SENDGRID_API_KEY.value();
  if (!key) throw new Error("SendGrid API key missing (SENDGRID_API_KEY secret)");
  sgMail.setApiKey(key);
}

async function sendEmail({ to, subject, html }) {
  initSendGrid();
  await sgMail.send({
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject,
    html,
  });
}

// Secrets (names only!)
const DARAJA_CONSUMER_KEY = defineSecret("DARAJA_CONSUMER_KEY");
const DARAJA_CONSUMER_SECRET = defineSecret("DARAJA_CONSUMER_SECRET");
const MPESA_SHORTCODE = defineSecret("MPESA_SHORTCODE");
const MPESA_PASSKEY = defineSecret("MPESA_PASSKEY");
const MPESA_CALLBACK_URL = defineSecret("MPESA_CALLBACK_URL");

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

/**
 * ✅ ADD: Firestore trigger → Producer signup:
 * - Welcome email to producer
 * - Notify you (admin)
 *
 * Works when you create /users/<uid> with { role: "producer", email: "..." }
 */
exports.onProducerSignup = onDocumentCreated(
  {
    document: "users/{uid}",
    region: "us-central1",
    secrets: [SENDGRID_API_KEY],
  },
  async (event) => {
    try {
      const user = event.data?.data();
      if (!user) return;

      const role = String(user.role || user.userType || "").toLowerCase();
      const email = String(user.email || "").trim();

      // Only run for producers
      if (role !== "producer") return;
      if (!email) return;

      // 1) Welcome email
      await sendEmail({
        to: email,
        subject: "Welcome to Audiory 🎶",
        html: `
          <div style="font-family: Arial, sans-serif; line-height:1.5">
            <h2>Welcome to Audiory!</h2>
            <p>We’re excited to have you as a producer.</p>
            <p>You can now upload beats, sell licenses, and earn on Audiory.</p>
            <p style="margin-top:18px;">— ${FROM_NAME}</p>
          </div>
        `,
      });

      // 2) Notify admin
      await sendEmail({
        to: ADMIN_EMAIL,
        subject: "New Producer Signup",
        html: `
          <div style="font-family: Arial, sans-serif; line-height:1.5">
            <h3>New producer joined</h3>
            <p><b>Email:</b> ${email}</p>
            <p><b>UID:</b> ${event.params.uid}</p>
            <p><b>Role:</b> ${role}</p>
          </div>
        `,
      });
    } catch (e) {
      console.error("onProducerSignup email error:", e);
    }
  }
);

/**
 * ✅ ADD: Firestore trigger → Payout request:
 * - Notify you (admin)
 *
 * Works when a producer creates /payouts/<id> with { producerId, email?, amount, status }
 */
exports.onPayoutRequest = onDocumentCreated(
  {
    document: "payouts/{payoutId}",
    region: "us-central1",
    secrets: [SENDGRID_API_KEY],
  },
  async (event) => {
    try {
      const payout = event.data?.data();
      if (!payout) return;

      const producerId = String(payout.producerId || payout.uid || "").trim();
      const email = String(payout.email || payout.producerEmail || "").trim();
      const amount = payout.amount ?? payout.total ?? 0;
      const status = String(payout.status || "requested").toLowerCase();

      // If you only want notifications for new "requested" payouts, keep this:
      if (status !== "requested") return;

      await sendEmail({
        to: ADMIN_EMAIL,
        subject: "New Payout Request",
        html: `
          <div style="font-family: Arial, sans-serif; line-height:1.5">
            <h3>Payout Requested</h3>
            <p><b>Payout ID:</b> ${event.params.payoutId}</p>
            <p><b>Producer ID:</b> ${producerId || "—"}</p>
            <p><b>Email:</b> ${email || "—"}</p>
            <p><b>Amount:</b> ${amount}</p>
            <p><b>Status:</b> ${status}</p>
          </div>
        `,
      });
    } catch (e) {
      console.error("onPayoutRequest email error:", e);
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
exports.stkCallback = onRequest(
  { region: "us-central1", secrets: [SENDGRID_API_KEY] }, // ✅ ADD secret
  async (req, res) => {
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

          // ✅ ADD: Email you (admin) when a purchase is successful
          try {
            const beatId = orderDoc.data().beatId || "—";
            await sendEmail({
              to: ADMIN_EMAIL,
              subject: "New Beat Purchase 💰",
              html: `
                <div style="font-family: Arial, sans-serif; line-height:1.5">
                  <h3>New purchase received</h3>
                  <p><b>Order ID:</b> ${orderDoc.id}</p>
                  <p><b>Beat ID:</b> ${beatId}</p>
                  <p><b>Amount:</b> ${metadata.Amount || "—"}</p>
                  <p><b>Phone:</b> ${metadata.PhoneNumber || "—"}</p>
                  <p><b>Receipt:</b> ${metadata.MpesaReceiptNumber || "—"}</p>
                </div>
              `,
            });
          } catch (e) {
            console.error("Purchase email error:", e);
          }
        }
      }

      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    } catch (err) {
      console.error(err);
      return res.json({ ResultCode: 0 });
    }
  }
);

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
        return res
          .status(500)
          .json({ error: "licensePath missing on beat doc" });
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
