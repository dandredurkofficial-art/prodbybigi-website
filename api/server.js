import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ---------- Firebase Admin ----------
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
  });
}
const db = admin.firestore();

// ---------- PayPal helpers ----------
async function paypalAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString("base64");

  const r = await fetch(`${process.env.PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  if (!r.ok) throw new Error("PayPal token failed");
  const data = await r.json();
  return data.access_token;
}

function toCents(n) {
  const v = Number(n || 0);
  return Math.round(v * 100);
}
function fromCents(c) {
  return (Number(c || 0) / 100).toFixed(2);
}

// ---------- API: Create Order ----------
app.post("/api/create-order", async (req, res) => {
  try {
    const { beatId, licenseKey } = req.body;
    if (!beatId || !licenseKey) return res.status(400).json({ error: "Missing beatId/licenseKey" });

    // 1) Read beat from Firestore (source of truth)
    const beatSnap = await db.collection("beats").doc(beatId).get();
    if (!beatSnap.exists) return res.status(404).json({ error: "Beat not found" });

    const beat = beatSnap.data();
    if (beat.published !== true) return res.status(403).json({ error: "Beat not published" });

    const producerId = beat.producerId || beat.producerid;
    if (!producerId) return res.status(400).json({ error: "Beat missing producerId" });

    const license = beat.licenses?.[licenseKey];
    const price = license?.price;
    if (price == null) return res.status(400).json({ error: "Invalid licenseKey" });

    const amountCents = toCents(price);
    if (amountCents < 50) return res.status(400).json({ error: "Price too low" });

    // 2) Create PayPal order (platform receives money)
    const token = await paypalAccessToken();
    const create = await fetch(`${process.env.PAYPAL_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: { currency_code: "USD", value: fromCents(amountCents) },
            description: `${beat.title || "Beat"} - ${license.name || licenseKey}`
          }
        ]
      })
    });

    const payData = await create.json();
    if (!create.ok) throw new Error(payData?.message || "PayPal order create failed");

    // 3) Store order in Firestore
    const feeCents = Math.round(amountCents * 0.10);
    const producerNetCents = amountCents - feeCents;

    const orderRef = db.collection("orders").doc();
    await orderRef.set({
      beatId,
      producerId,
      licenseKey,
      amountCents,
      feeCents,
      producerNetCents,
      paypalOrderId: payData.id,
      status: "CREATED",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      orderId: orderRef.id,
      paypalOrderId: payData.id,
      approveLinks: payData.links || []
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// ---------- API: Capture Order ----------
app.post("/api/capture-order", async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });

    const order = orderSnap.data();
    if (order.status === "CAPTURED") return res.json({ ok: true, status: "CAPTURED" });

    const token = await paypalAccessToken();
    const cap = await fetch(`${process.env.PAYPAL_BASE}/v2/checkout/orders/${order.paypalOrderId}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });

    const capData = await cap.json();
    if (!cap.ok) throw new Error(capData?.message || "PayPal capture failed");

    // 1) Credit producer wallet (net after 10%)
    await db.runTransaction(async (tx) => {
      // refresh inside txn
      const fresh = await tx.get(orderRef);
      const o = fresh.data();
      if (o.status === "CAPTURED") return;

      const walletRef = db.collection("wallets").doc(o.producerId);
      const walletSnap = await tx.get(walletRef);

      const prev = walletSnap.exists ? walletSnap.data() : { availableCents: 0, lifetimeEarnedCents: 0 };

      tx.set(walletRef, {
        availableCents: (prev.availableCents || 0) + o.producerNetCents,
        lifetimeEarnedCents: (prev.lifetimeEarnedCents || 0) + o.producerNetCents,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      const ledgerRef = db.collection("walletLedger").doc();
      tx.set(ledgerRef, {
        producerId: o.producerId,
        type: "SALE",
        amountCents: o.producerNetCents,
        feeCents: o.feeCents,
        orderId: orderId,
        beatId: o.beatId,
        licenseKey: o.licenseKey,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      tx.update(orderRef, {
        status: "CAPTURED",
        capturedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    res.json({ ok: true, status: "CAPTURED" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

app.get("/", (_, res) => res.send("API OK"));
app.listen(process.env.PORT || 8080, () => console.log("API running"));
