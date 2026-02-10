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

admin.initializeApp();

const db = admin.firestore();
const bucket = getStorage().bucket(); // ✅ ADD

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
