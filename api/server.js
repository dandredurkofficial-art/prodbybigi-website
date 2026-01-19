// /api/server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import admin from "firebase-admin";
import dotenv from "dotenv";
import { getAuth } from "firebase-admin/auth";

dotenv.config();

const app = express();

/**
 * CORS
 * - Set FRONTEND_ORIGIN in Render to: https://prodby.officialbigi.shop
 * - For testing you can allow all, but production should be strict.
 */
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || true;
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json());

// ---------- Firebase Admin ----------
// Render Secret File method:
// - Upload secret file named: firebase-service-account.json
// - Set env var: GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/firebase-service-account.json
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
  // support both names so you don't get "Missing PAYPAL_BASE"
  return (
    process.env.PAYPAL_BASE ||
    process.env.PAYPAL_BASE_URL ||
    ""
  );
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

// ---------- Auth (Firebase ID Token) ----------
async function requireUser(req) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (!token) throw new Error("Missing auth token");

  const decoded = await getAuth().verifyIdToken(token);
  return decoded; // { uid, email, ... }
}

// ---------- ROUTES ----------
app.get("/", (_, res) => res.send("API OK"));
app.get("/healthz", (_, res) => res.status(200).send("ok"));

/**
 * POST /api/create-order
 * Body: { beatId, licenseKey }
 *
 * Requires Authorization: Bearer <FIREBASE_ID_TOKEN>
 *
 * - Reads beat from Firestore
 * - Gets price from beat.licenses[licenseKey].price  (Option B)
 * - Creates PayPal order
 * - Saves order doc in Firestore INCLUDING buyerId
 * - Returns PayPal approve link
 */
app.post("/api/create-order", async (req, res) => {
  try {
    const user = await requireUser(req);

    const { beatId, licenseKey } = req.body || {};
    if (!beatId || !licenseKey) {
      return res.status(400).json({ error: "Missing beatId/licenseKey" });
    }

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

    // IMPORTANT: set SITE_URL in Render (your frontend domain)
    // Example: https://prodby.officialbigi.shop
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
        payData?.message ||
        payData?.details?.[0]?.description ||
        "PayPal order create failed"
      );
    }

    // 3) Store order in Firestore
    const feeCents = Math.round(amountCents * 0.10); // 10%
    const producerNetCents = amountCents - feeCents;

    const orderRef = db.collection("orders").doc();
    await orderRef.set({
      orderId: orderRef.id,

      // buyer
      buyerId: String(user.uid),
      buyerEmail: String(user.email || ""),

      // beat
      beatId: String(beatId),
      beatTitle: String(beat.title || "Beat"),

      // producer
      producerId: String(producerId),

      // pricing
      licenseKey: String(licenseKey),
      amountCents,
      feeCents,
      producerNetCents,

      // paypal
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
    const msg = String(e?.message || "Server error");
    const code = msg.toLowerCase().includes("auth token") ? 401 : 500;
    res.status(code).json({ error: msg });
  }
});

/**
 * POST /api/capture-order
 * Body: { orderId }
 *
 * - Captures PayPal order
 * - Credits producer wallet (net after fee)
 * - Writes wallet ledger
 * - Marks order CAPTURED
 */
app.post("/api/capture-order", async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

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

    // Credit wallet + ledger + mark order captured (transaction)
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(orderRef);
      const o = fresh.data();
      if (!o || o.status === "CAPTURED") return;

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
        paypalCaptureStatus: capData?.status || null,
        capturedAt: admin.firestore.FieldValue.serverTimestamp()
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
 * Requires Authorization: Bearer <FIREBASE_ID_TOKEN>
 * Returns the buyer's orders (purchases)
 */
app.get("/api/my-orders", async (req, res) => {
  try {
    const user = await requireUser(req);

    // NOTE: orderBy requires index if you add more where clauses, but here it's safe
    const snap = await db.collection("orders")
      .where("buyerId", "==", user.uid)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    const orders = [];
    snap.forEach((d) => orders.push({ orderId: d.id, ...d.data() }));

    res.json({ orders });
  } catch (e) {
    console.error("[my-orders]", e);
    const msg = String(e?.message || "Unauthorized");
    const code = msg.toLowerCase().includes("auth token") ? 401 : 500;
    res.status(code).json({ error: msg });
  }
});

/**
 * POST /api/order-download
 * Requires Authorization: Bearer <FIREBASE_ID_TOKEN>
 * Body: { orderId }
 *
 * Returns: { url }
 *
 * ⚠️ You must decide where the download URL comes from.
 * For now:
 *  - If the order has downloadUrl -> return it
 *  - Else try to read beat.downloadUrl or beat.files[licenseKey].url if present
 *  - If none exists -> tell you what to add
 */
app.post("/api/order-download", async (req, res) => {
  try {
    const user = await requireUser(req);
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    const orderRef = db.collection("orders").doc(String(orderId));
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });

    const order = orderSnap.data() || {};

    // buyer must own it
    if (String(order.buyerId || "") !== String(user.uid)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // must be completed
    if (order.status !== "CAPTURED") {
      return res.status(400).json({ error: "Order not completed" });
    }

    // 1) if already stored on order
    let url = order.downloadUrl || "";

    // 2) try beat document (if you store it there)
    if (!url) {
      const beatSnap = await db.collection("beats").doc(String(order.beatId)).get();
      if (beatSnap.exists) {
        const beat = beatSnap.data() || {};

        // common places you might store the file:
        // beat.downloadUrl OR beat.zipUrl OR beat.files[licenseKey].url
        url =
          beat.downloadUrl ||
          beat.zipUrl ||
          beat.fileUrl ||
          beat.files?.[order.licenseKey]?.url ||
          "";
      }
    }

    if (!url) {
      return res.status(501).json({
        error:
          "No download URL found. Add beat.downloadUrl (or beat.files[licenseKey].url) in Firestore."
      });
    }

    res.json({ url });
  } catch (e) {
    console.error("[order-download]", e);
    const msg = String(e?.message || "Unauthorized");
    const code = msg.toLowerCase().includes("auth token") ? 401 : 500;
    res.status(code).json({ error: msg });
  }
});

app.listen(process.env.PORT || 8080, () => console.log("API running"));
