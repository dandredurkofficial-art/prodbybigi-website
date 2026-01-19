// /api/server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const app = express();

/**
 * CORS
 * Set FRONTEND_ORIGIN in Render to: https://prodby.officialbigi.shop
 */
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || true;
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json());

// ---------- Firebase Admin ----------
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}
const db = admin.firestore();

// ---------- Helpers ----------
function toCents(n) {
  const v = Number(n || 0);
  return Math.round(v * 100);
}
function fromCents(c) {
  return (Number(c || 0) / 100).toFixed(2);
}
function getPaypalBase() {
  return process.env.PAYPAL_BASE || process.env.PAYPAL_BASE_URL || "";
}
function getSiteUrl() {
  // Prefer SITE_URL, fallback FRONTEND_ORIGIN if it's a string
  if (process.env.SITE_URL) return process.env.SITE_URL;
  if (typeof process.env.FRONTEND_ORIGIN === "string") return process.env.FRONTEND_ORIGIN;
  return "";
}

async function paypalAccessToken() {
  const base = getPaypalBase();
  if (!base) throw new Error("Missing PAYPAL_BASE (or PAYPAL_BASE_URL)");

  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!id || !secret) throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_SECRET");

  const auth = Buffer.from(`${id}:${secret}`).toString("base64");

  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error_description || data?.message || "PayPal token failed");
  return data.access_token;
}

// ---------- Auth middleware (Firebase ID token) ----------
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const m = h.match(/^Bearer (.+)$/i);
    if (!m) return res.status(401).json({ error: "Missing Authorization Bearer token" });

    const idToken = m[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    req.user = {
      uid: decoded.uid,
      email: decoded.email || null
    };
    next();
  } catch (e) {
    console.error("[auth]", e);
    res.status(401).json({ error: "Invalid/expired token" });
  }
}

// ---------- ROUTES ----------
app.get("/", (_, res) => res.send("API OK"));
app.get("/healthz", (_, res) => res.status(200).send("ok"));

/**
 * POST /api/create-order
 * Body: { beatId, licenseKey }
 * Auth: Bearer Firebase ID token
 */
app.post("/api/create-order", requireAuth, async (req, res) => {
  try {
    const { beatId, licenseKey } = req.body || {};
    if (!beatId || !licenseKey) return res.status(400).json({ error: "Missing beatId/licenseKey" });

    // Buyer
    const buyerId = req.user.uid;
    const buyerEmail = req.user.email;

    // Beat
    const beatRef = db.collection("beats").doc(String(beatId));
    const beatSnap = await beatRef.get();
    if (!beatSnap.exists) return res.status(404).json({ error: "Beat not found" });

    const beat = beatSnap.data() || {};
    if (beat.published !== true) return res.status(403).json({ error: "Beat not published" });

    const producerId = beat.producerId || beat.producerid;
    if (!producerId) return res.status(400).json({ error: "Beat missing producerId" });

    // Option B pricing: beat.licenses[licenseKey].price
    const license = beat.licenses?.[licenseKey];
    const price = license?.price;
    if (price == null) return res.status(400).json({ error: "Invalid licenseKey" });

    const amountCents = toCents(price);
    if (amountCents < 50) return res.status(400).json({ error: "Price too low" });

    // PayPal create order
    const token = await paypalAccessToken();
    const base = getPaypalBase();

    const site = getSiteUrl();
    if (!site) throw new Error("Missing SITE_URL (or FRONTEND_ORIGIN as a string)");

    const create = await fetch(`${base}/v2/checkout/orders`, {
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
            description: `${beat.title || "Beat"} - ${license?.name || licenseKey}`
          }
        ],
        application_context: {
          return_url: `${site}/paypal-return.html`,
          cancel_url: `${site}/paypal-cancel.html`
        }
      })
    });

    const payData = await create.json().catch(() => ({}));
    if (!create.ok) {
      throw new Error(payData?.message || payData?.details?.[0]?.description || "PayPal order create failed");
    }

    // Store order
    const feeCents = Math.round(amountCents * 0.10);
    const producerNetCents = amountCents - feeCents;

    const orderRef = db.collection("orders").doc();
    await orderRef.set({
      beatId: String(beatId),
      producerId: String(producerId),
      buyerId: String(buyerId),
      buyerEmail: buyerEmail || null,
      licenseKey: String(licenseKey),
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
    console.error("[create-order]", e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

/**
 * POST /api/capture-order
 * Body: { orderId }
 * Auth: Bearer Firebase ID token
 */
app.post("/api/capture-order", requireAuth, async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    const orderRef = db.collection("orders").doc(String(orderId));
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });

    const order = orderSnap.data() || {};

    // Buyer can only capture their own order
    if (order.buyerId && order.buyerId !== req.user.uid) {
      return res.status(403).json({ error: "Not allowed" });
    }

    if (order.status === "CAPTURED") return res.json({ ok: true, status: "CAPTURED" });

    const token = await paypalAccessToken();
    const base = getPaypalBase();

    const cap = await fetch(`${base}/v2/checkout/orders/${order.paypalOrderId}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });

    const capData = await cap.json().catch(() => ({}));
    if (!cap.ok) {
      throw new Error(capData?.message || capData?.details?.[0]?.description || "PayPal capture failed");
    }

    // Credit producer wallet + ledger + mark order captured (transaction)
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(orderRef);
      const o = fresh.data();
      if (!o || o.status === "CAPTURED") return;

      const walletRef = db.collection("wallets").doc(String(o.producerId));
      const walletSnap = await tx.get(walletRef);

      const prev = walletSnap.exists ? walletSnap.data() : { availableCents: 0, lifetimeEarnedCents: 0 };

      tx.set(
        walletRef,
        {
          availableCents: (prev.availableCents || 0) + (o.producerNetCents || 0),
          lifetimeEarnedCents: (prev.lifetimeEarnedCents || 0) + (o.producerNetCents || 0),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      tx.set(db.collection("walletLedger").doc(), {
        producerId: String(o.producerId),
        buyerId: String(o.buyerId || req.user.uid),
        type: "SALE",
        amountCents: o.producerNetCents || 0,
        feeCents: o.feeCents || 0,
        orderId: String(orderId),
        beatId: String(o.beatId),
        licenseKey: String(o.licenseKey),
        paypalCaptureStatus: capData?.status || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      tx.update(orderRef, {
        status: "CAPTURED",
        capturedAt: admin.firestore.FieldValue.serverTimestamp(),
        buyerId: String(o.buyerId || req.user.uid), // ensure stored
        buyerEmail: o.buyerEmail || req.user.email || null
      });
    });

    res.json({ ok: true, status: "CAPTURED" });
  } catch (e) {
    console.error("[capture-order]", e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

/**
 * GET /api/my-orders
 * Auth: Bearer Firebase ID token
 * Returns buyer's CAPTURED orders
 */
app.get("/api/my-orders", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;

    const snap = await db
      .collection("orders")
      .where("buyerId", "==", uid)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    const out = [];
    snap.forEach((d) => {
      const o = d.data() || {};
      out.push({
        id: d.id,
        beatId: o.beatId,
        licenseKey: o.licenseKey,
        amountCents: o.amountCents,
        status: o.status,
        createdAt: o.createdAt || null
      });
    });

    res.json({ orders: out });
  } catch (e) {
    console.error("[my-orders]", e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

/**
 * GET /api/order-download?orderId=XXX
 * Auth: Bearer Firebase ID token
 * Returns the purchased beat download URL (Cloudinary fullAudio) if CAPTURED
 */
app.get("/api/order-download", requireAuth, async (req, res) => {
  try {
    const orderId = String(req.query.orderId || "");
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    const orderSnap = await db.collection("orders").doc(orderId).get();
    if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });

    const o = orderSnap.data() || {};
    if (o.buyerId !== req.user.uid) return res.status(403).json({ error: "Not allowed" });
    if (o.status !== "CAPTURED") return res.status(403).json({ error: "Order not captured" });

    const beatSnap = await db.collection("beats").doc(String(o.beatId)).get();
    if (!beatSnap.exists) return res.status(404).json({ error: "Beat not found" });

    const beat = beatSnap.data() || {};
    const url = beat.fullAudio || beat.audioUrl || beat.audioURL || null;

    if (!url) return res.status(404).json({ error: "No download url found on beat (fullAudio)" });

    res.json({
      ok: true,
      beatId: String(o.beatId),
      orderId,
      title: beat.title || "Beat",
      downloadUrl: url
    });
  } catch (e) {
    console.error("[order-download]", e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

app.listen(process.env.PORT || 8080, () => console.log("API running"));
