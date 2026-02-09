const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/* ===================== SECRETS ===================== */
const DARAJA_CONSUMER_KEY = defineSecret("DARAJA_CONSUMER_KEY");
const DARAJA_CONSUMER_SECRET = defineSecret("DARAJA_CONSUMER_SECRET");
const MPESA_SHORTCODE = defineSecret("MPESA_SHORTCODE");
const MPESA_PASSKEY = defineSecret("MPESA_PASSKEY");
const MPESA_CALLBACK_URL = defineSecret("MPESA_CALLBACK_URL");

/* ===================== ENDPOINTS ===================== */
const OAUTH_URL =
  "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
const STK_PUSH_URL =
  "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

/* ===================== HELPERS ===================== */
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

async function getAccessToken(key, secret) {
  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const res = await fetch(OAUTH_URL, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Failed to get access token");
  return data.access_token;
}

/* ===================== STK PUSH ===================== */
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
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Use POST" });
      }

      const { phone, amount, beatId } = req.body || {};
      if (!phone || !amount || !beatId) {
        return res
          .status(400)
          .json({ error: "phone, amount and beatId are required" });
      }

      /* 🔹 CREATE ORDER */
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
        AccountReference: orderRef.id, // 🔥 IMPORTANT
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

      await orderRef.update({
        stkResponse: data,
        checkoutRequestId: data.CheckoutRequestID || null,
      });

      return res.json({
        success: true,
        orderId: orderRef.id,
        stk: data,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
  }
);

/* ===================== CALLBACK ===================== */
exports.stkCallback = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    try {
      const callback = req.body?.Body?.stkCallback;
      if (!callback) return res.json({ ResultCode: 0 });

      const {
        CheckoutRequestID,
        ResultCode,
        ResultDesc,
        CallbackMetadata,
      } = callback;

      const metadata = {};
      CallbackMetadata?.Item?.forEach((i) => {
        metadata[i.Name] = i.Value ?? null;
      });

      await db
        .collection("mpesaPayments")
        .doc(CheckoutRequestID)
        .set(
          {
            checkoutRequestId: CheckoutRequestID,
            resultCode: ResultCode,
            resultDesc: ResultDesc,
            amount: metadata.Amount || null,
            phone: metadata.PhoneNumber || null,
            receipt: metadata.MpesaReceiptNumber || null,
            transactionDate: metadata.TransactionDate || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            raw: callback,
          },
          { merge: true }
        );

      if (ResultCode === 0) {
        const orderSnap = await db
          .collection("orders")
          .where("checkoutRequestId", "==", CheckoutRequestID)
          .limit(1)
          .get();

        if (!orderSnap.empty) {
          await orderSnap.docs[0].ref.update({
            status: "PAID",
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            receipt: metadata.MpesaReceiptNumber || null,
          });
        }
      }

      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    } catch (e) {
      console.error(e);
      return res.json({ ResultCode: 0 });
    }
  }
);
