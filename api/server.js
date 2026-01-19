// /api/server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// ✅ strict origins (NO trailing slash)
const ALLOWED_ORIGINS = [
  "https://prodby.officialbigi.shop",
  "http://localhost:5173",
  "http://localhost:3000"
];

app.use(cors({
  origin: function (origin, cb) {
    // allow server-to-server / curl (no origin)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked origin: " + origin));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// ✅ IMPORTANT: answer preflight
app.options("*", cors());

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
  return (process.env.PAYPAL_BASE || process.env.PAYPAL_BASE_URL || "").trim();
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
  if (!r.ok) {
    throw new Error(data?.error_description || data?.message || "PayPal token failed");
  }
  return data.access_token;
}

// --- Auth helper (Firebase ID token) ---
async function getUserFromAuthHeader(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  try {
    const decoded = await admin.auth().verifyIdToken(m[1]);
    return {
      uid: decoded.uid,
      email: decoded.email || null
    };
  } catch (e) {
    return null;
  }
}

// ---------- ROUTES ----------
app.get("/", (_, res) => res.send("API OK"));
app.get("/healthz", (_, res) => res.status(200).send("ok"));

/**
 * POST /api/create-order
 * Body: { beatId, licenseKey }
 * Auth: Authorization: Bearer <firebaseIdToken>   (recommended)
 */
app.post("/api/create-order", async (req, res) => {
  try {
    const { beatId, licenseKey } = req.body || {};
    if (!beatId || !licenseKey) {
      return res.status(400).json({ error: "Missing beatId/licenseKey" });
    }

    const user = await getUserFromAuthHeader(req); // may be null if not logged in

    // 1) Read beat (source of truth)
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

    // 2) Create PayPal order
    const token = await paypalAccessToken();
    const base = getPaypalBase();

    // IMPORTANT: set SITE_URL in Render: https://prodby.officialbigi.shop
    const site = process.env.SITE_URL;
    if (!site) throw new Error("Missing SITE_URL env var (your frontend domain)");

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
      throw new Error(
        payData?.message || payData?.details?.[0]?.description || "PayPal order create failed"
      );
    }

    // 3) Store order in Firestore
    const feeCents = Math.round(amountCents * 0.10); // 10%
    const producerNetCents = amountCents - feeCents;

    const orderRef = db.collection("orders").doc();
    await orderRef.set({
      beatId: String(beatId),
      producerId: String(producerId),
      licenseKey: String(licenseKey),

      beatTitle: beat.title || null,
      beatArtwork: beat.artwork || beat.coverurl || beat.coverUrl || beat.coverURL || null,
      
      amountCents,
      feeCents,
      producerNetCents,

      buyerId: user?.uid || null,
      buyerEmail: user?.email || null,

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
 * POST /api/cart-checkout
 * Body: { items: [{ beatId, licenseKey, qty? }] }
 *
 * Creates ONE PayPal order for the whole cart.
 * Stores ONE Firestore order with items[].
 */
app.post("/api/cart-checkout", async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length < 1) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    // Limit cart size (safety)
    if (items.length > 20) {
      return res.status(400).json({ error: "Too many items in cart" });
    }

    // Optional buyer auth (if you want)
    // const authHeader = req.headers.authorization || "";
    // const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    // let buyerId = null;
    // if (idToken) {
    //   const decoded = await admin.auth().verifyIdToken(idToken);
    //   buyerId = decoded.uid;
    // }

    // Build normalized items list
    const cleanItems = items.map((x) => ({
      beatId: String(x.beatId || ""),
      licenseKey: String(x.licenseKey || ""),
      qty: Math.max(1, Math.min(10, Number(x.qty || 1)))
    })).filter(x => x.beatId && x.licenseKey);

    if (cleanItems.length < 1) {
      return res.status(400).json({ error: "Invalid cart items" });
    }

    // Load beats and compute total from Firestore
    let totalCents = 0;
    let producerId = null; // single producer store assumed
    const enriched = [];

    for (const it of cleanItems) {
      const beatSnap = await db.collection("beats").doc(it.beatId).get();
      if (!beatSnap.exists) return res.status(404).json({ error: `Beat not found: ${it.beatId}` });

      const beat = beatSnap.data() || {};
      if (beat.published !== true) return res.status(403).json({ error: `Beat not published: ${it.beatId}` });

      const pId = String(beat.producerId || beat.producerid || "");
      if (!pId) return res.status(400).json({ error: `Beat missing producerId: ${it.beatId}` });

      // This store currently looks like one producer. If you allow multiple producers later,
      // you’ll need split payouts. For now we enforce same producer.
      if (!producerId) producerId = pId;
      if (producerId !== pId) {
        return res.status(400).json({ error: "Cart contains multiple producers (not supported yet)" });
      }

      const license = beat.licenses?.[it.licenseKey];
      const price = license?.price;
      if (price == null) return res.status(400).json({ error: `Invalid licenseKey: ${it.licenseKey}` });

      const amountCents = toCents(price) * it.qty;
      if (amountCents < 50) return res.status(400).json({ error: "Price too low" });

      totalCents += amountCents;

      enriched.push({
        beatId: it.beatId,
        licenseKey: it.licenseKey,
        qty: it.qty,
        unitPriceCents: toCents(price),
        title: beat.title || null,
        artwork: beat.artwork || beat.coverurl || beat.coverUrl || null
      });
    }

    if (totalCents < 50) return res.status(400).json({ error: "Total too low" });

    // Create PayPal order
    const token = await paypalAccessToken();
    const base = getPaypalBase();

    const site = process.env.SITE_URL;
    if (!site) throw new Error("Missing SITE_URL env var (your frontend domain)");

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
            amount: { currency_code: "USD", value: fromCents(totalCents) },
            description: `ProdByBigi Cart (${enriched.length} item${enriched.length === 1 ? "" : "s"})`
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

    // Store one Firestore order
    const feeCents = Math.round(totalCents * 0.10);
    const producerNetCents = totalCents - feeCents;

    const orderRef = db.collection("orders").doc();
    await orderRef.set({
      type: "CART",
      producerId: String(producerId),
      items: enriched,
      amountCents: totalCents,
      feeCents,
      producerNetCents,
      paypalOrderId: payData.id,
      status: "CREATED",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
      // buyerId: buyerId || null
    });

    res.json({
      orderId: orderRef.id,
      paypalOrderId: payData.id,
      approveLinks: payData.links || []
    });
  } catch (e) {
    console.error("[cart-checkout]", e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

/**
 * POST /api/capture-order
 * Body: { orderId }
 * Auth: OPTIONAL, but recommended
 * - Captures PayPal order
 * - Credits producer wallet
 * - Marks order CAPTURED
 */
app.post("/api/capture-order", async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    const user = await getUserFromAuthHeader(req); // may be null

    const orderRef = db.collection("orders").doc(String(orderId));
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });

    const order = orderSnap.data() || {};
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

    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(orderRef);
      const o = fresh.data();
      if (!o || o.status === "CAPTURED") return;

      // If buyer logs in later, still save buyer on capture if missing
      const buyerId = o.buyerId || user?.uid || null;
      const buyerEmail = o.buyerEmail || user?.email || null;

      const walletRef = db.collection("wallets").doc(String(o.producerId));
      const walletSnap = await tx.get(walletRef);
      const prev = walletSnap.exists
        ? walletSnap.data()
        : { availableCents: 0, lifetimeEarnedCents: 0 };

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
        buyerId,
        buyerEmail
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
 * Auth REQUIRED: Authorization: Bearer <firebaseIdToken>
 * Returns buyer orders (CAPTURED)
 */
app.get("/api/my-orders", async (req, res) => {
  try {
    const user = await getUserFromAuthHeader(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const snap = await db
      .collection("orders")
      .where("buyerId", "==", user.uid)
      .where("status", "==", "CAPTURED")
      .orderBy("capturedAt", "desc")
      .limit(50)
      .get();

    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));

    res.json({ ok: true, orders: rows });
  } catch (e) {
    console.error("[my-orders]", e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

/**
 * GET /api/order-download?orderId=...
 * Auth REQUIRED
 * Returns the Cloudinary fullAudio url from beat doc
 */
app.get("/api/order-download", async (req, res) => {
  try {
    const user = await getUserFromAuthHeader(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const orderId = String(req.query.orderId || "");
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });

    const order = orderSnap.data() || {};
    if (order.status !== "CAPTURED") return res.status(403).json({ error: "Order not captured" });

    if (order.buyerId !== user.uid) return res.status(403).json({ error: "Not your order" });

    const beatRef = db.collection("beats").doc(String(order.beatId));
    const beatSnap = await beatRef.get();
    if (!beatSnap.exists) return res.status(404).json({ error: "Beat not found" });

    const beat = beatSnap.data() || {};

    // Your beat doc shows: fullAudio: "https://res.cloudinary.com/...."
    const url =
      beat.fullAudio ||
      beat.fullAudioUrl ||
      beat.audioFull ||
      beat.audioURL ||
      "";

    if (!url) return res.status(404).json({ error: "No downloadable file found (missing fullAudio)" });

    // Return JSON (frontend can open it)
    res.json({
      ok: true,
      beatId: String(order.beatId),
      orderId,
      licenseKey: order.licenseKey || null,
      url
    });
  } catch (e) {
    console.error("[order-download]", e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

app.listen(process.env.PORT || 8080, () => console.log("API running"));
