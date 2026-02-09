const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// Secrets
// Secrets (names only!)
const DARAJA_CONSUMER_KEY = defineSecret("DARAJA_CONSUMER_KEY");
const DARAJA_CONSUMER_SECRET = defineSecret("DARAJA_CONSUMER_SECRET");
const MPESA_SHORTCODE = defineSecret("MPESA_SHORTCODE");
const MPESA_PASSKEY = defineSecret("MPESA_PASSKEY");
const MPESA_CALLBACK_URL = defineSecret("MPESA_CALLBACK_URL");

// Daraja endpoints (Sandbox)
const OAUTH_URL = "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
const STK_PUSH_URL = "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

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
    headers: {
      Authorization: `Basic ${auth}`,
    },
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
 * body: { phone: "2547XXXXXXXX", amount: 1, accountReference: "Beat123", transactionDesc: "Beat purchase" }
 */
exports.stkpush = onRequest(
  {
    region: "us-central1",
    secrets: [DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CALLBACK_URL],
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

      const { phone, amount, accountReference, transactionDesc } = req.body || {};
      if (!phone || !amount) return res.status(400).json({ error: "phone and amount are required" });

      const consumerKey = DARAJA_CONSUMER_KEY.value();
      const consumerSecret = DARAJA_CONSUMER_SECRET.value();
      const shortcode = MPESA_SHORTCODE.value();
      const passkey = MPESA_PASSKEY.value();
      const callbackUrl = MPESA_CALLBACK_URL.value();

      const timestamp = nowTimestamp();
      const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

      const token = await getAccessToken(consumerKey, consumerSecret);

      const payload = {
        BusinessShortCode: Number(shortcode),
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: Number(amount),
        PartyA: phone,              // customer phone (2547...)
        PartyB: Number(shortcode),  // shortcode
        PhoneNumber: phone,
        CallBackURL: callbackUrl,
        AccountReference: accountReference || "ProdByBigi",
        TransactionDesc: transactionDesc || "Beat Purchase",
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
      return res.status(r.ok ? 200 : 400).json(data);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }
);

// Callback endpoint Daraja will hit after STK push prompt
exports.stkCallback = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    try {
      const callback = req.body?.Body?.stkCallback;

      if (!callback) {
        console.log("Invalid callback body", req.body);
        return res.status(400).send("Invalid callback");
      }

      const {
        CheckoutRequestID,
        ResultCode,
        ResultDesc,
        CallbackMetadata
      } = callback;

      // Extract metadata
      const metadata = {};
      if (CallbackMetadata?.Item) {
        CallbackMetadata.Item.forEach(item => {
          metadata[item.Name] = item.Value ?? null;
        });
      }

      // Save payment to Firestore
      await db.collection("mpesaPayments").doc(CheckoutRequestID).set({
        checkoutRequestId: CheckoutRequestID,
        resultCode: ResultCode,
        resultDesc: ResultDesc,
        amount: metadata.Amount || null,
        phone: metadata.PhoneNumber || null,
        receipt: metadata.MpesaReceiptNumber || null,
        transactionDate: metadata.TransactionDate || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        raw: callback
      });

      console.log("Payment saved:", CheckoutRequestID);

      // Safaricom expects 200 OK
      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });

    } catch (err) {
      console.error("Callback error:", err);
      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }
  }
);
