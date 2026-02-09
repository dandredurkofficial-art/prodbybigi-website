const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

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
  // YYYYMMDDHHmmss
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

  const res = await fetch(OAUTH_URL, {
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

      const consumerKey = DARAJA_CONSUMER_KEY.value();
      const consumerSecret = DARAJA_CONSUMER_SECRET.value();
      const shortcode = MPESA_SHORTCODE.value();
      const passkey = MPESA_PASSKEY.value();
      const callbackUrl = MPESA_CALLBACK_URL.value();

      const timestamp = nowTimestamp();
      const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString(
        "base64"
      );

      const token = await getAccessToken(consumerKey, consumerSecret);

      // 2) STK payload (IMPORTANT: AccountReference = orderRef.id)
      const payload = {
        BusinessShortCode: Number(shortcode),
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: Number(amount),
        PartyA: phone,
        PartyB: Number(shortcode),
        PhoneNumber: phone,
        CallBackURL: callbackUrl,
        AccountReference: orderRef.id, // ✅ link to order id
        TransactionDesc: `Beat ${beatId}`,
      };

      const r = await fetch(STK_PUSH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await r.json();

      // 3) Save CheckoutRequestID into the order (so callback can find it)
      if (data?.CheckoutRequestID) {
        await orderRef.set(
          {
            checkoutRequestId: data.CheckoutRequestID,
            merchantRequestId: data.MerchantRequestID || null,
            stkResponse: data,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        // If STK push request failed, mark order failed
        await orderRef.set(
          {
            status: "FAILED_TO_REQUEST_STK",
            stkResponse: data,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      // Return orderId to frontend + response from daraja
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

// Callback endpoint Daraja will hit after STK push prompt
exports.stkCallback = onRequest({ region: "us-central1" }, async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;

    if (!callback) {
      console.log("Invalid callback body", req.body);
      return res.status(400).send("Invalid callback");
    }

    const {
      CheckoutRequestID,
      MerchantRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata,
    } = callback;

    // Extract metadata
    const metadata = {};
    if (CallbackMetadata?.Item) {
      CallbackMetadata.Item.forEach((item) => {
        metadata[item.Name] = item.Value ?? null;
      });
    }

    // 1) Save payment to Firestore (permanent record)
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

    // 2) Find the matching order by checkoutRequestId
    const orderSnap = await db
      .collection("orders")
      .where("checkoutRequestId", "==", CheckoutRequestID)
      .limit(1)
      .get();

    if (!orderSnap.empty) {
      const orderDoc = orderSnap.docs[0];
      const orderId = orderDoc.id;
      const orderData = orderDoc.data();

      // Update order status
      const paid = Number(ResultCode) === 0;

      await orderDoc.ref.set(
        {
          status: paid ? "PAID" : "FAILED",
          resultCode: ResultCode,
          resultDesc: ResultDesc,
          receipt: metadata.MpesaReceiptNumber || null,
          transactionDate: metadata.TransactionDate || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // 3) OPTION A: Create unlock document only if paid
      if (paid) {
        await db.collection("unlocks").doc(orderId).set({
          orderId,
          beatId: orderData.beatId || null,
          phone: metadata.PhoneNumber || orderData.phone || null,
          amount: metadata.Amount || orderData.amount || null,
          receipt: metadata.MpesaReceiptNumber || null,
          transactionDate: metadata.TransactionDate || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          checkoutRequestId: CheckoutRequestID,
        });
      }
    } else {
      console.log("No matching order found for:", CheckoutRequestID);
    }

    console.log("Callback saved:", CheckoutRequestID);

    // Safaricom expects 200 OK
    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("Callback error:", err);
    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
});
