// functions/index.js
// ✅ Fixed (without removing anything):
// - Added verifyFirebaseIdToken() helper (buyerId support)
// - Fixed applyCors(): now truly strict allowlist (no random origin reflection)
// - Removed incorrect "if (applyCors(req,res)) return;" usage (applyCors returns void)
// - createOrder(): stores buyerId (if Authorization token provided) into paypalOrders
// - processCartCapture(): writes buyerId into orders + unlocks (so buyer dashboard can query)
// - paypalWebhook(): writes buyerId for cart + single-beat when possible
// - captureOrder(): no change needed for webhook flow, but kept
// NOTE: This does NOT change your front-end success.html bug (you must fix that separately).

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

// ✅ Safe fetch: Node 20 has global fetch, fallback to node-fetch if needed
const fetchFn = global.fetch
  ? global.fetch
  : (...args) =>
      import("node-fetch").then(({ default: fetch }) => fetch(...args));

// ✅ Firebase Storage
const { getStorage } = require("firebase-admin/storage");

// ✅ Firestore triggers (v2)
const {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} = require("firebase-functions/v2/firestore");

// ✅ SendGrid
const sgMail = require("@sendgrid/mail");

admin.initializeApp({
  storageBucket: "audiory-beat-store.firebasestorage.app",
});

const db = admin.firestore();
const bucket = getStorage().bucket("audiory-beat-store.firebasestorage.app");

/* =========================================================
✅ SECRETS
========================================================= */
// Daraja (M-Pesa)
const DARAJA_CONSUMER_KEY = defineSecret("DARAJA_CONSUMER_KEY");
const DARAJA_CONSUMER_SECRET = defineSecret("DARAJA_CONSUMER_SECRET");
const MPESA_SHORTCODE = defineSecret("MPESA_SHORTCODE");
const MPESA_PASSKEY = defineSecret("MPESA_PASSKEY");
const MPESA_CALLBACK_URL = defineSecret("MPESA_CALLBACK_URL");
const PRICE_CURRENCY = defineSecret("PRICE_CURRENCY");
const USD_KES_RATE = defineSecret("USD_KES_RATE");

// SendGrid
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const SENDGRID_FROM = defineSecret("SENDGRID_FROM");
const ADMIN_NOTIFY_EMAIL = defineSecret("ADMIN_NOTIFY_EMAIL");

// PayPal
const PAYPAL_CLIENT_ID = defineSecret("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = defineSecret("PAYPAL_CLIENT_SECRET");
const PAYPAL_WEBHOOK_ID = defineSecret("PAYPAL_WEBHOOK_ID");
const PAYPAL_MODE = defineSecret("PAYPAL_MODE");

/* =========================================================
✅ PERMANENT CORS FIX (FOREVER)
========================================================= */
function applyCors(req, res) {
  const origin = req.headers.origin || "";

  // ✅ strict allowlist (recommended)
  const allowed = new Set([
    "https://audiory.site",
    "https://www.audiory.site",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ]);

  if (origin && allowed.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    // If no origin or unknown origin → default to your main domain
    res.set("Access-Control-Allow-Origin", "https://audiory.site");
  }

  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
}

function handleCorsPreflight(req, res) {
  if (req.method === "OPTIONS") {
    applyCors(req, res);
    return res.status(204).send("");
  }
  return null;
}

/* =========================================================
✅ HELPERS
========================================================= */
function safeStr(v) {
  return v === null || v === undefined ? "" : String(v);
}

function safeStr(v) {
  return (typeof v === "string" ? v : (v == null ? "" : String(v))).trim();
}

function termsFor(licenseKey) {

  if (licenseKey === "exclusive") {

    return [

      "Exclusive license: buyer receives exclusive rights to use the beat.",

      "Producer retains authorship credit unless transferred by written agreement.",

      "No resale/redistribution of the beat file itself.",

      "Must credit producer where applicable.",

    ];

  }

  if (licenseKey === "premium") {

    return [

      "Premium license: buyer may use the beat commercially.",

      "Non-exclusive: producer may license the beat to others.",

      "No resale/redistribution of the beat file itself.",

      "Must credit producer where applicable.",

    ];

  }

  return [

    "Basic license: buyer may use the beat under basic usage rights.",

    "Non-exclusive: producer may license the beat to others.",

    "No resale/redistribution of the beat file itself.",

    "Must credit producer where applicable.",

  ];

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

const crypto = require("crypto");
const { error } = require("console");

function toKey(x) {
  return String(x || "").trim().toLowerCase();
}

function toQty(n) {
  const q = Number(n || 1);
  return Number.isFinite(q) ? Math.max(1, Math.floor(q)) : 1;
}

async function getSoundKitDocById(id) {
  const tryCols = ["soundKits", "soundkits", "sound_kits", "kits"];
  for (const col of tryCols) {
    const snap = await db.collection(col).doc(String(id)).get();
    if (snap.exists) return { col, snap };
  }
  return null;
}

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

// Convert Firebase Storage download URL -> storage path
function storagePathFromDownloadUrl(url) {
  if (!url || typeof url !== "string") return null;
  const marker = "/o/";
  const i = url.indexOf(marker);
  if (i === -1) return null;

  const after = url.slice(i + marker.length);
  const beforeQ = after.split("?")[0];
  try {
    return decodeURIComponent(beforeQ);
  } catch {
    return beforeQ.replace(/%2F/g, "/");
  }
}

function defaultLicensePaths() {
  return {
    basic: "licenses/basic.pdf",
    premium: "licenses/premium.pdf",
    exclusive: "licenses/exclusive.pdf",
  };
}

async function ensureBeatFields(beatRef, beatData) {
  if (!beatData) return;

  const patch = {};

  if (!beatData.filePath) {
    const p = storagePathFromDownloadUrl(beatData.fullAudio || beatData.audio || "");
    if (p) patch.filePath = p;
  }

  if (!beatData.previewPath) {
    const pp = storagePathFromDownloadUrl(beatData.previewAudio || "");
    if (pp) patch.previewPath = pp;
  }

  if (!beatData.licensePaths || typeof beatData.licensePaths !== "object") {
    patch.licensePaths = defaultLicensePaths();
  } else {
    const d = defaultLicensePaths();
    const merged = { ...d, ...beatData.licensePaths };
    if (
      merged.basic !== beatData.licensePaths.basic ||
      merged.premium !== beatData.licensePaths.premium ||
      merged.exclusive !== beatData.licensePaths.exclusive
    ) {
      patch.licensePaths = merged;
    }
  }

  if (Object.keys(patch).length) {
    patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await beatRef.set(patch, { merge: true });
  }
}

async function verifyFirebaseIdToken(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) throw new Error("Missing Authorization token");
  const token = h.slice("Bearer ".length);
  return await admin.auth().verifyIdToken(token);
}

/* =========================================================
✅ AUTH: VERIFY FIREBASE ID TOKEN (buyerId support)
========================================================= */
async function verifyFirebaseIdToken(req) {
  try {
    const h = safeStr(req.headers.authorization || "");
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const token = m[1].trim();
    if (!token) return null;

    const decoded = await admin.auth().verifyIdToken(token);
    return decoded || null;
  } catch (_) {
    return null;
  }
}

/* =========================================================
✅ DOMAIN CONNECT HELPERS (Elite)
========================================================= */
function normDomain(d) {
  let s = String(d || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/\/.*$/, "");
  s = s.replace(/:\d+$/, "");
  if (s.startsWith("www.")) s = s.slice(4);
  return s;
}

function safeIdFromDomain(domain) {
  return String(domain || "").replace(/[^\w.-]/g, "_");
}

async function dohTxtLookup(name) {
  const endpoints = [
    "https://cloudflare-dns.com/dns-query",
    "https://dns.google/resolve",
  ];

  for (const base of endpoints) {
    try {
      const url = `${base}?name=${encodeURIComponent(name)}&type=TXT`;
      const r = await fetchFn(url, {
        method: "GET",
        headers: { accept: "application/dns-json" },
      });

      const j = await r.json().catch(() => ({}));
      const answers = Array.isArray(j.Answer) ? j.Answer : [];

      const txts = answers
        .filter((a) => a && a.type === 16 && typeof a.data === "string")
        .map((a) => a.data.replace(/^"|"$/g, "").replace(/\\"/g, '"'));

      if (txts.length) return txts;
    } catch (e) {
      // try next endpoint
    }
  }

  return [];
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

/* =========================================================
✅ DARAJA (M-PESA) — PRODUCTION (STK + C2B + B2C)
========================================================= */

// NEW SECRETS (add at top with your other secrets)
const MPESA_ENV = defineSecret("MPESA_ENV"); // "production" or "sandbox"
const MPESA_C2B_CONFIRMATION_URL = defineSecret("MPESA_C2B_CONFIRMATION_URL");
const MPESA_C2B_VALIDATION_URL = defineSecret("MPESA_C2B_VALIDATION_URL");

const B2C_INITIATOR_NAME = defineSecret("B2C_INITIATOR_NAME");
const B2C_SECURITY_CREDENTIAL = defineSecret("B2C_SECURITY_CREDENTIAL");
const B2C_RESULT_URL = defineSecret("B2C_RESULT_URL");
const B2C_TIMEOUT_URL = defineSecret("B2C_TIMEOUT_URL");

function darajaBase() {
  const env = safeStr(MPESA_ENV.value() || "production").toLowerCase().trim();
  return env === "sandbox" ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";
}

function oauthUrl() {
  return `${darajaBase()}/oauth/v1/generate?grant_type=client_credentials`;
}

function stkPushUrl() {
  return `${darajaBase()}/mpesa/stkpush/v1/processrequest`;
}

function c2bRegisterUrl() {
  return `${darajaBase()}/mpesa/c2b/v1/registerurl`;
}

function b2cPaymentUrl() {
  return `${darajaBase()}/mpesa/b2c/v1/paymentrequest`;
}

function normalizePhone(phone) {
  let p = safeStr(phone).trim().replace(/\s+/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "254" + p.slice(1);
  if (p.startsWith("7")) p = "254" + p;
  return p;
}

async function getAccessToken(consumerKey, consumerSecret) {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const res = await fetchFn(oauthUrl(), {
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
✅ PAYPAL HELPERS
========================================================= */
function paypalBaseUrl() {
  const mode = safeStr(PAYPAL_MODE.value() || "sandbox").toLowerCase().trim();
  return mode === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken() {
  const cid = PAYPAL_CLIENT_ID.value();
  const cs = PAYPAL_CLIENT_SECRET.value();
  if (!cid || !cs) throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET secret");

  const auth = Buffer.from(`${cid}:${cs}`).toString("base64");
  const res = await fetchFn(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PayPal OAuth failed: ${res.status} ${txt}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function verifyPayPalWebhookSignature(req) {
  const transmissionId =
    req.header("paypal-transmission-id") || req.header("PAYPAL-TRANSMISSION-ID");
  const transmissionTime =
    req.header("paypal-transmission-time") || req.header("PAYPAL-TRANSMISSION-TIME");
  const transmissionSig =
    req.header("paypal-transmission-sig") || req.header("PAYPAL-TRANSMISSION-SIG");
  const certUrl = req.header("paypal-cert-url") || req.header("PAYPAL-CERT-URL");
  const authAlgo = req.header("paypal-auth-algo") || req.header("PAYPAL-AUTH-ALGO");

  const webhookId = PAYPAL_WEBHOOK_ID.value();
  if (!webhookId) throw new Error("Missing PAYPAL_WEBHOOK_ID secret");
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    throw new Error("Missing PayPal signature headers");
  }

  const accessToken = await getPayPalAccessToken();

  const payload = {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: webhookId,
    webhook_event: req.body,
  };

  const res = await fetchFn(
    `${paypalBaseUrl()}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PayPal verify failed: ${res.status} ${txt}`);
  }

  const data = await res.json();
  return safeStr(data.verification_status).toUpperCase() === "SUCCESS";
}

function parseAmountFromPayPalEvent(event) {
  const resource = event?.resource || {};
  const amt = resource?.amount?.value;
  const cur = resource?.amount?.currency_code;
  if (amt && cur) return { value: Number(amt), currency: String(cur) };

  const pu = resource?.purchase_units?.[0];
  const orderAmt = pu?.amount?.value;
  const orderCur = pu?.amount?.currency_code;
  if (orderAmt && orderCur) return { value: Number(orderAmt), currency: String(orderCur) };

  return { value: 0, currency: "USD" };
}

async function creditProducerWallet({
  producerId,
  orderId,
  grossAmount,
  currency,
  source,
  revenueId, // ✅ optional: unique revenue doc id per cart item
}) {
  const gross = Number(grossAmount || 0);
  const fee = Math.round(gross * 0.10 * 100) / 100;
  const net = Math.round((gross - fee) * 100) / 100;

  const producerRef = db.collection("users").doc(producerId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(producerRef);
    if (!snap.exists) throw new Error("Producer profile missing");

    tx.set(
      producerRef,
      {
        availableBalance: admin.firestore.FieldValue.increment(net),
        walletUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const revDocId = safeStr(revenueId || orderId);
    const revRef = db.collection("platformRevenue").doc(revDocId);
    tx.set(
      revRef,
      {
        revenueId: revDocId,
        orderId,
        producerId,
        gross,
        fee,
        net,
        currency: currency || "USD",
        source: source || "paypal",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return { gross, fee, net };
}

exports.testEmail = onRequest(
  {
    region: "us-central1",
    secrets: [SENDGRID_API_KEY, SENDGRID_FROM, ADMIN_NOTIFY_EMAIL],
  },
  async (req, res) => {
    const stop = handleCorsPreflight(req, res);
    if (stop) return;
    applyCors(req, res);

    try {
      const to =
        (req.query?.to ? String(req.query.to) : "") || ADMIN_NOTIFY_EMAIL.value();
      if (!to) return res.status(400).json({ error: "Missing to" });

      await sendEmail({
        to,
        subject: "✅ Audiory SendGrid Test",
        text: "If you received this, SendGrid is working.",
        html: "<h2>✅ Audiory SendGrid Test</h2><p>If you received this, SendGrid is working.</p>",
      });

      return res.json({ ok: true, sentTo: to, from: SENDGRID_FROM.value() });
    } catch (e) {
      console.error("testEmail error:", e?.message || e);
      if (e?.response?.body) console.error("SendGrid body:", e.response.body);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

exports.verifySubscription = onRequest(
  {
    region: "us-central1",
    maxInstances: 1,
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE],
  },
  async (req, res) => {
    const pre = handleCorsPreflight(req, res);
    if (pre) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

      const { subscriptionId, uid } = req.body || {};
      if (!subscriptionId) return res.status(400).json({ error: "subscriptionId is required" });
      if (!uid) return res.status(400).json({ error: "uid is required" });

      // Always verify against PayPal API (LIVE if PAYPAL_MODE=live)
      const accessToken = await getPayPalAccessToken();

      const r = await fetchFn(`${paypalBaseUrl()}/v1/billing/subscriptions/${subscriptionId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(400).json({ error: data?.message || "PayPal verify failed", details: data });
      }

      const status = String(data.status || "").toLowerCase(); // ACTIVE, SUSPENDED, CANCELLED...
      const planId = String(data.plan_id || "").trim();

      // Map PayPal plan_id -> planTier
      const PLAN_MAP = {
        "P-6N459415976946710NGJZWKI": "starter",
        "P-74D41012PM804561FNGJZ7UQ": "pro",
        "P-0KG19158TD0563439NGJ2EIQ": "elite",
      };

      const planTier = PLAN_MAP[planId] || "free";
      const isActive = status === "active";

      // Update Firestore user
      await db.collection("users").doc(uid).set(
        {
          plan: isActive ? planTier : "free",
          planTier: isActive ? planTier : "free",
          subscriptionStatus: status || "unknown",
          paypalSubscriptionId: subscriptionId,
          paypalPlanId: planId,
          planUpdatedAt: Date.now(),
        },
        { merge: true }
      );

      return res.json({
        ok: true,
        status,
        planId,
        planTier: isActive ? planTier : "free",
      });
    } catch (e) {
      console.error("verifySubscription error:", e);
      try { applyCors(req, res); } catch (_) {}
      return res.status(500).json({ error: e.message });
    }
  }
);

/* =========================================================
✅ DOMAIN CONNECT (Elite) - HTTP FUNCTIONS
========================================================= */
exports.createDomainChallenge = onRequest(
  {
    region: "us-central1",
    secrets: [], // no secrets needed
  },
  async (req, res) => {
    const pre = handleCorsPreflight(req, res);
    if (pre) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

      const { uid, domain } = req.body || {};
      if (!uid) return res.status(400).json({ error: "uid is required" });
      if (!domain) return res.status(400).json({ error: "domain is required" });

      const d = normDomain(domain);
      if (!d.includes(".")) return res.status(400).json({ error: "Invalid domain" });

      const token = `audiory-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

      await db.collection("users").doc(uid).set(
        {
          customDomain: d,
          customDomainStatus: "pending_dns",
          customDomainToken: token,
          customDomainUpdatedAt: Date.now(),
        },
        { merge: true }
      );

      await db.collection("domainRequests").doc(`${uid}__${safeIdFromDomain(d)}`).set(
        {
          uid,
          domain: d,
          token,
          status: "pending_dns",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      return res.json({
        ok: true,
        domain: d,
        token,
        dns: {
          txt: { host: `_audiory-verify.${d}`, value: token },
          cname_www: { host: `www.${d}`, value: "audiory.site" },
          cname_apex: { host: d, value: "audiory.site" },
        },
      });
    } catch (e) {
      console.error("createDomainChallenge:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

exports.verifyDomainDns = onRequest(
  {
    region: "us-central1",
    secrets: [], // no secrets needed
  },
  async (req, res) => {
    const pre = handleCorsPreflight(req, res);
    if (pre) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

      const { uid, domain } = req.body || {};
      if (!uid) return res.status(400).json({ error: "uid is required" });
      if (!domain) return res.status(400).json({ error: "domain is required" });

      const d = normDomain(domain);

      const usnap = await db.collection("users").doc(uid).get();
      if (!usnap.exists) return res.status(404).json({ error: "User not found" });

      const u = usnap.data() || {};
      const expected = String(u.customDomainToken || "").trim();
      if (!expected) return res.status(400).json({ error: "No token found. Create challenge first." });
      if (normDomain(u.customDomain || "") !== d) return res.status(400).json({ error: "Domain mismatch. Save the same domain first." });

      const txtHost = `_audiory-verify.${d}`;
      const txts = await dohTxtLookup(txtHost);
      const ok = txts.some((v) => String(v || "").includes(expected));

      if (!ok) {
        return res.status(200).json({
          ok: false,
          reason: "TXT_NOT_FOUND",
          checked: txtHost,
          got: txts,
        });
      }

      await db.collection("domains").doc(safeIdFromDomain(d)).set(
        {
          domain: d,
          uid,
          verified: true,
          verifiedAt: Date.now(),
        },
        { merge: true }
      );

      await db.collection("users").doc(uid).set(
        {
          customDomain: d,
          customDomainVerified: true,
          customDomainStatus: "verified",
          customDomainVerifiedAt: Date.now(),
        },
        { merge: true }
      );

      return res.json({ ok: true, domain: d });
    } catch (e) {
      console.error("verifyDomainDns:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

/* =========================================================
✅ CREATE PAYPAL ORDER (THIS IS THE ONE YOUR WEBSITE CALLS)
POST /createOrder
body: { beatId, licenseKey } OR { items:[{beatId,licenseKey,qty}] }
========================================================= */
exports.createOrder = onRequest(
  {
    region: "us-central1",
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE],
  },
  async (req, res) => {
    const pre = handleCorsPreflight(req, res);
    if (pre) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

      // ✅ If buyer is logged in, keep buyerId for orders dashboard
      const decoded = await verifyFirebaseIdToken(req);
      const buyerId = safeStr(decoded?.uid || "");

      const body = req.body || {};
      const hasCart = Array.isArray(body.items) && body.items.length > 0;

      // ✅ Accept either single item or cart items
      let rawItems = [];
      if (hasCart) {
        rawItems = body.items;
      } else {
        const beatId = body.beatId;
        const licenseKey = body.licenseKey;
        if (!beatId || !licenseKey) {
          return res.status(400).json({ error: "beatId and licenseKey are required" });
        }
        rawItems = [{ beatId, licenseKey, qty: 1 }];
      }

      // ✅ Normalize incoming items (DON'T trust price from client)
      const incoming = rawItems
        .map((it) => ({
          beatId: String(it.beatId || "").trim(),
          licenseKey: toKey(it.licenseKey || ""),
          qty: toQty(it.qty || 1),
        }))
        .filter((it) => it.beatId && it.licenseKey);

      if (!incoming.length) {
        return res.status(400).json({ error: "Cart is empty or invalid items" });
      }

      // ✅ Resolve each item price & metadata from Firestore
      const resolved = [];
      for (const it of incoming) {
        // Sound kit item
        if (it.licenseKey === "soundkit" || it.licenseKey === "kit") {
          const kitFound = await getSoundKitDocById(it.beatId);
          if (!kitFound) return res.status(404).json({ error: `Sound kit not found: ${it.beatId}` });

          const kit = kitFound.snap.data() || {};
          const price = Number(kit.price ?? 0);

          if (!Number.isFinite(price) || price < 0) {
            return res.status(400).json({ error: `Invalid kit price: ${it.beatId}` });
          }

          resolved.push({
            type: "soundkit",
            id: it.beatId,
            licenseKey: "soundkit",
            title: safeStr(kit.title || kit.name || "Sound Kit"),
            unitPrice: price,
            qty: it.qty,
            producerId: safeStr(kit.producerId || ""),
          });

          continue;
        }

        // Beat item
        const beatSnap = await db.collection("beats").doc(String(it.beatId)).get();
        if (!beatSnap.exists) return res.status(404).json({ error: `Beat not found: ${it.beatId}` });

        const beat = beatSnap.data() || {};
        const producerId = safeStr(beat.producerId || "");

        const lic = beat.licenses || {};
        const selected = lic?.[it.licenseKey] || {};
        const price = Number(selected.price ?? beat.price ?? 0);

        if (!Number.isFinite(price) || price <= 0) {
          return res.status(400).json({ error: `Invalid price for ${it.beatId} (${it.licenseKey})` });
        }

        resolved.push({
          type: "beat",
          id: it.beatId,
          licenseKey: it.licenseKey,
          title: safeStr(beat.title || "Beat"),
          unitPrice: price,
          qty: it.qty,
          producerId,
        });
      }

      // ✅ Calculate total
      const total = resolved.reduce((sum, x) => sum + x.unitPrice * x.qty, 0);
      if (!Number.isFinite(total) || total <= 0) {
        return res.status(400).json({ error: "Cart total invalid" });
      }

      const accessToken = await getPayPalAccessToken();

      // ✅ Save full cart in Firestore so webhook/capture can verify later
      const cartId = crypto.randomUUID();
      await db.collection("paypalOrders").doc(cartId).set({
        createdAt: Date.now(),
        items: resolved,
        total: Number(total.toFixed(2)),
        currency: "USD",
        mode: safeStr(PAYPAL_MODE.value() || "sandbox"),
        status: "created",
        buyerId: buyerId || null, // ✅ NEW
      });

      // ✅ Put only the cartId in PayPal custom_id
      const customId = `cartId=${cartId}`;

      const payload = {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: cartId,
            custom_id: customId,
            amount: {
              currency_code: "USD",
              value: total.toFixed(2),
            },
            description: `Audiory Cart (${resolved.length} item${resolved.length > 1 ? "s" : ""})`,
          },
        ],
        application_context: {
          brand_name: "Audiory",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          landing_page: "BILLING", // you set BILLING; keep it
          return_url: "https://audiory.site/success.html",
          cancel_url: "https://audiory.site/cancel.html",
        },
      };

      const r = await fetchFn(`${paypalBaseUrl()}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        return res.status(400).json({
          error: data?.message || "PayPal create order failed",
          details: data,
        });
      }

      const approve =
        (data.links || []).find((l) => l.rel === "approve") ||
        (data.links || []).find((l) => l.rel === "payer-action");

      // update cart doc with paypal order id
      await db.collection("paypalOrders").doc(cartId).set(
        {
          paypalOrderId: safeStr(data.id),
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      return res.json({
        orderId: data.id,
        approveLinks: data.links || [],
        approveUrl: approve?.href || null,
        cartId,
        mode: safeStr(PAYPAL_MODE.value() || "sandbox"),
      });
    } catch (e) {
      console.error("createOrder error:", e);
      try { applyCors(req, res); } catch (_) {}
      return res.status(500).json({ error: e.message });
    }
  }
);

exports.captureOrder = onRequest(
  {
    region: "us-central1",
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE],
  },
  async (req, res) => {
    const pre = handleCorsPreflight(req, res);
    if (pre) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST")
        return res.status(405).json({ error: "Use POST" });

      const { orderId, cartId } = req.body || {};
      if (!orderId) return res.status(400).json({ error: "orderId is required" });

      const accessToken = await getPayPalAccessToken();

      const r = await fetchFn(
        `${paypalBaseUrl()}/v2/checkout/orders/${orderId}/capture`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        return res
          .status(400)
          .json({ error: data?.message || "Capture failed", details: data });
      }

      /**
       * ✅ IMPORTANT:
       * After capture, we process Firestore writes (orders + unlocks).
       * We need cartId to do that (paypalOrders/{cartId}).
       *
       * If your front-end DOES NOT send cartId to captureOrder yet,
       * then processCartCapture will throw "Cart not found".
       *
       * Make sure your capture call includes { orderId, cartId }.
       */
      if (cartId) {
        await processCartCapture({ cartId: String(cartId), captureEvent: data, orderId });
      } else {
        console.warn("[captureOrder] cartId missing in request body. Skipping processCartCapture.");
      }

      return res.json({ ok: true, data });
    } catch (e) {
      console.error("captureOrder error:", e);
      applyCors(req, res);
      return res.status(500).json({ error: e.message });
    }
  }
);

async function processCartCapture({ cartId, captureEvent, orderId }) {
  const cartRef = db.collection("paypalOrders").doc(cartId);
  const cartSnap = await cartRef.get();
  if (!cartSnap.exists) throw new Error("Cart not found in paypalOrders");

  const cart = cartSnap.data() || {};
  const items = Array.isArray(cart.items) ? cart.items : [];
  if (!items.length) throw new Error("Cart has no items");

  // ✅ ADD
  const buyerId = safeStr(cart.buyerId || "");

  const resource = captureEvent?.resource || {};
  const payerEmail = safeStr(resource?.payer?.email_address || "");

  // Idempotency: only process once
  const processedRef = db.collection("paypalOrderCaptures").doc(orderId);
  const already = await processedRef.get();
  if (already.exists) return { ok: true, alreadyProcessed: true };

  const { value, currency } = parseAmountFromPayPalEvent(captureEvent);

  // Save main order doc
  const orderRef = db.collection("orders").doc(orderId);

  // ✅ UPDATED (adds buyerId)
  await orderRef.set(
    {
      orderId,
      provider: "paypal",
      type: "cart",
      cartId,
      providerEventId: safeStr(captureEvent?.id),
      providerCaptureId: safeStr(resource?.id),
      providerStatus: safeStr(resource?.status),
      amount: Number(value || cart.total || 0),
      currency: currency || cart.currency || "USD",

      buyerId: buyerId || null, // ✅ ADD
      status: "PAID",

      payerEmail,
      items,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // mark capture processed first (prevents double-processing on retries)
  await processedRef.set({
    orderId,
    cartId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // unlock + credit per item
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const type = safeStr(it.type);
    const id = safeStr(it.id);
    const licenseKey = safeStr(it.licenseKey || "");
    const qty = toQty(it.qty || 1);
    const producerId = safeStr(it.producerId || "");

    const lineTotal = Number(it.unitPrice || 0) * qty;
    const unlockId = `${orderId}__${type}__${id}__${licenseKey}__${i}`;
    const unlockRef = db.collection("unlocks").doc(unlockId);

    // ✅ ADD: fetch beat data for downloads (only if type === "beat")
    let beatData = null;
    if (type === "beat" && id) {
      const beatSnap = await db.collection("beats").doc(String(id)).get();
      if (beatSnap.exists) beatData = beatSnap.data() || null;
    }

    const downloadPath =
      safeStr(it.downloadPath || "") ||
      beatData?.downloadPath ||
      beatData?.filePath ||
      null;

    const audioUrl =
      safeStr(it.audioUrl || "") ||
      beatData?.audio ||
      null;

    // ✅ UPDATED unlock doc (adds buyerId, producerId, downloadPath, audioUrl, status)
    await unlockRef.set(
      {
        unlockId,
        orderId,
        cartId,
        provider: "paypal",
        type,

        buyerId: buyerId || null, // ✅ ADD
        producerId: producerId || beatData?.producerId || null, // ✅ ADD

        beatId: type === "beat" ? id : null,
        kitId: type === "soundkit" ? id : null,
        licenseKey: licenseKey || null,

        downloadPath, // ✅ ADD
        audioUrl,     // ✅ ADD

        qty,
        amount: lineTotal,
        receipt: safeStr(resource?.id),
        payerEmail,
        transactionDate: Date.now(),
        status: "unlocked", // ✅ ADD (optional but helpful)

        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // credit producer (idempotent per unlock)
    if (producerId) {
      const creditMarkerRef = db.collection("walletCredits").doc(unlockId);
      const marker = await creditMarkerRef.get();
      if (!marker.exists) {
        await creditProducerWallet({
          producerId,
          orderId,
          grossAmount: lineTotal,
          currency: currency || cart.currency || "USD",
          source: "paypal",
          revenueId: unlockId,
        });
        await creditMarkerRef.set({
          unlockId,
          orderId,
          cartId,
          producerId,
          grossAmount: lineTotal,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  }

  // update cart doc status
  await cartRef.set(
    {
      status: "paid",
      paidAt: Date.now(),
      orderId,
      payerEmail,
      updatedAt: Date.now(),
    },
    { merge: true }
  );

  return { ok: true };
}

/* =========================================================
✅ PAYPAL WEBHOOK
========================================================= */
exports.paypalWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_MODE],
  },
  async (req, res) => {
    const stop = handleCorsPreflight(req, res);
    if (stop) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") return res.status(405).send("Use POST");

      const ok = await verifyPayPalWebhookSignature(req);
      if (!ok) return res.status(401).send("Invalid signature");

      const event = req.body || {};
      const eventType = safeStr(event.event_type).trim();
      const resource = event.resource || {};
      const resourceId = safeStr(resource.id || event.id);

      await db
        .collection("paypalWebhooks")
        .doc(safeStr(event.id || resourceId || String(Date.now())))
        .set(
          {
            eventType,
            resourceId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            raw: event,
          },
          { merge: true }
        );

      if (eventType !== "PAYMENT.CAPTURE.COMPLETED") {
        return res.status(200).json({ received: true, ignored: eventType });
      }

      const { value, currency } = parseAmountFromPayPalEvent(event);

      const customId =
        safeStr(resource?.custom_id) ||
        safeStr(resource?.invoice_id) ||
        safeStr(resource?.supplementary_data?.related_ids?.order_id) ||
        "";

      const meta = {};
      if (customId) {
        // supports both: "cartId=xxx" and old "beatId=..|licenseKey=..|producerId=.."
        customId.split("|").forEach((part) => {
          const [k, ...rest] = part.split("=");
          const key = safeStr(k).trim();
          const val = safeStr(rest.join("=")).trim();
          if (key) meta[key] = val;
        });
        // if it's "cartId=xxx" only, this still works
        if (customId.includes("cartId=") && !meta.cartId) {
          meta.cartId = safeStr(customId.split("cartId=")[1] || "").trim();
        }
      }

      const orderId = `pp_${safeStr(resource.id || event.id || Date.now())}`;

      // ✅ 1) CART FLOW
      const cartId = safeStr(meta.cartId || "");
      if (cartId) {
        await processCartCapture({ cartId, captureEvent: event, orderId });
        return res.status(200).json({ received: true, eventType, cart: true });
      }

      // ✅ 2) OLD SINGLE-BEAT FLOW (backward compatible)
      const beatId = safeStr(meta.beatId || meta.beat || "");
      const licenseKey = safeStr(meta.licenseKey || "basic").toLowerCase().trim();
      let producerId = safeStr(meta.producerId || meta.producer || "");

      if (beatId && !producerId) {
        const beatSnap = await db.collection("beats").doc(beatId).get();
        if (beatSnap.exists) producerId = safeStr(beatSnap.data()?.producerId || "");
      }

      const orderRef = db.collection("orders").doc(orderId);
      const existing = await orderRef.get();

      if (!existing.exists) {
        await orderRef.set({
          orderId,
          provider: "paypal",
          type: "single",
          providerEventId: safeStr(event.id),
          providerCaptureId: safeStr(resource.id),
          providerStatus: safeStr(resource.status),
          beatId: beatId || null,
          producerId: producerId || null,
          licenseKey: licenseKey || null,
          amount: Number(value || 0),
          currency: currency || "USD",
          status: "PAID",
          payerEmail: safeStr(resource?.payer?.email_address),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          raw: event,
        });
      } else {
        await orderRef.set(
          {
            providerStatus: safeStr(resource.status),
            status: "PAID",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (beatId && producerId) {
        const unlockId = `${orderId}__beat__${beatId}__${licenseKey}`;
        await db.collection("unlocks").doc(unlockId).set(
          {
            unlockId,
            orderId,
            beatId,
            kitId: null,
            type: "beat",
            licenseKey,
            phone: null,
            amount: Number(value || 0),
            receipt: safeStr(resource.id),
            transactionDate: Date.now(),
            checkoutRequestId: null,
            provider: "paypal",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        // idempotent credit marker
        const markerRef = db.collection("walletCredits").doc(unlockId);
        const marker = await markerRef.get();
        if (!marker.exists) {
          await creditProducerWallet({
            producerId,
            orderId,
            grossAmount: Number(value || 0),
            currency,
            source: "paypal",
            revenueId: unlockId,
          });
          await markerRef.set({
            unlockId,
            orderId,
            producerId,
            grossAmount: Number(value || 0),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      return res.status(200).json({ received: true, eventType });
    } catch (e) {
      console.error("paypalWebhook error:", e);
      try { applyCors(req, res); } catch (_) {}
      return res.status(500).json({ error: e.message });
    }
  }
);

/* =========================================================
✅ PAYPAL PAYOUT TRIGGER
========================================================= */
exports.onPaypalPayoutRequest = onDocumentCreated(
  {
    region: "us-central1",
    document: "payouts/{payoutId}",
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE],
  },
  async (event) => {
    try {
      const payoutId = event.params.payoutId;
      const data = event.data?.data() || {};

      const method = safeStr(data.method || data.withdrawMethod || "").toLowerCase().trim();
      if (method !== "paypal") return;

      const producerId = safeStr(data.producerId);
      const destination = safeStr(data.destination || data.email || data.paypalEmail).trim();
      const amount = Number(data.amount || 0);

      const producerRef = db.collection("users").doc(producerId);
      const payoutRef = db.collection("payouts").doc(payoutId);

      if (!producerId || !destination || !amount || amount <= 0) {
        await payoutRef.set(
          {
            status: "FAILED",
            error: "Missing producerId/destination/amount",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return;
      }

      let newBalance = 0;

      await db.runTransaction(async (tx) => {
        const pSnap = await tx.get(producerRef);
        if (!pSnap.exists) throw new Error("Producer profile missing");
        const prof = pSnap.data() || {};
        const bal = Number(
          prof.availableBalance ?? prof.walletBalance ?? prof.balance ?? prof.wallet ?? 0
        );

        if (!isFinite(bal) || bal < amount) throw new Error("Insufficient balance");
        newBalance = Math.round((bal - amount) * 100) / 100;

        tx.set(
          payoutRef,
          {
            status: "PROCESSING",
            provider: "paypal",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        tx.set(
          producerRef,
          {
            availableBalance: admin.firestore.FieldValue.increment(-amount),
            walletUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      const accessToken = await getPayPalAccessToken();

      const payoutPayload = {
        sender_batch_header: {
          sender_batch_id: `audiory_${payoutId}_${Date.now()}`,
          email_subject: "You have a payout from Audiory",
          email_message: "Your Audiory payout has been sent. Thank you for using Audiory!",
        },
        items: [
          {
            recipient_type: "EMAIL",
            amount: { value: amount.toFixed(2), currency: "USD" },
            receiver: destination,
            note: "Audiory producer withdrawal",
            sender_item_id: payoutId,
          },
        ],
      };

      const r = await fetchFn(`${paypalBaseUrl()}/v1/payments/payouts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payoutPayload),
      });

      const respText = await r.text();
      let respJson = {};
      try {
        respJson = JSON.parse(respText);
      } catch (_) {
        respJson = { raw: respText };
      }

      if (!r.ok) {
        // rollback wallet
        await db.runTransaction(async (tx) => {
          tx.set(producerRef, { availableBalance: admin.firestore.FieldValue.increment(amount) }, { merge: true });
          tx.set(
            payoutRef,
            {
              status: "FAILED",
              error: `PayPal payout failed: ${r.status} ${safeStr(respText)}`.slice(0, 1000),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        });
        return;
      }

      await payoutRef.set(
        {
          status: "SUBMITTED",
          paypalBatchId: safeStr(respJson?.batch_header?.payout_batch_id),
          paypalResponse: respJson,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          balanceAfter: newBalance,
        },
        { merge: true }
      );
    } catch (e) {
      console.error("onPaypalPayoutRequest error:", e);
      const payoutId = event.params.payoutId;
      try {
        await db.collection("payouts").doc(payoutId).set(
          {
            status: "FAILED",
            error: safeStr(e.message || e).slice(0, 1000),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } catch (_) {}
    }
  }
);

/* =========================================================
✅ OPTIONAL: payout status (manual)
========================================================= */
exports.paypalPayoutStatus = onRequest(
  {
    region: "us-central1",
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE],
  },
  async (req, res) => {
    const stop = handleCorsPreflight(req, res);
    if (stop) return;
    applyCors(req, res);

    try {
      const payoutBatchId = safeStr(req.query?.payoutBatchId).trim();
      if (!payoutBatchId) return res.status(400).json({ error: "payoutBatchId is required" });

      const accessToken = await getPayPalAccessToken();
      const r = await fetchFn(`${paypalBaseUrl()}/v1/payments/payouts/${payoutBatchId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const txt = await r.text();
      let j = {};
      try { j = JSON.parse(txt); } catch (_) { j = { raw: txt }; }

      return res.status(r.ok ? 200 : 400).json(j);
    } catch (e) {
      console.error("paypalPayoutStatus error:", e);
      try { applyCors(req, res); } catch (_) {}
      return res.status(500).json({ error: e.message });
    }
  }
);

/* =========================================================
✅ STK PUSH (M-PESA)
========================================================= */
exports.stkpush = onRequest(
  {
    region: "us-central1",
    maxInstances: 1,
    secrets: [
      DARAJA_CONSUMER_KEY,
      DARAJA_CONSUMER_SECRET,
      MPESA_SHORTCODE,
      MPESA_PASSKEY,
      MPESA_CALLBACK_URL,
      PRICE_CURRENCY,
      USD_KES_RATE,
    ],
  },
  async (req, res) => {
    const stop = handleCorsPreflight(req, res);
    if (stop) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST")
        return res.status(405).json({ error: "Use POST" });

    const { phone, amount, amountUsd, beatId, buyerId } = req.body || {};
    if (!buyerId) return res.status(400).json({ error: "buyerId is required" });
    const inputAmountUsd = amountUsd ?? amount;

    if (!phone || inputAmountUsd == null || !beatId) {
      return res.status(400).json({ error: "phone, amount/amountUsd, and beatId are required" });
    }

    const msisdn = normalizePhone(phone);

    // ✅ FIX: use ONE variable name (usd)
    const usd = Number(inputAmountUsd);
    if (!Number.isFinite(usd) || usd <= 0) {
      return res.status(400).json({ error: "amountUsd invalid" });
    }

    const currency = String(PRICE_CURRENCY.value() || "USD").toUpperCase();

    // ✅ Get rate from secret (string -> number)
    const rate = Number(USD_KES_RATE.value() || 0);
    if (currency === "USD" && (!Number.isFinite(rate) || rate <= 0)) {
    return res.status(500).json({ error: "USD_KES_RATE is missing/invalid" });
    }

    // ✅ Convert to integer KES (Mpesa needs integer)
    const kes = currency === "USD"
      ? Math.max(1, Math.round(usd * rate))
      : Math.max(1, Math.round(usd));

    // ✅ FIX: this condition was wrong + you used req.status
    if (!Number.isFinite(kes) || kes <= 0) {
      return res.status(400).json({ error: "KES amount invalid" });
    }

    const orderRef = db.collection("orders").doc();
    await orderRef.set({
      beatId,
      buyerId,
      phone: msisdn,
      amountUsd: usd,
      currency: currency,
      amountKes: kes,
      provider: "MPESA_STK",
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
      Amount: kes,
      PartyA: msisdn,
      PartyB: Number(MPESA_SHORTCODE.value()),
      PhoneNumber: msisdn,
      CallBackURL: MPESA_CALLBACK_URL.value(),
      AccountReference: orderRef.id,
      TransactionDesc: `Beat ${beatId}`,
    };

    const r = await fetchFn(stkPushUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));

    await orderRef.set(
      {
        checkoutRequestId: data.CheckoutRequestID || null,
        merchantRequestId: data.MerchantRequestID || null,
        stkResponse: data,
        mpesaRequestedAmount: kes,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return res.status(r.ok ? 200 : 400).json({
      ok: r.ok, 
      orderId: orderRef.id, 
      amountUsd: usd,
      amountKes: kes,
      currency,

      ...data 
    });
  } catch (e) {
    console.error("stkpush error:", e);
    try { 
      applyCors(req, res); 
    } catch (_) {}
    return res.status(500).json({ error: e.message });
  }
});

// Callback endpoint
exports.stkCallback = onRequest({ region: "us-central1" }, async (req, res) => {
  const stop = handleCorsPreflight(req, res);
  if (stop) return;
  applyCors(req, res);

  try {
    // callback is Safaricom -> no browser, but safe
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
          paidAt: paid ? admin.firestore.FieldValue.serverTimestamp() : null,
          amountKesPaid: metadata.Amount || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      if (paid) {
        // ✅ get order fields
        const o = orderDoc.data() || {};
        const beatId = o.beatId;
        const buyerId = o.buyerId || null;
        const licenseKey = o.licenseKey || "basic";
        const producerId = o.producerId || null;

        // ✅ fetch beat to get download info (adjust collection name if yours differs)
        let beatData = null;
        if (beatId) {
          const beatSnap = await db.collection("beats").doc(String(beatId)).get();
          if (beatSnap.exists) beatData = beatSnap.data() || null;
        }

        // ✅ IMPORTANT:
        // Store a REAL download reference, not "/beat/?id=..."
        // Prefer downloadPath (Storage path) if you have it.
        const downloadPath =
          o.downloadPath ||
          beatData?.downloadPath ||                // recommended field if you store it
          beatData?.filePath ||                    // fallback
          null;

        const audioUrl =
          o.audioUrl ||
          beatData?.audio ||                        // if this is a direct downloadable URL
          null;

        await db.collection("unlocks").doc(orderDoc.id).set({
          unlockId: orderDoc.id,
          orderId: orderDoc.id,

          buyerId,
          beatId: beatId || null,
          producerId: producerId || beatData?.producerId || null,
          licenseKey,

          phone: metadata.PhoneNumber || null,
          amountKes: metadata.Amount || null,
          receipt: metadata.MpesaReceiptNumber || null,
          transactionDate: metadata.TransactionDate || null,
          checkoutRequestId: CheckoutRequestID,

          // ✅ these two are what your dashboard needs:
          downloadPath,     // best: storage path → later you sign it
          audioUrl,         // optional: if audio is already a direct downloadable URL

          status: "unlocked",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        // also mark order unlocked (optional but cleaner)
        await orderDoc.ref.set({
          unlocked: true,
          unlockedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, 
        { merge: true });
      };
    }

    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("stkCallback error:", err);
    return res.json({ ResultCode: 0 });
  }
});

// Run once after deploy to register URLs
exports.c2bRegister = onRequest(
  {
    region: "us-central1",
    secrets: [
      DARAJA_CONSUMER_KEY,
      DARAJA_CONSUMER_SECRET,
      MPESA_SHORTCODE,
      MPESA_C2B_CONFIRMATION_URL,
      MPESA_C2B_VALIDATION_URL,
      MPESA_ENV,
    ],
  },
  async (req, res) => {
    const stop = handleCorsPreflight(req, res);
    if (stop) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

      const token = await getAccessToken(
        DARAJA_CONSUMER_KEY.value(),
        DARAJA_CONSUMER_SECRET.value()
      );

      const payload = {
        ShortCode: String(MPESA_SHORTCODE.value()),
        ResponseType: "Completed",
        ConfirmationURL: MPESA_C2B_CONFIRMATION_URL.value(),
        ValidationURL: MPESA_C2B_VALIDATION_URL.value(),
      };

      const r = await fetchFn(c2bRegisterUrl(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await r.json().catch(() => ({}));
      return res.status(r.ok ? 200 : 400).json({ ok: r.ok, ...data, sent: payload });
    } catch (e) {
      console.error("c2bRegister error:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

// Safaricom calls this BEFORE accepting C2B payment
exports.c2bValidation = onRequest({ region: "us-central1" }, async (req, res) => {
  try {
    await db.collection("mpesaC2BValidation").add({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      raw: req.body || null,
    });

    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (e) {
    console.error("c2bValidation error:", e);
    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
});

// Safaricom calls this AFTER payment is completed
exports.c2bConfirmation = onRequest({ region: "us-central1" }, async (req, res) => {
  try {
    const data = req.body || {};
    await db.collection("mpesaC2BPayments").doc(safeStr(data.TransID || crypto.randomUUID())).set(
      {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        transId: safeStr(data.TransID),
        amount: Number(data.TransAmount || 0),
        msisdn: safeStr(data.MSISDN),
        billRefNumber: safeStr(data.BillRefNumber),
        transTime: safeStr(data.TransTime),
        raw: data,
      },
      { merge: true }
    );

    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (e) {
    console.error("c2bConfirmation error:", e);
    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
});

exports.b2cPay = onRequest(
  {
    region: "us-central1",
    secrets: [
      DARAJA_CONSUMER_KEY,
      DARAJA_CONSUMER_SECRET,
      MPESA_SHORTCODE,
      B2C_INITIATOR_NAME,
      B2C_SECURITY_CREDENTIAL,
      B2C_RESULT_URL,
      B2C_TIMEOUT_URL,
      MPESA_ENV,
    ],
  },
  async (req, res) => {
    const stop = handleCorsPreflight(req, res);
    if (stop) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

      const { phone, amount, remarks } = req.body || {};
      if (!phone || !amount) return res.status(400).json({ error: "phone and amount are required" });

      const msisdn = normalizePhone(phone);
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "amount invalid" });

      const token = await getAccessToken(
        DARAJA_CONSUMER_KEY.value(),
        DARAJA_CONSUMER_SECRET.value()
      );

      const payoutRef = db.collection("mpesaB2CRequests").doc();
      await payoutRef.set({
        phone: msisdn,
        amount: amt,
        remarks: safeStr(remarks || "Audiory payout"),
        status: "PENDING",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const payload = {
        InitiatorName: B2C_INITIATOR_NAME.value(),
        SecurityCredential: B2C_SECURITY_CREDENTIAL.value(),
        CommandID: "BusinessPayment",
        Amount: amt,
        PartyA: String(MPESA_SHORTCODE.value()),
        PartyB: msisdn,
        Remarks: safeStr(remarks || "Audiory payout"),
        QueueTimeOutURL: B2C_TIMEOUT_URL.value(),
        ResultURL: B2C_RESULT_URL.value(),
        Occasion: payoutRef.id,
      };

      const r = await fetchFn(b2cPaymentUrl(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await r.json().catch(() => ({}));

      await payoutRef.set(
        {
          b2cResponse: data,
          conversationId: data.ConversationID || null,
          originatorConversationId: data.OriginatorConversationID || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return res.status(r.ok ? 200 : 400).json({ requestId: payoutRef.id, ...data });
    } catch (e) {
      console.error("b2cPay error:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

exports.b2cResult = onRequest({ region: "us-central1" }, async (req, res) => {
  try {
    const body = req.body || {};
    const result = body?.Result || {};
    const originatorConversationID = safeStr(result.OriginatorConversationID || "");
    const resultCode = result.ResultCode;
    const resultDesc = safeStr(result.ResultDesc || "");

    await db.collection("mpesaB2CResults").doc(originatorConversationID || crypto.randomUUID()).set(
      {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        originatorConversationID,
        resultCode,
        resultDesc,
        raw: body,
      },
      { merge: true }
    );

    const q = await db
      .collection("mpesaB2CRequests")
      .where("originatorConversationId", "==", originatorConversationID)
      .limit(1)
      .get();

    if (!q.empty) {
      await q.docs[0].ref.set(
        {
          status: Number(resultCode) === 0 ? "PAID" : "FAILED",
          resultCode,
          resultDesc,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (e) {
    console.error("b2cResult error:", e);
    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
});

exports.b2cTimeout = onRequest({ region: "us-central1" }, async (req, res) => {
  try {
    await db.collection("mpesaB2CTimeouts").add({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      raw: req.body || null,
    });
    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (e) {
    console.error("b2cTimeout error:", e);
    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
});

/* =========================================================
✅ SECURE DOWNLOAD (AUTH + CORS)
========================================================= */
exports.secureDownload = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    const stop = handleCorsPreflight(req, res);
    if (stop) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

      // --------- AUTH (Firebase ID Token) ----------
      const authHeader = req.headers.authorization || "";
      const m = authHeader.match(/^Bearer (.+)$/);
      if (!m) return res.status(401).json({ error: "Missing Authorization Bearer token" });

      let decoded;
      try {
        decoded = await admin.auth().verifyIdToken(m[1]);
      } catch (e) {
        return res.status(401).json({ error: "Invalid or expired token" });
      }

      const buyerId = String(decoded.uid || "");
      if (!buyerId) return res.status(401).json({ error: "Auth uid missing" });

      // --------- INPUT ----------
      const { beatId } = req.body || {};
      if (!beatId) return res.status(400).json({ error: "beatId is required" });

      // --------- CHECK UNLOCK OWNERSHIP ----------
      // only allow if THIS buyer has an unlock for this beat
      const unlockSnap = await db
        .collection("unlocks")
        .where("beatId", "==", String(beatId))
        .where("buyerId", "==", buyerId)
        .limit(1)
        .get();

      if (unlockSnap.empty) return res.status(403).json({ error: "Beat not unlocked for this user" });

      const unlock = unlockSnap.docs[0].data() || {};

      // --------- GET FILE PATH ----------
      // Prefer unlock.downloadPath, then beat.downloadPath, then beat.filePath
      const beatDoc = await db.collection("beats").doc(String(beatId)).get();
      if (!beatDoc.exists) return res.status(404).json({ error: "Beat not found" });

      const beatData = beatDoc.data() || {};

      const filePath =
        safeStr(unlock.downloadPath || "") ||
        safeStr(beatData.downloadPath || "") ||
        safeStr(beatData.filePath || "");

      if (!filePath) return res.status(500).json({ error: "File path missing on unlock/beat doc" });

      // --------- SIGNED URL ----------
      const [url] = await bucket.file(filePath).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 10 * 60 * 1000,
        responseDisposition: `attachment; filename="${safeStr(beatData.title || "beat")}.wav"`,
      });

      return res.json({ url });
    } catch (err) {
        console.error("DOWNLOAD ERROR:", err);
        res.status(500).json({ error: err?.message || String(err) });
    }
  }
);


/* =========================================================
✅ LICENSE DOWNLOAD (AUTH + PER LICENSEKEY + CORS)
========================================================= */
exports.licenseDownload = onRequest({ region: "us-central1" }, async (req, res) => {
  const stop = handleCorsPreflight(req, res);
  if (stop) return;
  applyCors(req, res);

  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    // ---------- AUTH ----------
    const authHeader = req.headers.authorization || "";
    const m = authHeader.match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: "Missing Authorization Bearer token" });

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(m[1]);
    } catch (e) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const buyerId = safeStr(decoded.uid);
    if (!buyerId) return res.status(401).json({ error: "Auth uid missing" });

    // ---------- INPUT ----------
    const { beatId, licenseKey, unlockId, orderId } = req.body || {};
    const lk = safeStr(licenseKey || "basic").toLowerCase();
    const allowed = ["basic", "premium", "exclusive"];
    if (!allowed.includes(lk)) return res.status(400).json({ error: "Invalid licenseKey" });

    // ---------- FIND UNLOCK (prefer unlockId) ----------
    let unlockRef = null;
    let unlockData = null;

    if (safeStr(unlockId)) {
      const snap = await db.collection("unlocks").doc(safeStr(unlockId)).get();
      if (snap.exists) {
        const d = snap.data() || {};
        // ownership check
        if (safeStr(d.buyerId) !== buyerId) return res.status(403).json({ error: "Not your unlock" });
        unlockRef = snap.ref;
        unlockData = d;
      }
    }

    // fallback: query by beatId+buyerId
    if (!unlockData) {
      if (!beatId) return res.status(400).json({ error: "beatId is required if unlockId not provided" });

      const q = db.collection("unlocks")
        .where("beatId", "==", safeStr(beatId))
        .where("buyerId", "==", buyerId);

      const snap = await q.limit(25).get();
      if (snap.empty) return res.status(403).json({ error: "Beat not unlocked for this user" });

      // prefer exact licenseKey match, else first
      let chosen = null;
      for (const doc of snap.docs) {
        const d = doc.data() || {};
        if (!chosen && safeStr(d.licenseKey).toLowerCase() === lk) chosen = { ref: doc.ref, data: d };
      }
      if (!chosen) chosen = { ref: snap.docs[0].ref, data: snap.docs[0].data() || {} };

      unlockRef = chosen.ref;
      unlockData = chosen.data;
    }

    // Optional: require paid unlock
    if (unlockData.paid === false) {
      return res.status(403).json({ error: "Unlock not paid" });
    }

    const finalBeatId = safeStr(unlockData.beatId || beatId);
    if (!finalBeatId) return res.status(400).json({ error: "beatId missing" });

    // ---------- GET BEAT ----------
    const beatSnap = await db.collection("beats").doc(finalBeatId).get();
    if (!beatSnap.exists) return res.status(404).json({ error: "Beat not found" });
    const beat = beatSnap.data() || {};

    // ---------- RESOLVE DATA (checkout name/email, producer name) ----------
    const buyerName = safeStr(unlockData.buyerName || unlockData.checkoutName || "");
    const buyerEmail = safeStr(unlockData.buyerEmail || unlockData.checkoutEmail || "");
    const beatTitle = safeStr(unlockData.beatTitle || beat.title || "Beat");
    const producerId = safeStr(unlockData.producerId || beat.producerId || "");
    let producerName = safeStr(unlockData.producerName || beat.producerName || "");

    // fallback: fetch producer profile if you store it
    if (!producerName && producerId) {
      const prodSnap = await db.collection("users").doc(producerId).get().catch(() => null);
      if (prodSnap && prodSnap.exists) {
        const pd = prodSnap.data() || {};
        producerName = safeStr(pd.displayName || pd.name || "");
      }
    }
    if (!producerName) producerName = "Producer";

    // ---------- IF WE ALREADY GENERATED IT, REUSE ----------
    const existingPath = safeStr(unlockData.licenseGeneratedPath?.[lk] || unlockData.licenseGeneratedPath || "");
    if (existingPath) {
      const [url] = await bucket.file(existingPath).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 10 * 60 * 1000,
        responseDisposition: `attachment; filename="${beatTitle}-${lk}-license.pdf"`,
        responseType: "application/pdf",
      });
      return res.json({ url });
    }

    // ---------- GENERATE PDF ----------
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = 800;
    const left = 50;

    const draw = (text, size = 12, isBold = false) => {
      page.drawText(text, {
        x: left,
        y,
        size,
        font: isBold ? bold : font,
        color: rgb(1, 1, 1),
      });
      y -= size + 8;
    };

    draw("AUDIORY LICENSE AGREEMENT", 20, true);
    draw(`License Type: ${lk.toUpperCase()}`, 14, true);
    y -= 8;

    draw(`Beat: ${beatTitle}`, 12, true);
    draw(`Producer: ${producerName}`, 12);
    draw(`Buyer Name: ${buyerName || "N/A"}`, 12);
    draw(`Buyer Email: ${buyerEmail || "N/A"}`, 12);
    draw(`Order ID: ${safeStr(unlockData.orderId || orderId || "N/A")}`, 12);
    draw(`Unlock ID: ${unlockRef.id}`, 12);
    draw(`Date: ${new Date().toISOString().slice(0, 10)}`, 12);

    y -= 12;
    draw("Terms of Use:", 14, true);

    const terms = termsFor(lk);
    for (const t of terms) {
      draw(`• ${t}`, 11);
      if (y < 80) break; // simple overflow protection
    }

    y -= 18;
    draw("This license is issued electronically via Audiory.", 10);
    draw("Keep this document as proof of purchase and license rights.", 10);

    const pdfBytes = await pdfDoc.save();

    // ---------- UPLOAD GENERATED PDF ----------
    const outPath = `licenses/generated/${unlockRef.id}_${lk}.pdf`;
    await bucket.file(outPath).save(Buffer.from(pdfBytes), {
      contentType: "application/pdf",
      resumable: false,
      metadata: {
        cacheControl: "private, max-age=0, no-transform",
      },
    });

    // save path back to unlock so we can reuse next time
    await unlockRef.set(
      { licenseGeneratedPath: { [lk]: outPath } },
      { merge: true }
    );

    // ---------- SIGNED URL ----------
    const [url] = await bucket.file(outPath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 10 * 60 * 1000,
      responseDisposition: `attachment; filename="${beatTitle}-${lk}-license.pdf"`,
      responseType: "application/pdf",
    });

    return res.json({ url });
  } catch (err) {
    console.error("License ERROR:", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

exports.beatsAutoFieldsOnCreate = onDocumentCreated(
  { document: "beats/{beatId}", region: "us-central1" },
  async (event) => {
    const ref = event.data.ref;
    const data = event.data.data();
    await ensureBeatFields(ref, data);
  }
);

exports.beatsAutoFieldsOnWrite = onDocumentWritten(
  { document: "beats/{beatId}", region: "us-central1" },
  async (event) => {
    const after = event.data.after;
    if (!after.exists) return;

    const ref = after.ref;
    const data = after.data();

    const missing =
      !data.filePath ||
      (!data.licensePaths || typeof data.licensePaths !== "object") ||
      (!data.licensePaths?.basic || !data.licensePaths?.premium || !data.licensePaths?.exclusive);

    if (!missing) return;

    await ensureBeatFields(ref, data);
  }
);

exports.backfillBeatsFields = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

      const decoded = await verifyFirebaseIdToken(req);
      const uid = decoded.uid;

      const uDoc = await db.collection("users").doc(uid).get();
      const isAdmin = uDoc.exists && uDoc.data()?.isAdmin === true;
      if (!isAdmin) return res.status(403).json({ error: "Admin only" });

      let last = null;
      let updated = 0;
      let scanned = 0;

      while (true) {
        let q = db.collection("beats")
          .orderBy(admin.firestore.FieldPath.documentId())
          .limit(250);
        if (last) q = q.startAfter(last);

        const snap = await q.get();
        if (snap.empty) break;

        for (const doc of snap.docs) {
          scanned++;
          const data = doc.data();

          const needs =
            !data.filePath ||
            !data.licensePaths ||
            !data.licensePaths?.basic ||
            !data.licensePaths?.premium ||
            !data.licensePaths?.exclusive;

          if (needs) {
            await ensureBeatFields(doc.ref, data);
            updated++;
          }
        }

        last = snap.docs[snap.docs.length - 1].id;
        if (snap.size < 250) break;
      }

      return res.json({ ok: true, scanned, updated });
    } catch (e) {
      console.error("backfillBeatsFields error:", e);
      return res.status(500).json({ error: e.message || String(e) });
    }
  }
);

/* =========================================================
✅ EMAIL TRIGGERS (SendGrid)
========================================================= */
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

exports.onUserBecameProducer = onDocumentWritten(
  {
    region: "us-central1",
    maxInstances: 1,
    document: "users/{uid}",
    secrets: [SENDGRID_API_KEY, SENDGRID_FROM, ADMIN_NOTIFY_EMAIL],
  },
  async (event) => {
    try {
      const before = event.data?.before?.data() || {};
      const after = event.data?.after?.data() || {};
      const uid = event.params.uid;

      const wasProducer = isProducerProfile(before);
      const isProducer = isProducerProfile(after);

      if (wasProducer || !isProducer) return;

      // prevent duplicate welcome emails
      if (after.welcomeEmailSent === true) return;

      const email = safeStr(after.email).trim();
      const name = safeStr(after.displayName || after.name || "Producer");

      const adminTo = ADMIN_NOTIFY_EMAIL.value();
      if (adminTo) {
        await sendEmail({
          to: adminTo,
          subject: "Producer activated on Audiory",
          text: `A user became a producer.\n\nName: ${name}\nEmail: ${email || "—"}\nUID: ${uid}`,
          html: `<h2>Producer activated</h2><p><b>Name:</b> ${name}</p><p><b>Email:</b> ${email || "—"}</p><p><b>UID:</b> ${uid}</p>`,
        });
      }

      if (email) {
        await sendEmail({
          to: email,
          subject: "Welcome to Audiory",
          text:
            `Hey ${name}, welcome to Audiory!\n\n` +
            `You can now upload beats, set prices, and start selling.\n\n` +
            `— Audiory Team`,
          html:
            `<h2>Welcome to Audiory</h2>` +
            `<p>Hey ${name},</p>` +
            `<p>You can now upload beats, set prices, and start selling.</p>` +
            `<p style="margin-top:14px;">— Audiory Team</p>`,
        });
      }

      await db.collection("users").doc(uid).set(
        { welcomeEmailSent: true, welcomeEmailSentAt: Date.now() },
        { merge: true }
      );
    } catch (e) {
      console.error("onUserBecameProducer email error:", e);
    }
  }
);

exports.onPayoutRequest = onDocumentCreated(
  {
    region: "us-central1",
    maxInstances: 1,
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
      } catch (_) {}

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
  }
);

/* =========================================================
✅ PRODUCER FOLLOW COUNT (FIXED + v2)
producerFollows/{producerId}/followers/{uid}
========================================================= */
exports.onProducerFollowWrite = onDocumentWritten(
  {
    region: "us-central1",
    document: "producerFollows/{producerId}/followers/{uid}",
  },
  async (event) => {
    const producerId = event.params.producerId;
    const producerRef = db.collection("users").doc(producerId);

    const beforeExists = !!event.data?.before?.exists;
    const afterExists = !!event.data?.after?.exists;

    // Created
    if (!beforeExists && afterExists) {
      await producerRef.set(
        { followersCount: admin.firestore.FieldValue.increment(1) },
        { merge: true }
      );
      return;
    }

    // Deleted
    if (beforeExists && !afterExists) {
      await producerRef.set(
        { followersCount: admin.firestore.FieldValue.increment(-1) },
        { merge: true }
      );
      return;
    }
  }
);
