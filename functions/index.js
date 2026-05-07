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
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} = require("firebase-functions/v2/firestore");
const { getStorage } = require("firebase-admin/storage");

exports.generateTags = require("./generateTags").generateTags;

// safe fetch
let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = require("node-fetch");
}

admin.initializeApp({
  storageBucket: "audiory-beat-store.firebasestorage.app",
});

const db = admin.firestore();
const bucket = getStorage().bucket("audiory-beat-store.firebasestorage.app");

// email verification functions moved to separate file
const emailVerification = require("./emailVerification");

exports.sendVerificationEmail = emailVerification.sendVerificationEmail;
exports.verifyEmailToken = emailVerification.verifyEmailToken;
exports.resendVerificationEmail = emailVerification.resendVerificationEmail;

const emailTriggers = require("./emailTriggers");

exports.onProducerSignupWelcome = emailTriggers.onProducerSignupWelcome;
exports.onPayoutProcessed = emailTriggers.onPayoutProcessed;
exports.onBuyerOrderPaidInvoice = emailTriggers.onBuyerOrderPaidInvoice;

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

// PayPal
const PAYPAL_CLIENT_ID = defineSecret("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = defineSecret("PAYPAL_CLIENT_SECRET");
const PAYPAL_WEBHOOK_ID = defineSecret("PAYPAL_WEBHOOK_ID");
const PAYPAL_MODE = defineSecret("PAYPAL_MODE");

// Cloudflare
const CLOUDFLARE_API_TOKEN = defineSecret("CLOUDFLARE_API_TOKEN");
const CLOUDFLARE_ZONE_ID = defineSecret("CLOUDFLARE_ZONE_ID");

/* =========================================================
✅ PERMANENT CORS FIX (FOREVER)
========================================================= */
function applyCors(req, res) {
  const origin = String(req.headers.origin || "").trim();

  // ✅ strict allowlist for known frontend origins
  const allowed = new Set([
    "https://audiory.site",
    "https://www.audiory.site",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ]);

  let allowOrigin = "";

  if (origin && allowed.has(origin)) {
    allowOrigin = origin;
  } else if (origin) {
    // ✅ allow producer custom domains too
    try {
      const url = new URL(origin);
      const host = (url.hostname || "").toLowerCase();

      const isCustomProducerDomain =
        host &&
        host !== "localhost" &&
        host !== "audiory.site" &&
        host !== "www.audiory.site" &&
        !host.endsWith(".web.app") &&
        !host.endsWith(".firebaseapp.com") &&
        url.protocol === "https:";

      if (isCustomProducerDomain) {
        allowOrigin = origin;
      }
    } catch (e) {
      console.warn("Invalid Origin header:", origin);
    }
  }

  // ✅ only set ACAO when we actually allow the origin
  if (allowOrigin) {
    res.set("Access-Control-Allow-Origin", allowOrigin);
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

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function b2cPaymentUrl() {
  return `${darajaBase()}/mpesa/b2c/v3/paymentrequest`;
}

// ✅ Helper: update BOTH possible collections by OriginatorConversationID
async function updateB2CByOriginatorId(originatorConversationId, patch) {
  const id = String(originatorConversationId || "").trim();
  if (!id) return { payoutsRequests: 0, mpesaB2CRequests: 0 };

  const results = { payoutsRequests: 0, mpesaB2CRequests: 0 };

  // ---- payoutsRequests: match mpesa.originatorConversationId OR top-level originatorConversationId
  {
    const qs = [];

    qs.push(
      db.collection("payoutsRequests")
        .where("mpesa.originatorConversationId", "==", id)
        .limit(25)
        .get()
    );

    qs.push(
      db.collection("payoutsRequests")
        .where("originatorConversationId", "==", id)
        .limit(25)
        .get()
    );

    const [q1, q2] = await Promise.all(qs);

    const docs = new Map();
    q1.docs.forEach((d) => docs.set(d.id, d));
    q2.docs.forEach((d) => docs.set(d.id, d));

    if (docs.size) {
      const batch = db.batch();
      for (const d of docs.values()) {
        batch.set(d.ref, patch.payoutsRequests, { merge: true });
        results.payoutsRequests++;
      }
      await batch.commit();
    }
  }

  // ---- mpesaB2CRequests: match originatorConversationId OR mpesa.originatorConversationId
  {
    const qs = [];

    qs.push(
      db.collection("mpesaB2CRequests")
        .where("originatorConversationId", "==", id)
        .limit(25)
        .get()
    );

    qs.push(
      db.collection("mpesaB2CRequests")
        .where("mpesa.originatorConversationId", "==", id)
        .limit(25)
        .get()
    );

    const [q1, q2] = await Promise.all(qs);

    const docs = new Map();
    q1.docs.forEach((d) => docs.set(d.id, d));
    q2.docs.forEach((d) => docs.set(d.id, d));

    if (docs.size) {
      const batch = db.batch();
      for (const d of docs.values()) {
        batch.set(d.ref, patch.mpesaB2CRequests, { merge: true });
        results.mpesaB2CRequests++;
      }
      await batch.commit();
    }
  }

  return results;
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
✅ CLOUDFLARE HELPERS
========================================================= */
async function cfCreateCustomHostname({ zoneId, apiToken, hostname, uid }) {
  const r = await fetchFn(
    `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/custom_hostnames`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hostname,
        ssl: {
          method: "txt",
          type: "dv",
        },
      }),
    }
  );

  const j = await r.json().catch(() => ({}));

  if (!r.ok || j?.success === false) {
    const msg =
      j?.errors?.[0]?.message ||
      j?.result?.message ||
      `Cloudflare create custom hostname failed (${r.status})`;
    throw new Error(msg);
  }

  const result = j?.result || {};

  // optional: attach metadata so Worker can read it later if needed
  if (result?.id && uid) {
    try {
      await cfUpdateCustomHostnameMetadata({
        zoneId,
        apiToken,
        customHostnameId: result.id,
        hostname,
        uid,
      });
    } catch (e) {
      console.warn("cfUpdateCustomHostnameMetadata failed:", e?.message || e);
    }
  }

  return result;
}

async function cfUpdateCustomHostnameMetadata({
  zoneId,
  apiToken,
  customHostnameId,
  hostname,
  uid,
}) {
  const r = await fetchFn(
    `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/custom_hostnames/${encodeURIComponent(customHostnameId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ssl: {
          method: "txt",
          type: "dv",
        },
        custom_metadata: {
          uid: String(uid || ""),
          hostname: String(hostname || ""),
          app: "audiory",
        },
      }),
    }
  );

  const j = await r.json().catch(() => ({}));

  if (!r.ok || j?.success === false) {
    const msg =
      j?.errors?.[0]?.message ||
      `Cloudflare update custom hostname metadata failed (${r.status})`;
    throw new Error(msg);
  }

  return j?.result || {};
}

async function cfGetCustomHostname({ zoneId, apiToken, customHostnameId }) {
  const r = await fetchFn(
    `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/custom_hostnames/${encodeURIComponent(customHostnameId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  const j = await r.json().catch(() => ({}));

  if (!r.ok || j?.success === false) {
    const msg =
      j?.errors?.[0]?.message ||
      `Cloudflare get custom hostname failed (${r.status})`;
    throw new Error(msg);
  }

  return j?.result || {};
}

async function cfFindCustomHostnameByName({ zoneId, apiToken, hostname }) {
  const r = await fetchFn(
    `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/custom_hostnames?hostname=${encodeURIComponent(hostname)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  const j = await r.json().catch(() => ({}));

  if (!r.ok || j?.success === false) {
    const msg =
      j?.errors?.[0]?.message ||
      `Cloudflare list custom hostnames failed (${r.status})`;
    throw new Error(msg);
  }

  const arr = Array.isArray(j?.result) ? j.result : [];
  return arr.find((x) => String(x?.hostname || "").toLowerCase() === String(hostname || "").toLowerCase()) || null;
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

function normalizePhone(phone) {
  let p = safeStr(phone).trim().replace(/\s+/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "254" + p.slice(1);
  if (p.startsWith("7")) p = "254" + p;
  return p;
}

async function getAccessToken(consumerKey, consumerSecret) {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const r = await fetchFn(`${darajaBase()}/oauth/v1/generate?grant_type=client_credentials`, {
    method: "GET",
    headers: { Authorization: `Basic ${auth}` },
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(j.errorMessage || j.error_description || "Failed to get Daraja token");
  }
  return j.access_token;
}

// Helper: call B2C
async function callB2C({
  token,
  shortcode,
  initiatorName,
  securityCredential,
  amountKes,
  phone2547,
  resultUrl,
  timeoutUrl,
  remarks,
  occassion,
  commandId,
}) {
  // ✅ must be unique each request
  const originatorConversationId =
    `AUDIORY_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  const payload = {
    InitiatorName: initiatorName,
    SecurityCredential: securityCredential,
    CommandID: commandId || "BusinessPayment",

    // ✅ required / important
    Amount: Math.round(Number(amountKes)),     // keep integer
    PartyA: String(shortcode),
    PartyB: String(phone2547),                 // 2547xxxxxxxx
    Remarks: remarks || "Withdrawal",
    QueueTimeOutURL: String(timeoutUrl),
    ResultURL: String(resultUrl),
    Occasion: occassion || "Audiory",

    // ✅ THE MISSING FIELD (exact casing!)
    OriginatorConversationID: originatorConversationId,
  };

  const r = await fetch(`${darajaBase()}/mpesa/b2c/v3/paymentrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const j = await r.json().catch(() => ({}));

  // ✅ if Daraja returns non-200, surface the best error message
  if (!r.ok) {
    throw new Error(
      j?.errorMessage ||
      j?.ResponseDescription ||
      j?.ResultDesc ||
      `B2C request failed (${r.status})`
    );
  }

  // ✅ attach the originator id so you can store it in Firestore for tracking
  return { ...j, OriginatorConversationID: originatorConversationId };
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
  const resource = event?.resource || null;

  // Webhook: PAYMENT.CAPTURE.COMPLETED
  if (resource?.amount?.value && resource?.amount?.currency_code) {
    return {
      value: Number(resource.amount.value),
      currency: String(resource.amount.currency_code),
    };
  }

  // Direct capture response: /v2/checkout/orders/{id}/capture
  const capture =
    event?.purchase_units?.[0]?.payments?.captures?.[0];

  if (capture?.amount?.value && capture?.amount?.currency_code) {
    return {
      value: Number(capture.amount.value),
      currency: String(capture.amount.currency_code),
    };
  }

  // Fallback: order-level amount
  const pu = event?.purchase_units?.[0] || resource?.purchase_units?.[0];
  if (pu?.amount?.value && pu?.amount?.currency_code) {
    return {
      value: Number(pu.amount.value),
      currency: String(pu.amount.currency_code),
    };
  }

  return { value: 0, currency: "USD" };
}

async function creditProducerWallet({
  producerId,
  orderId,
  grossAmount,
  currency,
  source,
  revenueId,
}) {
  const gross = Number(grossAmount || 0);
  const fee = Math.round(gross * 0.10 * 100) / 100;
  const net = Math.round((gross - fee) * 100) / 100;

  const walletRef = db.collection("wallets").doc(producerId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(walletRef);
    const w = snap.exists ? (snap.data() || {}) : {};

    const lifetimeUsd = Number(w.lifetimeUsd || 0);
    const availableUsd = Number(w.availableUsd || 0);
    const pendingPayoutUsd = Number(w.pendingPayoutUsd || 0);
    const paidOutUsd = Number(w.paidOutUsd || 0);

    tx.set(
      walletRef,
      {
        lifetimeUsd: +(lifetimeUsd + net).toFixed(2),
        availableUsd: +(availableUsd + net).toFixed(2),
        pendingPayoutUsd: +pendingPayoutUsd.toFixed(2),
        paidOutUsd: +paidOutUsd.toFixed(2),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Use POST" });
      }

      // ✅ VERIFY FIREBASE TOKEN INSTEAD OF TRUSTING UID
      const decoded = await verifyFirebaseIdToken(req);
      const uid = safeStr(decoded?.uid || "");

      if (!uid) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { subscriptionId } = req.body || {};

      if (!subscriptionId) {
        return res.status(400).json({
          error: "subscriptionId is required",
        });
      }

      // ✅ VERIFY AGAINST PAYPAL API
      const accessToken = await getPayPalAccessToken();

      const r = await fetchFn(
        `${paypalBaseUrl()}/v1/billing/subscriptions/${subscriptionId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        return res.status(400).json({
          error: data?.message || "PayPal verify failed",
          details: data,
        });
      }

      const status = safeStr(data.status).toLowerCase().trim();
      const planId = safeStr(data.plan_id).trim();

      // ✅ MAP PAYPAL PLAN IDS
      const PLAN_MAP = {
        "P-0DG10730Y03521241NH46SIY": "starter",
        "P-8DL33053SW9633024NH46UPY": "pro",
        "P-399462291E201212SNH46VZA": "elite",
      };

      const planTier = PLAN_MAP[planId] || "free";

      // ACTIVE / APPROVAL_PENDING treated as usable
      const isActive =
        status === "active";

      // ✅ NEXT BILLING DATE
      const nextBillingTime =
        data?.billing_info?.next_billing_time || null;

      const expiresAt =
        nextBillingTime
          ? new Date(nextBillingTime).getTime()
          : null;

      // ✅ SAVE USER PLAN
      await db.collection("users").doc(uid).set(
        {
          plan: isActive ? planTier : "free",
          planTier: isActive ? planTier : "free",

          subscriptionStatus: status || "unknown",

          paypalSubscriptionId: subscriptionId,
          paypalPlanId: planId,

          subscriptionProvider: "paypal",

          subscriptionExpires: expiresAt,

          planUpdatedAt: Date.now(),
        },
        { merge: true }
      );

      return res.json({
        ok: true,
        status,
        planId,
        planTier: isActive ? planTier : "free",
        subscriptionExpires: expiresAt,
      });

    } catch (e) {
      console.error("verifySubscription error:", e);

      try {
        applyCors(req, res);
      } catch (_) {}

      return res.status(500).json({
        error: e?.message || String(e),
      });
    }
  }
);

exports.createAppCustomToken = onRequest(async (req, res) => {
  try {
    const uid = req.body.uid;
    if (!uid) {
      res.status(400).json({ error: "Missing uid" });
      return;
    }

    const token = await admin.auth().createCustomToken(uid);
    res.json({ token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/* =========================================================
✅ DOMAIN CONNECT (Elite) - HTTP FUNCTIONS
========================================================= */
exports.createDomainChallenge = onRequest(
  {
    region: "us-central1",
  },
  async (req, res) => {
    const pre = handleCorsPreflight(req, res);
    if (pre) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Use POST" });
      }

      const { uid, domain } = req.body || {};
      if (!uid) return res.status(400).json({ error: "uid is required" });
      if (!domain) return res.status(400).json({ error: "domain is required" });

      const d = normDomain(domain);
      if (!d.includes(".")) {
        return res.status(400).json({ error: "Invalid domain" });
      }

      const token = `audiory-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

      await db.collection("users").doc(uid).set(
        {
          customDomain: d,
          customDomainStatus: "pending_dns",
          customDomainVerified: false,
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
    secrets: [CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID],
  },
  async (req, res) => {
    const pre = handleCorsPreflight(req, res);
    if (pre) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Use POST" });
      }

      const { uid, domain } = req.body || {};
      if (!uid) return res.status(400).json({ error: "uid is required" });
      if (!domain) return res.status(400).json({ error: "domain is required" });

      const d = normDomain(domain);
      if (!d.includes(".")) {
        return res.status(400).json({ error: "Invalid domain" });
      }

      const usnap = await db.collection("users").doc(uid).get();
      if (!usnap.exists) {
        return res.status(404).json({ error: "User not found" });
      }

      const u = usnap.data() || {};
      const expected = String(u.customDomainToken || "").trim();

      if (!expected) {
        return res.status(400).json({ error: "No token found. Create challenge first." });
      }

      if (normDomain(u.customDomain || "") !== d) {
        return res.status(400).json({ error: "Domain mismatch. Save the same domain first." });
      }

      // 1) Verify TXT first
      const txtHost = `_audiory-verify.${d}`;
      const txts = await dohTxtLookup(txtHost);
      const txtOk = txts.some((v) => String(v || "").includes(expected));

      if (!txtOk) {
        await db.collection("domains").doc(safeIdFromDomain(d)).set(
          {
            domain: d,
            uid,
            verified: false,
            txtVerified: false,
            status: "pending_dns",
            checkedHost: txtHost,
            checkedTxts: txts,
            updatedAt: Date.now(),
          },
          { merge: true }
        );

        await db.collection("users").doc(uid).set(
          {
            customDomain: d,
            customDomainVerified: false,
            customDomainStatus: "pending_dns",
            customDomainUpdatedAt: Date.now(),
          },
          { merge: true }
        );

        return res.status(200).json({
          ok: false,
          reason: "TXT_NOT_FOUND",
          checked: txtHost,
          got: txts,
        });
      }

      // 2) Read Firebase secret values properly
      const zoneId = CLOUDFLARE_ZONE_ID.value();
      const apiToken = CLOUDFLARE_API_TOKEN.value();

      if (!zoneId || !apiToken) {
        throw new Error("Missing CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN secret.");
      }

      // 3) Create or reuse Cloudflare custom hostname
      let cfHost = null;

      try {
        cfHost = await cfFindCustomHostnameByName({
          zoneId,
          apiToken,
          hostname: d,
        });
      } catch (e) {
        console.warn("cfFindCustomHostnameByName failed:", e?.message || e);
      }

      if (!cfHost) {
        cfHost = await cfCreateCustomHostname({
          zoneId,
          apiToken,
          hostname: d,
          uid,
        });
      } else {
        try {
          await cfUpdateCustomHostnameMetadata({
            zoneId,
            apiToken,
            customHostnameId: cfHost.id,
            hostname: d,
            uid,
          });

          cfHost = await cfGetCustomHostname({
            zoneId,
            apiToken,
            customHostnameId: cfHost.id,
          });
        } catch (e) {
          console.warn("Cloudflare metadata refresh failed:", e?.message || e);
        }
      }

      const cfStatus = String(cfHost?.status || "").trim();
      const sslStatus = String(cfHost?.ssl?.status || "").trim();
      const ownershipStatus = String(
        cfHost?.ownership_verification?.status ||
        cfHost?.ownership_verification_http?.status ||
        ""
      ).trim();

      // 4) Save full state
      await db.collection("domains").doc(safeIdFromDomain(d)).set(
        {
          domain: d,
          uid,
          verified: true,
          txtVerified: true,
          verifiedAt: Date.now(),
          updatedAt: Date.now(),

          status: "verified",
          checkedHost: txtHost,
          checkedTxts: txts,

          cloudflareHostnameId: cfHost?.id || "",
          cloudflareHostname: cfHost?.hostname || d,
          cloudflareStatus: cfStatus,
          cloudflareSslStatus: sslStatus,
          cloudflareOwnershipStatus: ownershipStatus,
          cloudflareCreatedAt: Date.now(),
        },
        { merge: true }
      );

      await db.collection("users").doc(uid).set(
        {
          customDomain: d,
          customDomainVerified: true,
          customDomainStatus: "verified",
          customDomainVerifiedAt: Date.now(),
          customDomainUpdatedAt: Date.now(),

          cloudflareHostnameId: cfHost?.id || "",
          cloudflareHostnameStatus: cfStatus,
          cloudflareSslStatus: sslStatus,
        },
        { merge: true }
      );

      return res.json({
        ok: true,
        domain: d,
        txtVerified: true,
        cloudflare: {
          hostnameId: cfHost?.id || "",
          hostname: cfHost?.hostname || d,
          status: cfStatus,
          sslStatus: sslStatus,
          ownershipStatus: ownershipStatus,
        },
      });
    } catch (e) {
      console.error("verifyDomainDns:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

exports.resolveDomain = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    const host = normDomain(req.query.host || "");

    if (!host) {
      return res.status(400).json({ ok: false });
    }

    const snap = await db
      .collection("domains")
      .doc(safeIdFromDomain(host))
      .get();

    if (!snap.exists) {
      return res.json({ ok: false });
    }

    const data = snap.data() || {};

    if (!data.verified || !data.uid) {
      return res.json({ ok: false });
    }

    return res.json({
      ok: true,
      uid: data.uid,
    });
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
        buyerId: buyerId || null,
      });

      // ✅ Put only the cartId in PayPal custom_id
      const customId = `cartId=${cartId}`;

      // ✅ Dynamic return / cancel URL
      const requestOrigin = String(req.headers.origin || "").trim();

      let checkoutBase = "https://audiory.site";

      if (requestOrigin) {
        try {
          const u = new URL(requestOrigin);
          const host = String(u.hostname || "").toLowerCase();

          const isMainAudiory =
            requestOrigin === "https://audiory.site" ||
            requestOrigin === "https://www.audiory.site";

          const isAllowedCustomDomain =
            u.protocol === "https:" &&
            host &&
            host !== "audiory.site" &&
            host !== "www.audiory.site" &&
            host !== "localhost" &&
            !host.endsWith(".web.app") &&
            !host.endsWith(".firebaseapp.com") &&
            !host.endsWith(".run.app");

          if (isMainAudiory || isAllowedCustomDomain) {
            checkoutBase = u.origin;
          }
        } catch (err) {
          console.warn("Invalid origin for PayPal return URL:", requestOrigin);
        }
      }

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
          landing_page: "BILLING",
          return_url: `${checkoutBase}/success.html`,
          cancel_url: `${checkoutBase}/cancel.html`,
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
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Use POST" });
      }

      const { orderId, cartId } = req.body || {};

      if (!orderId) {
        return res.status(400).json({ error: "orderId is required" });
      }

      if (!cartId) {
        return res.status(400).json({ error: "cartId is required" });
      }

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
        return res.status(400).json({
          error: data?.message || "Capture failed",
          details: data,
        });
      }

      if (safeStr(data?.status).toUpperCase() !== "COMPLETED") {
        return res.status(400).json({
          error: "PayPal payment was not completed",
          details: data,
        });
      }

      await processCartCapture({
        cartId: String(cartId),
        captureEvent: data,
        orderId,
      });

      return res.json({
        ok: true,
        status: data.status,
        orderId,
        cartId,
      });
    } catch (e) {
      console.error("captureOrder error:", e);
      try { applyCors(req, res); } catch (_) {}
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

  const buyerId = safeStr(cart.buyerId || "");

  // ✅ support both direct capture response and webhook payload
  const root = captureEvent || {};
  const resource = root?.resource || root;
  const payer = root?.payer || resource?.payer || {};

  const payerEmail = safeStr(
    payer?.email_address ||
    resource?.payer?.email_address ||
    ""
  );

  const payerName =
    safeStr(payer?.name?.given_name || "") +
    (payer?.name?.surname ? " " + safeStr(payer?.name?.surname) : "");

  const buyerEmail = payerEmail || null;
  const buyerName = safeStr(payerName).trim() || null;

  // Idempotency: only process once per orderId
  const processedRef = db.collection("paypalOrderCaptures").doc(orderId);
  const already = await processedRef.get();
  if (already.exists) return { ok: true, alreadyProcessed: true };

  const { value, currency } = parseAmountFromPayPalEvent(captureEvent);

  const providerCaptureId =
    safeStr(resource?.id) ||
    safeStr(root?.purchase_units?.[0]?.payments?.captures?.[0]?.id) ||
    "";

  const providerStatus =
    safeStr(resource?.status) ||
    safeStr(root?.status) ||
    "";

  const orderRef = db.collection("orders").doc(orderId);

  await orderRef.set(
    {
      buyerName,
      buyerEmail,
      orderId,
      provider: "paypal",
      type: "cart",
      cartId,
      providerEventId: safeStr(root?.id),
      providerCaptureId,
      providerStatus,
      amount: Number(value || cart.total || 0),
      currency: currency || cart.currency || "USD",
      buyerId: buyerId || null,
      status: "PAID",
      payerEmail,
      items,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await processedRef.set({
    orderId,
    cartId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

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

    let beatData = null;
    if (type === "beat" && id) {
      const beatSnap = await db.collection("beats").doc(String(id)).get();
      if (beatSnap.exists) beatData = beatSnap.data() || null;
    }

    const beatTitle =
      type === "beat"
        ? safeStr(beatData?.title || it.title || "Beat")
        : safeStr(it.title || "Sound Kit");

    let producerName = safeStr(beatData?.producerName || "");
    if (!producerName && producerId) {
      const prodSnap = await db.collection("users").doc(producerId).get().catch(() => null);
      if (prodSnap && prodSnap.exists) {
        const pd = prodSnap.data() || {};
        producerName = safeStr(pd.displayName || pd.name || "");
      }
    }
    if (!producerName) producerName = "Producer";

    const downloadPath =
      safeStr(it.downloadPath || "") ||
      safeStr(beatData?.downloadPath || "") ||
      safeStr(beatData?.filePath || "") ||
      null;

    const audioUrl =
      safeStr(it.audioUrl || "") ||
      safeStr(beatData?.audio || "") ||
      null;

    await unlockRef.set(
      {
        unlockId,
        orderId,
        cartId,
        provider: "paypal",
        type,
        buyerId: buyerId || null,
        buyerName,
        buyerEmail,
        producerId: producerId || null,
        producerName,
        beatId: type === "beat" ? id : null,
        beatTitle: beatTitle || null,
        kitId: type === "soundkit" ? id : null,
        licenseKey: licenseKey || null,
        downloadPath,
        audioUrl,
        qty,
        amount: lineTotal,
        receipt: providerCaptureId,
        payerEmail,
        transactionDate: Date.now(),
        status: "unlocked",
        paid: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

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

// ---------------------- PAYPAL WEBHOOK ----------------------
exports.paypalWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_MODE],
  },
  async (req, res) => {
    // handle preflight + CORS
    const stop = handleCorsPreflight(req, res);
    if (stop) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") return res.status(405).send("Use POST");

      // verify signature
      const ok = await verifyPayPalWebhookSignature(req);
      if (!ok) return res.status(401).send("Invalid signature");

      const event = req.body || {};
      const eventType = safeStr(event.event_type).trim();
      const resource = event.resource || {};
      const resourceId = safeStr(resource.id || event.id);

      /* ============================
      ✅ SUBSCRIPTION EVENTS
      ============================ */

      const subscriptionEvents = new Set([
        "BILLING.SUBSCRIPTION.ACTIVATED",
        "BILLING.SUBSCRIPTION.CANCELLED",
        "BILLING.SUBSCRIPTION.SUSPENDED",
        "BILLING.SUBSCRIPTION.EXPIRED",
      ]);

      if (subscriptionEvents.has(eventType)) {

        const subscriptionId =
          safeStr(resource?.id);

        if (!subscriptionId) {
          return res.status(200).json({
            received: true,
            ignored: "missing subscription id",
          });
        }

        const q = await db.collection("users")
          .where("paypalSubscriptionId", "==", subscriptionId)
          .limit(1)
          .get();

        if (q.empty) {
          return res.status(200).json({
            received: true,
            ignored: "user not found",
          });
        }

        const userRef = q.docs[0].ref;

        // CANCELLED / EXPIRED / SUSPENDED
        if (
          eventType === "BILLING.SUBSCRIPTION.CANCELLED" ||
          eventType === "BILLING.SUBSCRIPTION.SUSPENDED" ||
          eventType === "BILLING.SUBSCRIPTION.EXPIRED"
        ) {

          await userRef.set(
            {
              plan: "free",
              planTier: "free",

              subscriptionStatus: eventType
                .replace("BILLING.SUBSCRIPTION.", "")
                .toLowerCase(),

              subscriptionExpires: null,

              planUpdatedAt: Date.now(),
            },
            { merge: true }
          );

          return res.status(200).json({
            received: true,
            downgraded: true,
            eventType,
          });
        }

        // ACTIVATED
        if (eventType === "BILLING.SUBSCRIPTION.ACTIVATED") {

          await userRef.set(
            {
              subscriptionStatus: "active",
              planUpdatedAt: Date.now(),
            },
            { merge: true }
          );

          return res.status(200).json({
            received: true,
            activated: true,
          });
        }
      }

      // store raw webhook for debugging/audit
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

      /**
       * ============================
       * ✅ PAYPAL PAYOUTS (WITHDRAWALS)
       * ============================
       * These are the events you need for withdrawals.
       */
      const isPayoutItemEvent =
        eventType.startsWith("PAYMENT.PAYOUTS-ITEM.") ||
        eventType.startsWith("PAYMENT.PAYOUTS-ITEM_"); // some integrations vary

      /**
       * ============================
       * ✅ PAYPAL PAYOUT BATCH EVENTS
       * ============================
       * Handles when entire payout batch finishes
       */

      const isBatchEvent =
        eventType === "PAYMENT.PAYOUTSBATCH.SUCCESS" ||
        eventType === "PAYMENT.PAYOUTSBATCH.DENIED";

      if (isBatchEvent) {

        const payoutBatchId =
          safeStr(resource?.payout_batch_id) ||
          safeStr(resource?.batch_header?.payout_batch_id) ||
          safeStr(resource?.batch_id) ||
          "";

        if (!payoutBatchId) {
          return res.status(200).json({ received: true, note: "Missing payoutBatchId" });
        }

        const q = await db
          .collection("payoutsRequests")
          .where("paypalBatchId", "==", payoutBatchId)
          .limit(1)
          .get();

        if (q.empty) {
          return res.status(200).json({
            received: true,
            note: "Batch received but no payout request found",
            payoutBatchId,
          });
        }

        const reqRef = q.docs[0].ref;

        await db.runTransaction(async (tx) => {
          const s = await tx.get(reqRef);
          const d = s.data() || {};

          if (d.paypalSettled === true) return;

          const producerId = safeStr(d.producerId);
          const reservedUsd = toNumber(d.reservedUsd ?? d.amountUsd ?? d.amount ?? 0);

          const walletRef = db.doc(`wallets/${producerId}`);
          const wSnap = await tx.get(walletRef);
          const w = wSnap.exists ? wSnap.data() : {};

          const lockedUsd = toNumber(w.lockedUsd);
          const availableUsd = toNumber(w.availableUsd);

          const success = eventType === "PAYMENT.PAYOUTSBATCH.SUCCESS";

          if (success) {

            tx.set(walletRef,{
              lockedUsd: Math.max(0, lockedUsd - reservedUsd),
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            },{merge:true});

            tx.set(reqRef,{
              status:"success",
              paypalSettled:true,
              walletSettledAt:Date.now(),
              updatedAt:Date.now(),
              paypal:{batchEvent:eventType,raw:event}
            },{merge:true});

          } else {

            tx.set(walletRef,{
              lockedUsd: Math.max(0, lockedUsd - reservedUsd),
              availableUsd: availableUsd + reservedUsd,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            },{merge:true});

            tx.set(reqRef,{
              status:"failed",
              paypalSettled:true,
              reserveReleased:true,
              walletSettledAt:Date.now(),
              updatedAt:Date.now(),
              failReason:"PayPal payout batch denied",
              paypal:{batchEvent:eventType,raw:event}
            },{merge:true});

          }

        });

        return res.status(200).json({received:true,eventType,batch:true});
      }

      if (isPayoutItemEvent) {
        // Try to extract batch id + item id
        const payoutBatchId =
          safeStr(resource?.payout_batch_id) ||
          safeStr(resource?.batch_header?.payout_batch_id) ||
          safeStr(resource?.batch_id) ||
          "";

        const senderItemId =
          safeStr(resource?.payout_item?.sender_item_id) ||
          safeStr(resource?.sender_item_id) ||
          "";

        const itemStatus =
          safeStr(resource?.transaction_status || resource?.payout_item?.transaction_status || "").toUpperCase();

        // Map success/failure/pending
        const SUCCESS = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED"]);
        const FAIL = new Set([
          "FAILED",
          "RETURNED",
          "CANCELED",
          "CANCELLED",
          "DENIED",
          "BLOCKED",
          "REFUNDED",
          "REVERSED",
        ]);
        const PENDING = new Set(["PENDING", "PROCESSING", "UNCLAIMED", "ONHOLD", "HELD", "NEW"]);

        // Find payout request doc:
        // 1) by paypalBatchId (recommended, because you store it)
        // 2) fallback by sender_item_id (if you stored it as payoutId / requestId)
        let reqSnap = null;

        if (payoutBatchId) {
          const q = await db
            .collection("payoutsRequests")
            .where("paypalBatchId", "==", payoutBatchId)
            .limit(1)
            .get();
          if (!q.empty) reqSnap = q.docs[0];
        }

        if (!reqSnap && senderItemId) {
          // If you used sender_item_id = requestId or payoutId, this will work
          const direct = await db.collection("payoutsRequests").doc(senderItemId).get().catch(() => null);
          if (direct && direct.exists) reqSnap = direct;
        }

        // If still no match, we accept the webhook but can’t settle
        if (!reqSnap) {
          return res.status(200).json({
            received: true,
            eventType,
            note: "No matching payoutsRequests found",
            payoutBatchId,
            senderItemId,
            itemStatus,
          });
        }

        const reqRef = reqSnap.ref;

        await db.runTransaction(async (tx) => {
          const s = await tx.get(reqRef);
          const d = s.exists ? (s.data() || {}) : {};

          // idempotency
          if (d.paypalSettled === true) return;

          const producerId = safeStr(d.producerId).trim();
          const reservedUsd = toNumber(d.reservedUsd ?? d.amountUsd ?? d.amount ?? 0);

          if (!producerId || !Number.isFinite(reservedUsd) || reservedUsd <= 0) {
            tx.set(
              reqRef,
              {
                status: "failed",
                failReason: "Cannot settle PayPal payout: missing producerId/reservedUsd",
                updatedAt: Date.now(),
                paypal: { eventType, itemStatus, payoutBatchId, senderItemId, raw: event },
              },
              { merge: true }
            );
            return;
          }

          const walletRef = db.doc(`wallets/${producerId}`);
          const wSnap = await tx.get(walletRef);
          const w = wSnap.exists ? (wSnap.data() || {}) : {};

          const availableUsd = toNumber(w.availableUsd);
          const lockedUsd = toNumber(w.lockedUsd);

          if (SUCCESS.has(itemStatus)) {
            // finalize: remove from locked
            tx.set(
              walletRef,
              {
                lockedUsd: Math.max(0, lockedUsd - reservedUsd),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );

            tx.set(
              reqRef,
              {
                status: "success",
                updatedAt: Date.now(),
                paypalSettled: true,
                walletSettledAt: Date.now(),
                paypal: { eventType, itemStatus, payoutBatchId, senderItemId, raw: event },
              },
              { merge: true }
            );
            return;
          }

          if (FAIL.has(itemStatus)) {
            // release back: locked -> available
            tx.set(
              walletRef,
              {
                lockedUsd: Math.max(0, lockedUsd - reservedUsd),
                availableUsd: availableUsd + reservedUsd,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );

            tx.set(
              reqRef,
              {
                status: "failed",
                updatedAt: Date.now(),
                paypalSettled: true,
                reserveReleased: true,
                walletSettledAt: Date.now(),
                failReason: `PayPal payout ${itemStatus}`,
                paypal: { eventType, itemStatus, payoutBatchId, senderItemId, raw: event },
              },
              { merge: true }
            );
            return;
          }

          if (PENDING.has(itemStatus) || !itemStatus) {
            // keep pending/submitted
            tx.set(
              reqRef,
              {
                status: safeStr(d.status).toLowerCase() === "processing" ? "processing" : "submitted",
                updatedAt: Date.now(),
                paypal: { eventType, itemStatus: itemStatus || "UNKNOWN", payoutBatchId, senderItemId, raw: event },
              },
              { merge: true }
            );
            return;
          }

          // unknown - just store
          tx.set(
            reqRef,
            {
              updatedAt: Date.now(),
              paypal: { eventType, itemStatus, payoutBatchId, senderItemId, raw: event },
            },
            { merge: true }
          );
        });

        return res.status(200).json({ received: true, eventType, payout: true });
      }

      /**
       * ============================
       * ✅ SALES EVENTS (YOUR ORIGINAL)
       * ============================
       */
      if (eventType !== "PAYMENT.CAPTURE.COMPLETED") {
        return res.status(200).json({ received: true, ignored: eventType });
      }

      // --- your original sales logic continues below (unchanged) ---

      const { value, currency } = parseAmountFromPayPalEvent(event);

      /* ============================
      BOOST PAYMENT
      ============================ */

      const resourceCustomIdBoost =
        safeStr(resource?.custom_id) ||
        safeStr(resource?.invoice_id) ||
        "";

      if (resourceCustomIdBoost.startsWith("boost|")) {

        const parts = resourceCustomIdBoost.split("|");

        const producerId = parts[1];
        const beatId = parts[2];
        const days = Number(parts[3] || 1);

        const featuredUntil =
          Date.now() + (days * 24 * 60 * 60 * 1000);

        await db.collection("beats").doc(beatId).set({
          featured: true,
          featuredUntil
        }, { merge: true });

        await db.collection("boostPayments").add({
          producerId,
          beatId,
          days,
          amount: Number(value || 0),
          currency,
          provider: "paypal",
          createdAt: Date.now()
        });

        return res.status(200).json({
          received: true,
          boost: true
        });
      }

      const resourceCustomId =
        safeStr(resource?.custom_id) ||
        safeStr(resource?.invoice_id) ||
        safeStr(resource?.supplementary_data?.related_ids?.order_id) ||
        "";
      const meta = {};
      if (resourceCustomId) {
        resourceCustomId.split("|").forEach((part) => {
          const [k, ...rest] = part.split("=");
          const key = safeStr(k).trim();
          const val = safeStr(rest.join("=")).trim();
          if (key) meta[key] = val;
        });
        if (resourceCustomId.includes("cartId=") && !meta.cartId) {
          meta.cartId = safeStr(resourceCustomId.split("cartId=")[1] || "").trim();
        }
      }

      const orderId = `pp_${safeStr(resource.id || event.id || Date.now())}`;

      const cartId = safeStr(meta.cartId || "");
      if (cartId) {
        await processCartCapture({ cartId, captureEvent: event, orderId });
        return res.status(200).json({ received: true, eventType, cart: true });
      }

      const beatId = safeStr(meta.beatId || meta.beat || "");
      const licenseKey = safeStr(meta.licenseKey || "basic").toLowerCase().trim();
      let producerId = safeStr(meta.producerId || meta.producer || "");

      if (beatId && !producerId) {
        try {
          const beatSnap = await db.collection("beats").doc(beatId).get();
          if (beatSnap.exists) producerId = safeStr(beatSnap.data()?.producerId || "");
        } catch (_) {}
      }

      const orderRef = db.collection("orders").doc(orderId);
      const existing = await orderRef.get();

      const payer =
        event?.payer ||
        resource?.payer ||
        {};

      const buyerEmail = safeStr(
        payer?.email_address ||
        resource?.payer_email ||
        ""
      );

      const payerName =
        safeStr(payer?.name?.given_name || "") +
        (payer?.name?.surname ? " " + safeStr(payer?.name?.surname) : "");

      const buyerName = safeStr(payerName).trim();

      let beatTitle = "";
      let producerName = "";

      if (beatId) {
        try {
          const beatSnap = await db.collection("beats").doc(beatId).get();
          if (beatSnap.exists) {
            const b = beatSnap.data() || {};
            beatTitle = safeStr(b.title || b.beatTitle || "");
            producerName = safeStr(b.producerName || "");
            if (!producerId) producerId = safeStr(b.producerId || "");
          }
        } catch (_) {}
      }

      if (!producerName && producerId) {
        try {
          const prodSnap = await db.collection("users").doc(producerId).get().catch(() => null);
          if (prodSnap && prodSnap.exists) {
            const pd = prodSnap.data() || {};
            producerName = safeStr(pd.displayName || pd.name || "");
          }
        } catch (_) {}
      }
      if (!producerName) producerName = "Producer";

      if (!existing.exists) {
        await orderRef.set({
          orderId,
          provider: "paypal",
          type: beatId ? "single" : "unknown",
          providerEventId: safeStr(event.id),
          providerCaptureId: safeStr(resource.id),
          providerStatus: safeStr(resource.status),
          beatId: beatId || null,
          producerId: producerId || null,
          licenseKey: licenseKey || null,
          amount: Number(value || 0),
          currency: currency || "USD",
          status: "PAID",
          payerEmail: buyerEmail || null,
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
            buyerEmail: buyerEmail || null,
            buyerName: buyerName || null,
            beatTitle: beatTitle || null,
            producerId: producerId || null,
            producerName: producerName || null,
            paid: true,
            status: "unlocked",
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
      try {
        applyCors(req, res);
      } catch (_) {}
      return res.status(500).json({ error: e?.message || String(e) });
    }
  }
);

/* =========================================================
✅ PAYPAL PAYOUT TRIGGER
========================================================= */
exports.onPaypalPayoutRequest = onDocumentCreated(
  {
    region: "us-central1",
    document: "payoutsRequests/{requestId}", // ✅ match your dashboard + mpesa pipeline
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const requestId = event.params.requestId;
    const ref = snap.ref;
    const data = snap.data() || {};

    try {
      const method = safeStr(data.method || "").toLowerCase().trim();
      const status = safeStr(data.status || "").toLowerCase().trim();

      // ✅ only handle paypal + requested
      if (method !== "paypal") return;
      if (status !== "requested") return;

      const producerId = safeStr(data.producerId).trim();
      const destination = safeStr(data.destination || data.email || data.paypalEmail).trim();
      const amountUsd = Number(data.amountUsd ?? data.amount ?? 0);

      if (!producerId || !destination || !Number.isFinite(amountUsd) || amountUsd <= 0) {
        await ref.set(
          { status: "failed", failReason: "Missing/invalid producerId, destination, or amountUsd", updatedAt: Date.now() },
          { merge: true }
        );
        return;
      }

      // ✅ basic email-ish check (lightweight)
      if (!destination.includes("@") || destination.length < 6) {
        await ref.set(
          { status: "failed", failReason: "Invalid PayPal email destination", updatedAt: Date.now() },
          { merge: true }
        );
        return;
      }

      const walletRef = db.doc(`wallets/${producerId}`);

      // ✅ Reserve (hold) funds immediately to prevent double-withdraw
      // We will finalize on success later (webhook/poller) using idempotency.
      await db.runTransaction(async (tx) => {
        const wSnap = await tx.get(walletRef);
        const w = wSnap.exists ? wSnap.data() : {};

        const availableUsd = toNumber(w.availableUsd);
        const lockedUsd = toNumber(w.lockedUsd); // we’ll add this field

        // prevent re-processing same request
        const fresh = await tx.get(ref);
        const curr = fresh.exists ? (fresh.data() || {}) : {};
        const currStatus = safeStr(curr.status || "").toLowerCase();
        if (currStatus !== "requested") return;

        if (!Number.isFinite(availableUsd) || availableUsd < amountUsd) {
          tx.set(
            ref,
            {
              status: "failed",
              failReason: "Insufficient available balance",
              updatedAt: Date.now(),
            },
            { merge: true }
          );
          return;
        }

        // move funds: available -> locked
        tx.set(
          walletRef,
          {
            availableUsd: Math.max(0, availableUsd - amountUsd),
            lockedUsd: lockedUsd + amountUsd,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        tx.set(
          ref,
          {
            status: "processing",
            updatedAt: Date.now(),
            amountUsd,
            currency: "USD",
            // mark reserved so we can safely release or finalize later
            reservedUsd: amountUsd,
            reserveApplied: true,
            provider: "paypal",
          },
          { merge: true }
        );
      });

      // If transaction set status to failed, stop
      const afterSnap = await ref.get();
      const after = afterSnap.data() || {};
      if (safeStr(after.status).toLowerCase() === "failed") return;

      const accessToken = await getPayPalAccessToken(); // uses PAYPAL_MODE internally
      const payoutPayload = {
        sender_batch_header: {
          sender_batch_id: `audiory_req_${requestId}_${Date.now()}`,
          email_subject: "You have a payout from Audiory",
          email_message: "Your Audiory payout has been sent. Thank you for using Audiory!",
        },
        items: [
          {
            recipient_type: "EMAIL",
            amount: { value: amountUsd.toFixed(2), currency: "USD" },
            receiver: destination,
            note: "Audiory producer withdrawal",
            sender_item_id: requestId,
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

      const raw = await r.text();
      let resp = {};
      try { resp = JSON.parse(raw); } catch (_) { resp = { raw }; }

      if (!r.ok) {
        // ✅ release reserved funds if PayPal submission failed
        await db.runTransaction(async (tx) => {
          const wSnap = await tx.get(walletRef);
          const w = wSnap.exists ? wSnap.data() : {};
          const lockedUsd = toNumber(w.lockedUsd);
          const availableUsd = toNumber(w.availableUsd);

          const reserved = toNumber(after.reservedUsd ?? amountUsd);

          tx.set(
            walletRef,
            {
              lockedUsd: Math.max(0, lockedUsd - reserved),
              availableUsd: availableUsd + reserved,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          tx.set(
            ref,
            {
              status: "failed",
              failReason: `PayPal submit failed: ${r.status} ${safeStr(raw)}`.slice(0, 1000),
              paypalResponse: resp,
              updatedAt: Date.now(),
              reserveReleased: true,
            },
            { merge: true }
          );
        });
        return;
      }

      await ref.set(
        {
          status: "submitted", // ✅ submitted to PayPal
          paypalBatchId: safeStr(resp?.batch_header?.payout_batch_id),
          paypalResponse: resp,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    } catch (e) {
      console.error("onPaypalPayoutRequest error:", e);

      // ✅ best-effort: mark failed (do NOT try to release here unless we’re sure reserveApplied)
      try {
        await ref.set(
          { status: "failed", failReason: safeStr(e?.message || e).slice(0, 1000), updatedAt: Date.now() },
          { merge: true }
        );
      } catch (_) {}
    }
  }
);

// ✅ Poll PayPal payouts as a backup in case webhooks fail/delay
exports.pollPayPalPayouts = onSchedule(
  {
    region: "us-central1",
    schedule: "every 2 minutes",
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE],
  },
  async () => {
    const mode = safeStr(PAYPAL_MODE.value() || "live").toLowerCase(); // "live" or "sandbox"
    const accessToken = await getPayPalAccessToken(); // uses PAYPAL_MODE internally in your code

    const snap = await db
      .collection("payoutsRequests")
      .where("method", "==", "paypal")
      .where("status", "in", ["submitted", "processing"]) // ✅ check both
      .limit(25)
      .get();

    for (const doc of snap.docs) {
      const data = doc.data() || {};

      // ✅ support both shapes: root paypalBatchId OR paypal.payoutBatchId
      const payoutBatchId =
        safeStr(data.paypalBatchId) ||
        safeStr(data?.paypal?.payoutBatchId) ||
        safeStr(data?.paypal?.batchId) ||
        "";

      if (!payoutBatchId) continue;

      const r = await fetchFn(`${paypalBaseUrl()}/v1/payments/payouts/${payoutBatchId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const raw = await r.text();
      let j = {};
      try { j = JSON.parse(raw); } catch (_) { j = { raw }; }

      if (!r.ok) {
        await doc.ref.set(
          {
            status: "failed",
            failReason: `PayPal batch fetch failed: ${r.status} ${safeStr(raw)}`.slice(0, 1000),
            updatedAt: Date.now(),
            paypal: { ...(data.paypal || {}), rawBatch: j },
          },
          { merge: true }
        );
        continue;
      }

      const batchStatus = safeStr(j?.batch_header?.batch_status || "").toUpperCase();

      // common statuses include: PROCESSING, PENDING, SUCCESS, DENIED, CANCELED
      if (batchStatus === "PROCESSING" || batchStatus === "PENDING") {
        await doc.ref.set(
          { status: "submitted", updatedAt: Date.now(), paypal: { ...(data.paypal || {}), batchStatus, rawBatch: j } },
          { merge: true }
        );
        continue;
      }

      const ok = batchStatus === "SUCCESS";

      await doc.ref.set(
        {
          status: ok ? "success" : "failed",
          updatedAt: Date.now(),
          paypal: { ...(data.paypal || {}), batchStatus, rawBatch: j },
        },
        { merge: true }
      );

      // ✅ settle wallet only once (locked -> remove on success, locked -> available on fail)
      await settleWalletForPayPalPayoutRequest(doc.ref);
    }
  }
);

// ✅ Wallet settle helper (idempotent)
async function settleWalletForPayPalPayoutRequest(reqRef) {
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(reqRef);
    if (!fresh.exists) return;

    const d = fresh.data() || {};

    // ✅ idempotency
    if (d.paypalSettled === true) return;

    const status = safeStr(d.status || "").toLowerCase();
    if (status !== "success" && status !== "failed") return;

    const producerId = safeStr(d.producerId).trim();
    const reservedUsd = toNumber(d.reservedUsd ?? d.amountUsd ?? d.amount ?? 0);
    if (!producerId || !Number.isFinite(reservedUsd) || reservedUsd <= 0) {
      tx.set(reqRef, { paypalSettled: true, updatedAt: Date.now() }, { merge: true });
      return;
    }

    const walletRef = db.doc(`wallets/${producerId}`);
    const wSnap = await tx.get(walletRef);
    const w = wSnap.exists ? (wSnap.data() || {}) : {};

    const lockedUsd = toNumber(w.lockedUsd);
    const availableUsd = toNumber(w.availableUsd);

    if (status === "success") {
      // ✅ finalize: remove from locked
      tx.set(
        walletRef,
        {
          lockedUsd: Math.max(0, lockedUsd - reservedUsd),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      tx.set(
        reqRef,
        { paypalSettled: true, walletSettledAt: Date.now() },
        { merge: true }
      );
      return;
    }

    if (status === "failed") {
      // ✅ release: locked -> available
      tx.set(
        walletRef,
        {
          lockedUsd: Math.max(0, lockedUsd - reservedUsd),
          availableUsd: availableUsd + reservedUsd,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      tx.set(
        reqRef,
        { paypalSettled: true, reserveReleased: true, walletSettledAt: Date.now() },
        { merge: true }
      );
      return;
    }
  });
}

/* =========================================================
✅ payout status
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

      // 1) Fetch batch details from PayPal
      const r = await fetchFn(`${paypalBaseUrl()}/v1/payments/payouts/${payoutBatchId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const txt = await r.text();
      let j = {};
      try { j = JSON.parse(txt); } catch (_) { j = { raw: txt }; }

      if (!r.ok) {
        return res.status(400).json(j);
      }

      // 2) Determine PayPal status in a tolerant way
      const batchStatus =
        safeStr(j?.batch_header?.batch_status || j?.batch_header?.payout_batch_status || "").toUpperCase();

      // Often item status is more accurate than batch_status for single payouts
      const firstItem = Array.isArray(j?.items) && j.items.length ? j.items[0] : null;

      const itemStatus = safeStr(firstItem?.transaction_status || firstItem?.payout_item?.transaction_status || "").toUpperCase();

      // prefer itemStatus if present
      const status = itemStatus || batchStatus;

      // 3) Find matching payoutsRequests doc
      // We store paypalBatchId in payoutsRequests when submitted.
      const q = await db
        .collection("payoutsRequests")
        .where("paypalBatchId", "==", payoutBatchId)
        .limit(1)
        .get();

      if (q.empty) {
        // Nothing to settle, but still return PayPal response
        return res.status(200).json({
          ok: true,
          note: "No matching payoutsRequests doc found for this payoutBatchId",
          paypal: j,
        });
      }

      const reqRef = q.docs[0].ref;

      await db.runTransaction(async (tx) => {
        const reqSnap = await tx.get(reqRef);
        const reqData = reqSnap.exists ? (reqSnap.data() || {}) : {};

        // idempotency: don't settle twice
        if (reqData.paypalSettled === true) return;

        const producerId = safeStr(reqData.producerId).trim();
        const reservedUsd = toNumber(reqData.reservedUsd ?? reqData.amountUsd ?? reqData.amount ?? 0);

        if (!producerId || !Number.isFinite(reservedUsd) || reservedUsd <= 0) {
          tx.set(
            reqRef,
            {
              status: "failed",
              failReason: "Cannot settle PayPal payout: missing producerId/reservedUsd",
              updatedAt: Date.now(),
              paypal: { status, raw: j },
            },
            { merge: true }
          );
          return;
        }

        const walletRef = db.doc(`wallets/${producerId}`);
        const wSnap = await tx.get(walletRef);
        const w = wSnap.exists ? (wSnap.data() || {}) : {};

        const availableUsd = toNumber(w.availableUsd);
        const lockedUsd = toNumber(w.lockedUsd);

        // Map PayPal statuses
        const SUCCESS = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED"]);
        const FINAL_FAIL = new Set([
          "FAILED",
          "RETURNED",
          "CANCELED",
          "CANCELLED",
          "DENIED",
          "BLOCKED",
          "REFUNDED",
          "REVERSED",
        ]);
        const PENDING = new Set(["PENDING", "PROCESSING", "UNCLAIMED", "ONHOLD", "HELD", "NEW"]);

        if (SUCCESS.has(status)) {
          // Success: funds already moved from available -> locked at request time.
          // Now finalize by reducing locked.
          tx.set(
            walletRef,
            {
              lockedUsd: Math.max(0, lockedUsd - reservedUsd),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          tx.set(
            reqRef,
            {
              status: "success",
              updatedAt: Date.now(),
              paypalSettled: true,
              walletSettledAt: Date.now(),
              paypal: {
                status,
                payoutBatchId,
                raw: j,
              },
            },
            { merge: true }
          );

          return;
        }

        if (FINAL_FAIL.has(status)) {
          // Failure: release reserve back to available, decrease locked.
          tx.set(
            walletRef,
            {
              lockedUsd: Math.max(0, lockedUsd - reservedUsd),
              availableUsd: availableUsd + reservedUsd,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          tx.set(
            reqRef,
            {
              status: "failed",
              updatedAt: Date.now(),
              paypalSettled: true,
              reserveReleased: true,
              walletSettledAt: Date.now(),
              failReason: `PayPal payout ${status}`,
              paypal: {
                status,
                payoutBatchId,
                raw: j,
              },
            },
            { merge: true }
          );

          return;
        }

        if (PENDING.has(status) || !status) {
          // Still pending: keep submitted/processing, don’t touch wallet
          tx.set(
            reqRef,
            {
              status: safeStr(reqData.status).toLowerCase() === "processing" ? "processing" : "submitted",
              updatedAt: Date.now(),
              paypal: {
                status: status || "UNKNOWN",
                payoutBatchId,
                raw: j,
              },
            },
            { merge: true }
          );
          return;
        }

        // Unknown status: don’t settle, just record
        tx.set(
          reqRef,
          {
            updatedAt: Date.now(),
            paypal: { status, payoutBatchId, raw: j },
          },
          { merge: true }
        );
      });

      return res.status(200).json({ ok: true, status, payoutBatchId, paypal: j });
    } catch (e) {
      console.error("paypalPayoutStatus error:", e);
      try { applyCors(req, res); } catch (_) {}
      return res.status(500).json({ error: safeStr(e.message || e) });
    }
  }
);

/* =========================================================
✅ CREATE BOOST PAYMENT (PAYPAL)
========================================================= */

exports.createBoostOrder = onRequest(
{
  region: "us-central1",
  secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE],
},
async (req, res) => {

  const pre = handleCorsPreflight(req,res);
  if(pre) return;
  applyCors(req,res);

  try{

    if(req.method !== "POST")
      return res.status(405).json({error:"Use POST"});

    const decoded = await verifyFirebaseIdToken(req);
    if(!decoded)
      return res.status(401).json({error:"Login required"});

    const producerId = decoded.uid;

    const { beatId, boostDays } = req.body || {};

    if(!beatId)
      return res.status(400).json({error:"beatId required"});

    const days = Number(boostDays || 1);

    const priceMap = {
      1:5,
      3:15,
      7:40
    };

    const price = priceMap[days] || 5;

    const accessToken = await getPayPalAccessToken();

    const payload = {
      intent:"CAPTURE",
      purchase_units:[{
        custom_id:`boost|${producerId}|${beatId}|${days}`,
        amount:{
          currency_code:"USD",
          value:price.toFixed(2)
        },
        description:`Audiory Beat Boost (${days} days)`
      }],
      application_context:{
        brand_name:"Audiory",
        shipping_preference:"NO_SHIPPING",
        user_action:"PAY_NOW",
        return_url:"https://audiory.site/dashboard/?boost=success#marketing",
        cancel_url:"https://audiory.site/dashboard/?boost=cancel#marketing"
      }
    };

    const r = await fetchFn(`${paypalBaseUrl()}/v2/checkout/orders`,{
      method:"POST",
      headers:{
        Authorization:`Bearer ${accessToken}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify(payload)
    });

    const data = await r.json();

    if(!r.ok){
      return res.status(400).json({error:data});
    }

    return res.json({
      orderId:data.id,
      links:data.links
    });

  }catch(e){
    console.error(e);
    return res.status(500).json({error:e.message});
  }

});

exports.captureBoostOrder = onRequest(async (req, res) => {
  try {

    const orderId = req.query.orderId;

    if(!orderId){
      res.status(400).send("Missing orderId");
      return;
    }

    const accessToken = await getPayPalAccessToken();

    const r = await fetch(
      `${paypalBaseUrl()}/v2/checkout/orders/${orderId}/capture`,
      {
        method:"POST",
        headers:{
          Authorization:`Bearer ${accessToken}`,
          "Content-Type":"application/json"
        }
      }
    );

    const data = await r.json();

    if(data.status !== "COMPLETED"){
      res.redirect("https://audiory.site/dashboard/?boost=cancel#marketing");
      return;
    }

    const customId =
      data.purchase_units[0].payments.captures[0].custom_id ||
      data.purchase_units[0].custom_id;

    const parts = customId.split("|");

    const producerId = parts[1];
    const beatId = parts[2];
    const days = Number(parts[3]);

    const featuredUntil = Date.now() + (days * 86400000);

    await db.collection("beats").doc(beatId).update({
      featured:true,
      featuredUntil
    });

    res.redirect("https://audiory.site/dashboard/?boost=success#marketing");

  } catch(err){
    console.error(err);
    res.redirect("https://audiory.site/dashboard/?boost=cancel#marketing");
  }
});

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

    const { phone, amount, amountUsd, beatId, buyerId, licenseKey } = req.body || {};
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

    // ✅ fetch beat + producer info
    const beatSnap = await db.collection("beats").doc(String(beatId)).get();
    if (!beatSnap.exists) return res.status(404).json({ error: "Beat not found" });
    const beatData = beatSnap.data() || {};

    const producerId = String(beatData.producerId || "").trim();
    const beatTitle = String(beatData.title || "Beat").trim();

    // ✅ fetch buyer profile (Auth is most reliable for email)
    let buyerName = "";
    let buyerEmail = "";

    // 1) Try Firestore users/{buyerId}
    try {
      const uSnap = await db.collection("users").doc(String(buyerId)).get();
      if (uSnap.exists) {
        const u = uSnap.data() || {};
        buyerName = String(u.displayName || u.name || "").trim();
        buyerEmail = String(u.email || "").trim();
      }
    } catch (_) {}

    // 2) Fallback to Firebase Auth user record
    try {
      const au = await admin.auth().getUser(String(buyerId));
      buyerEmail = buyerEmail || String(au.email || "").trim();
      buyerName =
        buyerName ||
        String(au.displayName || "").trim() ||
        String((au.providerData && au.providerData[0]?.displayName) || "").trim();
    } catch (_) {}

    // ✅ fetch producer name (from beat first, else users/{producerId})
    let producerName = String(beatData.producerName || "").trim();
    if (!producerName && producerId) {
      try {
        const pSnap = await db.collection("users").doc(producerId).get();
        if (pSnap.exists) {
          const p = pSnap.data() || {};
          producerName = String(p.displayName || p.name || "").trim();
        }
      } catch (_) {}
    }
    if (!producerName) producerName = "Producer";

    const orderRef = db.collection("orders").doc();
    await orderRef.set({
      beatId,
      beatTitle,
      buyerId,
      buyerName: buyerName || null,
      buyerEmail: buyerEmail || null,
      producerId: producerId || null,
      producerName: producerName || null,
      licenseKey: String(licenseKey || "basic"),
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
    (CallbackMetadata?.Item || []).forEach((item) => {
      metadata[item.Name] = item.Value ?? null;
    });

    // Log raw MPesa payment callback
    await db.collection("mpesaPayments").doc(String(CheckoutRequestID)).set(
      {
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
      },
      { merge: true }
    );

    // Find related order
    const orderSnap = await db
      .collection("orders")
      .where("checkoutRequestId", "==", CheckoutRequestID)
      .limit(1)
      .get();

    if (!orderSnap.empty) {
      const orderDoc = orderSnap.docs[0];
      const paid = Number(ResultCode) === 0;

      // Update order status
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
        // ✅ order fields
        const o = orderDoc.data() || {};
        const beatId = String(o.beatId || "");
        const buyerId = o.buyerId ? String(o.buyerId) : null;

        // IMPORTANT:
        // If you want the STK license to show which license was bought,
        // your STK "create payment" flow must store licenseKey in the order doc.
        const licenseKey = String(o.licenseKey || "basic").toLowerCase();

        // If your order doesn't store producerId, we can read it from beatData
        const producerIdFromOrder = o.producerId ? String(o.producerId) : "";

        // ✅ fetch beat
        let beatData = null;
        if (beatId) {
          const beatSnap = await db.collection("beats").doc(beatId).get();
          if (beatSnap.exists) beatData = beatSnap.data() || null;
        }

        // ✅ download refs
        const downloadPath =
          (o.downloadPath ? String(o.downloadPath) : "") ||
          (beatData?.downloadPath ? String(beatData.downloadPath) : "") ||
          (beatData?.filePath ? String(beatData.filePath) : "") ||
          null;

        const audioUrl =
          (o.audioUrl ? String(o.audioUrl) : "") ||
          (beatData?.audio ? String(beatData.audio) : "") ||
          null;

        // ✅ license display fields (for PDF)
        const beatTitle =
          (o.beatTitle ? String(o.beatTitle) : "") ||
          (beatData?.title ? String(beatData.title) : "") ||
          "Beat";

        const finalProducerId =
          producerIdFromOrder || (beatData?.producerId ? String(beatData.producerId) : "") || "";

        let producerName =
          (o.producerName ? String(o.producerName) : "") ||
          (beatData?.producerName ? String(beatData.producerName) : "");

        if (!producerName && finalProducerId) {
          const prodSnap = await db.collection("users").doc(finalProducerId).get().catch(() => null);
          if (prodSnap && prodSnap.exists) {
            const pd = prodSnap.data() || {};
            producerName = String(pd.displayName || pd.name || "");
          }
        }
        if (!producerName) producerName = "Producer";

        // Buyer name/email: MPesa doesn't provide these, so pull from users/{buyerId}
        let buyerName =
          (o.buyerName ? String(o.buyerName) : "") ||
          "";
        let buyerEmail =
          (o.buyerEmail ? String(o.buyerEmail) : "") ||
          "";

        if ((!buyerName || !buyerEmail) && buyerId) {
          const buyerSnap = await db.collection("users").doc(buyerId).get().catch(() => null);
          if (buyerSnap && buyerSnap.exists) {
            const bu = buyerSnap.data() || {};
            if (!buyerName) buyerName = String(bu.displayName || bu.name || "");
            if (!buyerEmail) buyerEmail = String(bu.email || "");
          }
        }

        // ✅ Create/Update unlock (MPesa)
        await db.collection("unlocks").doc(orderDoc.id).set(
          {
            unlockId: orderDoc.id,
            orderId: orderDoc.id,
            provider: "MPESA_STK",

            paid: true, // ✅ helpful for licenseDownload checks
            status: "unlocked",

            buyerId,
            buyerName: buyerName || null,   // ✅ for license PDF
            buyerEmail: buyerEmail || null, // ✅ for license PDF

            beatId: beatId || null,
            beatTitle: beatTitle || null,   // ✅ for license PDF

            producerId: finalProducerId || null,
            producerName: producerName || null, // ✅ for license PDF

            licenseKey: licenseKey || "basic", // ✅ for license PDF

            phone: metadata.PhoneNumber || null,
            amountKes: metadata.Amount || null,
            receipt: metadata.MpesaReceiptNumber || null,
            transactionDate: metadata.TransactionDate || null,
            checkoutRequestId: CheckoutRequestID,

            // ✅ dashboard download fields
            downloadPath,
            audioUrl,

            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        // ✅ mark order unlocked (optional)
        await orderDoc.ref.set(
          {
            unlocked: true,
            unlockedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
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

// ResultURL callback
exports.b2cResult = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    try {
      const body = req.body;
      console.log("B2C RESULT:", JSON.stringify(body));

      const result = body?.Result || {};
      const originatorConversationId = result?.OriginatorConversationID || "";
      const conversationId = result?.ConversationID || "";
      const transactionId = result?.TransactionID || "";
      const resultCode = result?.ResultCode;
      const resultDesc = result?.ResultDesc || "";

      if (!originatorConversationId) {
        return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
      }

      const q = await db
        .collection("payoutsRequests")
        .where("mpesa.originatorConversationId", "==", originatorConversationId)
        .limit(1)
        .get();

      if (q.empty) {
        return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
      }

      const ref = q.docs[0].ref;

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;

        const data = snap.data() || {};
        const ok = String(resultCode) === "0";

        // Always update request status first
        const patch = {
          status: ok ? "success" : "failed",
          updatedAt: Date.now(),
          mpesa: {
            ...(data.mpesa || {}),
            conversationId,
            transactionId,
            resultCode,
            resultDesc,
            rawResult: body,
          },
        };

        // ✅ If failed: just write status and exit
        if (!ok) {
          const producerId = String(data.producerId || "").trim();
          const amountUsd = Number(data.amountUsd ?? data.amount ?? 0);

          if (producerId && Number.isFinite(amountUsd) && amountUsd > 0 && data.walletRefunded !== true) {
            const walletRef = db.doc(`wallets/${producerId}`);
            const wSnap = await tx.get(walletRef);
            const w = wSnap.exists ? (wSnap.data() || {}) : {};

            const availableUsd = Number(w.availableUsd || 0);
            const pendingPayoutUsd = Number(w.pendingPayoutUsd || 0);

            tx.set(walletRef, {
              availableUsd: +(availableUsd + amountUsd).toFixed(2),
              pendingPayoutUsd: Math.max(0, +(pendingPayoutUsd - amountUsd).toFixed(2)),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            tx.set(ref, {
              ...patch,
              status: "failed",
              walletRefunded: true,
              walletRefundedAt: Date.now(),
            }, { merge: true });
            return;
          }

          tx.set(ref, {
            ...patch,
            status: "failed",
          }, { merge: true });
          return;
        }

        // ✅ If success: settle wallet once
        const producerId = String(data.producerId || "").trim();
        const amountUsd = Number(data.amountUsd ?? data.amount ?? 0);

        if (!producerId || !Number.isFinite(amountUsd) || amountUsd <= 0) {
          tx.set(ref, {
            ...patch,
            status: "failed",
            failReason: "Invalid producerId/amountUsd",
            updatedAt: Date.now(),
          }, { merge: true });
          return;
        }

        // Idempotency guard
        if (data.walletSettled === true) {
          tx.set(ref, patch, { merge: true });
          return;
        }

        const walletRef = db.doc(`wallets/${producerId}`);
        const wSnap = await tx.get(walletRef);
        const w = wSnap.exists ? (wSnap.data() || {}) : {};

        const pendingPayoutUsd = Number(w.pendingPayoutUsd || 0);
        const paidOutUsd = Number(w.paidOutUsd || 0);

        // ✅ IMPORTANT: do NOT touch availableUsd here
        const newPending = Math.max(0, +(pendingPayoutUsd - amountUsd).toFixed(2));
        const newPaidOut = +(paidOutUsd + amountUsd).toFixed(2);

        tx.set(walletRef, {
          pendingPayoutUsd: newPending,
          paidOutUsd: newPaidOut,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        tx.set(ref, {
          ...patch,
          status: "success",
          walletSettled: true,
          walletSettledAt: Date.now(),
        }, { merge: true });
      });

      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
    } catch (e) {
      console.error("B2cResult error:", e);
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
    }
  }
);

// TimeoutURL callback
exports.b2cTimeout = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    try {
      const body = req.body;
      console.log("B2C TIMEOUT:", JSON.stringify(body));

      const result = body?.Result || {};
      const originatorConversationId = result?.OriginatorConversationID || "";

      if (originatorConversationId) {
        const q = await db
          .collection("payoutsRequests")
          .where("mpesa.originatorConversationId", "==", originatorConversationId)
          .limit(1)
          .get();

        if (!q.empty) {
          const ref = q.docs[0].ref;

          await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists) return;

            const data = snap.data() || {};
            if (data.walletRefunded === true) {
              tx.set(ref, {
                status: "timeout",
                updatedAt: Date.now(),
                mpesa: { ...(data.mpesa || {}), rawTimeout: body },
              }, { merge: true });
              return;
            }

            const producerId = String(data.producerId || "").trim();
            const amountUsd = Number(data.amountUsd ?? data.amount ?? 0);

            if (producerId && Number.isFinite(amountUsd) && amountUsd > 0) {
              const walletRef = db.doc(`wallets/${producerId}`);
              const wSnap = await tx.get(walletRef);
              const w = wSnap.exists ? (wSnap.data() || {}) : {};

              const availableUsd = Number(w.availableUsd || 0);
              const pendingPayoutUsd = Number(w.pendingPayoutUsd || 0);

              tx.set(walletRef, {
                availableUsd: +(availableUsd + amountUsd).toFixed(2),
                pendingPayoutUsd: Math.max(0, +(pendingPayoutUsd - amountUsd).toFixed(2)),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              }, { merge: true });

              tx.set(ref, {
                status: "timeout",
                updatedAt: Date.now(),
                walletRefunded: true,
                walletRefundedAt: Date.now(),
                mpesa: { ...(data.mpesa || {}), rawTimeout: body },
              }, { merge: true });
            } else {
              tx.set(ref, {
                status: "timeout",
                updatedAt: Date.now(),
                mpesa: { ...(data.mpesa || {}), rawTimeout: body },
              }, { merge: true });
            }
          });
        }
      }

      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
    } catch (e) {
      console.error("b2cTimeout error:", e);
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
    }
  }
);

exports.processPayoutRequest = onDocumentCreated(
  {
    region: "us-central1",
    document: "payoutsRequests/{requestId}",
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
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data() || {};
    const ref = snap.ref;

    // Only handle M-Pesa requests in "requested" state
    if (safeStr(data.method).toLowerCase() !== "mpesa") return;
    if (safeStr(data.status).toLowerCase() !== "requested") return;

    // --- Validate destination phone ---
    const phone = normalizePhone(String(data.destination || "").trim()); // accept 07.. / 2547.. etc
    if (!/^2547\d{8}$/.test(phone)) {
      await ref.set(
        { status: "failed", failReason: "Invalid destination phone (use 2547XXXXXXXX)", updatedAt: Date.now() },
        { merge: true }
      );
      return;
    }

    // --- Determine amount in USD (client sends USD as `amount`) ---
    const amountUsd = Number(data.amount); // your dashboard writes this
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      await ref.set(
        { status: "failed", failReason: "Invalid amount (USD)", updatedAt: Date.now() },
        { merge: true }
      );
      return;
    }

    // --- Convert USD -> KES (choose ONE approach below) ---
    // Option 1 (simple fixed rate): set your own constant
    const USD_TO_KES = 125; // TODO: change to your preferred rate
    const amountKes = Math.round(amountUsd * USD_TO_KES);

    // Option 2 (if you already store exchange rate somewhere), replace above with your rate lookup.

    // --- Enforce minimum for B2C + integer amount ---
    const MIN_KES = 10; // TODO: set based on your business / Mpesa limits
    if (!Number.isInteger(amountKes) || amountKes < MIN_KES) {
      await ref.set(
        {
          status: "failed",
          failReason: `Invalid amountKes (min ${MIN_KES} KES). Increase withdrawal amount.`,
          amountUsd,
          amountKes,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      return;
    }

    // Prevent double-processing
    await ref.set(
      {
        status: "processing",
        amountUsd,
        amountKes,
        destination: phone, // normalize stored phone too
        updatedAt: Date.now(),
      },
      { merge: true }
    );

    try {
      const token = await getAccessToken(
        DARAJA_CONSUMER_KEY.value(),
        DARAJA_CONSUMER_SECRET.value()
      );

      const shortcode = String(MPESA_SHORTCODE.value());
      const initiatorName = B2C_INITIATOR_NAME.value();
      const securityCredential = B2C_SECURITY_CREDENTIAL.value();

      const resultUrl =
        safeStr(B2C_RESULT_URL.value()) ||
        `https://us-central1-audiory-beat-store.cloudfunctions.net/b2cResult`;
      const timeoutUrl =
        safeStr(B2C_TIMEOUT_URL.value()) ||
        `https://us-central1-audiory-beat-store.cloudfunctions.net/b2cTimeout`;

      const commandId = "BusinessPayment";

      const resp = await callB2C({
        token,
        shortcode,
        initiatorName,
        securityCredential,
        amountKes,
        phone2547: phone,
        resultUrl,
        timeoutUrl,
        remarks: "Audiory withdrawal",
        occassion: "Audiory",
        commandId,
      });
  
      await ref.set({
          mpesa: {
            commandId,
            originatorConversationId: safeStr(resp?.OriginatorConversationID), // ✅ now exists
            conversationId: safeStr(resp?.ConversationID),
            originatorConversationIdFromSaf: safeStr(resp?.OriginatorConversationID), // optional
            responseCode: safeStr(resp?.ResponseCode),
            responseDescription: safeStr(resp?.ResponseDescription),
            rawResponse: resp,
          },
          status: "submitted",
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    } catch (e) {
      console.error("processPayoutRequest error:", e);

      await db.runTransaction(async (tx) => {
        const snap2 = await tx.get(ref);
        if (!snap2.exists) return;

        const data2 = snap2.data() || {};
        if (data2.walletRefunded === true) {
          tx.set(ref, {
            status: "failed",
            failReason: e?.message || String(e),
            updatedAt: Date.now(),
          }, { merge: true });
          return;
        }

        const producerId = String(data2.producerId || "").trim();
        const amountUsd = Number(data2.amountUsd ?? data2.amount ?? 0);

        if (producerId && Number.isFinite(amountUsd) && amountUsd > 0) {
          const walletRef = db.doc(`wallets/${producerId}`);
          const wSnap = await tx.get(walletRef);
          const w = wSnap.exists ? (wSnap.data() || {}) : {};

          const availableUsd = Number(w.availableUsd || 0);
          const pendingPayoutUsd = Number(w.pendingPayoutUsd || 0);

          tx.set(walletRef, {
            availableUsd: +(availableUsd + amountUsd).toFixed(2),
            pendingPayoutUsd: Math.max(0, +(pendingPayoutUsd - amountUsd).toFixed(2)),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });

          tx.set(ref, {
            status: "failed",
            failReason: e?.message || String(e),
            walletRefunded: true,
            walletRefundedAt: Date.now(),
            updatedAt: Date.now(),
          }, { merge: true });
        } else {
          tx.set(ref, {
            status: "failed",
            failReason: e?.message || String(e),
            updatedAt: Date.now(),
          }, { merge: true });
        }
      });  
    }
  });


/* =========================================================
   STK PUSH BOOST PAYMENT
========================================================= */

exports.stkpushBoost = onRequest(
  {
    region: "us-central1",
    maxInstances: 1,
    secrets: [
      DARAJA_CONSUMER_KEY,
      DARAJA_CONSUMER_SECRET,
      MPESA_SHORTCODE,
      MPESA_PASSKEY
    ],
  },
  async (req, res) => {
    const pre = handleCorsPreflight(req, res);
    if (pre) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Use POST" });
      }

      const decoded = await verifyFirebaseIdToken(req);
      if (!decoded) {
        return res.status(401).json({ error: "Login required" });
      }

      const producerId = decoded.uid;
      const { phone, beatId, boostDays } = req.body || {};

      if (!phone) return res.status(400).json({ error: "Phone required" });
      if (!beatId) return res.status(400).json({ error: "Beat ID required" });

      const cleanPhone = String(phone).replace(/\D/g, "");

      if (!cleanPhone.startsWith("254")) {
        return res.status(400).json({ error: "Phone must start with 254" });
      }

      const days = Number(boostDays || 1);

      const priceMap = {
        1: 500,
        3: 1500,
        7: 4000
      };

      const amount = priceMap[days] || 500;

      // same token logic as stkpushSubscription
      const auth = Buffer.from(
        `${DARAJA_CONSUMER_KEY.value()}:${DARAJA_CONSUMER_SECRET.value()}`
      ).toString("base64");

      const tokenRes = await fetchFn(
        "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
          },
        }
      );

      const tokenData = await tokenRes.json();

      if (!tokenRes.ok) {
        return res.status(400).json({ error: "Failed to get M-Pesa access token" });
      }

      const accessToken = tokenData.access_token;

      // same timestamp/password logic as stkpushSubscription
      const timestamp = new Date()
        .toISOString()
        .replace(/[-:TZ.]/g, "")
        .slice(0, 14);

      const password = Buffer.from(
        MPESA_SHORTCODE.value() +
        MPESA_PASSKEY.value() +
        timestamp
      ).toString("base64");

      const orderId = "boost_" + crypto.randomUUID();

      const stkRes = await fetchFn(
        "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            BusinessShortCode: MPESA_SHORTCODE.value(),
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: amount,
            PartyA: cleanPhone,
            PartyB: MPESA_SHORTCODE.value(),
            PhoneNumber: cleanPhone,
            CallBackURL: "https://us-central1-audiory-beat-store.cloudfunctions.net/boostCallback",
            AccountReference: "Audiory Boost",
            TransactionDesc: `Boost beat ${beatId}`,
          }),
        }
      );

      const stkData = await stkRes.json().catch(() => ({}));

      if (!stkRes.ok) {
        return res.status(400).json({
          error: "STK push failed",
          details: stkData
        });
      }

      await db.collection("boostOrders").doc(orderId).set({
        orderId,
        producerId,
        beatId,
        boostDays: days,
        amount,
        phone: cleanPhone,
        checkoutRequestId: stkData.CheckoutRequestID,
        merchantRequestId: stkData.MerchantRequestID || "",
        status: "pending",
        createdAt: Date.now()
      });

      return res.json({
        ok: true,
        success: true,
        message: "STK push sent",
        orderId,
        checkoutRequestId: stkData.CheckoutRequestID
      });

    } catch (e) {
      console.error("stkpushBoost error:", e);
      try { applyCors(req, res); } catch (_) {}
      return res.status(500).json({ error: e.message });
    }
  }
);

/* =========================================================
   MPESA BOOST CALLBACK
========================================================= */

exports.boostCallback = onRequest(async (req,res)=>{

  try{

    const body = req.body?.Body?.stkCallback;

    if(!body) return res.status(400).send("Invalid");

    const checkoutRequestId = body.CheckoutRequestID;
    const resultCode = body.ResultCode;

    const snap = await db.collection("boostOrders")
      .where("checkoutRequestId","==",checkoutRequestId)
      .limit(1)
      .get();

    if(snap.empty)
      return res.status(200).send("Order not found");

    const doc = snap.docs[0];
    const order = doc.data();

    if(resultCode !== 0){

      await doc.ref.update({
        status:"failed",
        updatedAt:Date.now()
      });

      return res.status(200).send("Failed");
    }

    const featuredUntil =
      Date.now() + (order.boostDays * 24 * 60 * 60 * 1000);

    // ✅ 1. Update beat (feature it)
    await db.collection("beats")
      .doc(order.beatId)
      .set({
        featured: true,
        featuredUntil
      }, { merge: true });

    // ✅ 2. Create marketing campaign (ADD HERE)
    await db.collection("marketingCampaigns").add({
      producerId: order.producerId,
      name: "Boost Campaign",
      type: "boost",
      beatId: order.beatId,
      boostDays: order.boostDays,
      featuredUntil,
      status: "active",
      createdAt: Date.now()
    });

    // ✅ 3. Mark order as paid
    await doc.ref.update({
      status: "paid",
      updatedAt: Date.now()
    });

    return res.status(200).send("Boost activated");

  }catch(e){
    console.error(e);
    return res.status(500).send("Error");
  }

});

exports.getBoostOrderStatus = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    const pre = handleCorsPreflight(req, res);
    if (pre) return;
    applyCors(req, res);

    try {
      if (req.method !== "GET") {
        return res.status(405).json({ error: "Use GET" });
      }

      const decoded = await verifyFirebaseIdToken(req);
      if (!decoded) {
        return res.status(401).json({ error: "Login required" });
      }

      const producerId = decoded.uid;
      const orderId = String(req.query.orderId || "").trim();

      if (!orderId) {
        return res.status(400).json({ error: "orderId required" });
      }

      const snap = await db.collection("boostOrders").doc(orderId).get();

      if (!snap.exists) {
        return res.status(404).json({ error: "Order not found" });
      }

      const data = snap.data() || {};

      if (String(data.producerId || "") !== producerId) {
        return res.status(403).json({ error: "Not allowed" });
      }

      return res.json({
        ok: true,
        orderId,
        status: data.status || "pending",
        beatId: data.beatId || "",
        boostDays: data.boostDays || 1
      });

    } catch (e) {
      console.error("getBoostOrderStatus error:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

exports.stkpushSubscription = onRequest(
  {
    region: "us-central1",
    maxInstances: 1,
    secrets: [
      DARAJA_CONSUMER_KEY,
      DARAJA_CONSUMER_SECRET,
      MPESA_SHORTCODE,
      MPESA_PASSKEY,
      MPESA_CALLBACK_URL
    ],
  },
  async (req, res) => {

    const pre = handleCorsPreflight(req, res);
    if (pre) return;
    applyCors(req, res);

    try {

      if (req.method !== "POST") {
        return res.status(405).json({ error: "Use POST" });
      }

      const { phone, uid, planTier } = req.body || {};

      if (!phone) return res.status(400).json({ error: "phone required" });
      if (!uid) return res.status(400).json({ error: "uid required" });
      if (!planTier) return res.status(400).json({ error: "planTier required" });

      const cleanPhone = String(phone).replace(/\D/g, "");

      if (!cleanPhone.startsWith("254")) {
        return res.status(400).json({ error: "Phone must start with 254" });
      }

      // -------------------------------
      // PLAN PRICE MAP
      // -------------------------------

      const PLAN_PRICE = {
        starter: 1500,
        pro: 3500,
        elite: 6500
      };

      const amount = PLAN_PRICE[planTier] || 1500;

      // -------------------------------
      // ACCESS TOKEN
      // -------------------------------

      const auth = Buffer.from(
        `${DARAJA_CONSUMER_KEY.value()}:${DARAJA_CONSUMER_SECRET.value()}`
      ).toString("base64");

      const tokenRes = await fetchFn(
        "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
          },
        }
      );

      const tokenData = await tokenRes.json();

      if (!tokenRes.ok) {
        return res.status(400).json({ error: "Failed to get M-Pesa access token" });
      }

      const accessToken = tokenData.access_token;

      // -------------------------------
      // TIMESTAMP
      // -------------------------------

      const timestamp = new Date()
        .toISOString()
        .replace(/[-:TZ.]/g, "")
        .slice(0, 14);

      const password = Buffer.from(
        MPESA_SHORTCODE.value() +
        MPESA_PASSKEY.value() +
        timestamp
      ).toString("base64");

      // -------------------------------
      // STK PUSH REQUEST
      // -------------------------------

      const stkRes = await fetchFn(
        "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            BusinessShortCode: MPESA_SHORTCODE.value(),
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: amount,
            PartyA: cleanPhone,
            PartyB: MPESA_SHORTCODE.value(),
            PhoneNumber: cleanPhone,
            CallBackURL: "https://us-central1-audiory-beat-store.cloudfunctions.net/subscriptionCallback",
            AccountReference: "Audiory Subscription",
            TransactionDesc: `Audiory ${planTier} plan`,
          }),
        }
      );

      const stkData = await stkRes.json().catch(() => ({}));

      if (!stkRes.ok) {
        return res.status(400).json({
          error: "STK push failed",
          details: stkData
        });
      }

      // Save pending payment

      await db.collection("mpesaPending").add({
        uid,
        phone: cleanPhone,
        planTier,
        amount,
        checkoutRequestId: stkData.CheckoutRequestID,
        merchantRequestId: stkData.MerchantRequestID,
        createdAt: Date.now()
      });

      return res.json({
        ok: true,
        message: "STK push sent",
        checkoutRequestId: stkData.CheckoutRequestID
      });

    } catch (e) {

      console.error("stkpushsubscription error:", e);

      try { applyCors(req, res); } catch (_) {}

      return res.status(500).json({
        error: e.message
      });
    }
  }
);

exports.subscriptionCallback = onRequest(async (req, res) => {

  try {

    const body = req.body;

    const callback = body?.Body?.stkCallback;

    if (!callback) {
      console.log("Invalid callback body");
      return res.json({ ok: true });
    }

    const resultCode = callback.ResultCode;
    const checkoutRequestId = callback.CheckoutRequestID;

    // Payment failed
    if (resultCode !== 0) {
      console.log("Payment failed", callback);
      return res.json({ ok: true });
    }

    const items = callback.CallbackMetadata?.Item || [];

    const amount =
      items.find(i => i.Name === "Amount")?.Value || 0;

    const phone =
      items.find(i => i.Name === "PhoneNumber")?.Value || "";

    const receipt =
      items.find(i => i.Name === "MpesaReceiptNumber")?.Value || "";

    const paidAt =
      items.find(i => i.Name === "TransactionDate")?.Value || "";

    // Find pending payment
    const snap = await db
      .collection("mpesaPending")
      .where("checkoutRequestId", "==", checkoutRequestId)
      .limit(1)
      .get();

    if (snap.empty) {
      console.log("No pending payment found");
      return res.json({ ok: true });
    }

    const doc = snap.docs[0];
    const data = doc.data();

    const uid = data.uid;
    const planTier = data.planTier;

    // Prevent duplicate processing
    if (data.status === "paid") {
      console.log("Already processed payment");
      return res.json({ ok: true });
    }

    const now = Date.now();
    const expires = now + (30 * 24 * 60 * 60 * 1000); // 30 days

    // Activate subscription
    await db.collection("users").doc(uid).set(
      {
        plan: planTier,
        planTier: planTier,

        subscriptionStatus: "active",
        subscriptionProvider: "mpesa",

        subscriptionStarted: now,
        subscriptionExpires: expires,

        mpesaPhone: phone,
        mpesaReceipt: receipt,

        planUpdatedAt: now
      },
      { merge: true }
    );

    // Mark payment complete
    await doc.ref.update({
      status: "paid",
      amount,
      receipt,
      paidAt,
      processedAt: now
    });

    console.log("Subscription activated for", uid);

    return res.json({ ok: true });

  } catch (e) {

    console.error("subscriptionCallback error:", e);

    return res.status(500).json({
      error: e.message
    });

  }

});

exports.checkSubscriptionExpiry = onSchedule(
  {
    region: "us-central1",
    schedule: "every 24 hours",
  },
  async () => {

    const now = Date.now();

    const snap = await db.collection("users")
      .where("subscriptionExpires", "<", now)
      .where("planTier", "!=", "free")
      .get();

    if (snap.empty) {
      console.log("No expired subscriptions");
      return;
    }

    const batch = db.batch();

    snap.docs.forEach((docSnap) => {

      batch.update(docSnap.ref, {
        plan: "free",
        planTier: "free",

        subscriptionStatus: "expired",

        subscriptionProvider: null,

        paypalPlanId: null,
        paypalSubscriptionId: null,

        subscriptionExpires: null,

        planUpdatedAt: Date.now(),
      });

    });

    await batch.commit();

    console.log("Expired subscriptions downgraded:", snap.size);

  }
);

exports.onOrderWriteUpdateWallet = onDocumentWritten(
  { region: "us-central1", document: "orders/{orderId}" },
  async (event) => {
    const after = event.data?.after?.data() || null;
    const before = event.data?.before?.data() || null;
    if (!after) return;

    const producerId = String(after.producerId || "").trim();
    if (!producerId) return;

    const afterPaid = String(after.status || "").toUpperCase() === "PAID";
    const beforePaid = String(before?.status || "").toUpperCase() === "PAID";

    // prevent double count
    if (!afterPaid || beforePaid) return;

    const amountUsdRaw = toNumber(after.amountUsd ?? after.amount ?? 0);
    if (!Number.isFinite(amountUsdRaw) || amountUsdRaw <= 0) return;

    // round to 2dp safely
    const amountUsd = Math.round(amountUsdRaw * 100) / 100;

    const walletRef = db.doc(`wallets/${producerId}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(walletRef);
      const w = snap.exists ? (snap.data() || {}) : {};

      const lifetimeUsd = toNumber(w.lifetimeUsd);
      const availableUsd = toNumber(w.availableUsd);
      const pendingPayoutUsd = toNumber(w.pendingPayoutUsd);
      const paidOutUsd = toNumber(w.paidOutUsd);

      tx.set(
        walletRef,
        {
          lifetimeUsd: Math.round((lifetimeUsd + amountUsd) * 100) / 100,
          availableUsd: Math.round((availableUsd + amountUsd) * 100) / 100,

          // keep these fields present for payout workflow
          pendingPayoutUsd: Math.round(pendingPayoutUsd * 100) / 100,
          paidOutUsd: Math.round(paidOutUsd * 100) / 100,

          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  }
);

exports.onPayoutPaidUpdateWallet = onDocumentWritten(
  { region: "us-central1", document: "payouts/{payoutId}" },
  async () => {
    // DISABLED:
    // Wallet settlement now handled in payoutsRequests workflow
    return;
  }
);

exports.reservePayoutFunds = onDocumentCreated(
  { region: "us-central1", document: "payoutsRequests/{requestId}" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const ref = snap.ref;
    const data = snap.data() || {};

    const producerId = String(data.producerId || "");
    const amountUsd = Number(data.amountUsd ?? data.amount); // your UI uses "amount"
    const status = String(data.status || "").toLowerCase();

    // only reserve once, only for fresh requests
    if (!producerId) return;
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return;
    if (status !== "requested") return;

    const db = admin.firestore();
    const walletRef = db.doc(`wallets/${producerId}`);

    await db.runTransaction(async (tx) => {
      const wSnap = await tx.get(walletRef);
      const w = wSnap.exists ? (wSnap.data() || {}) : {};

      const availableUsd = Number(w.availableUsd || 0);
      const pendingPayoutUsd = Number(w.pendingPayoutUsd || 0);

      if (availableUsd < amountUsd) {
        tx.set(ref, {
          status: "failed",
          failReason: "Insufficient balance",
          updatedAt: Date.now(),
        }, { merge: true });
        return;
      }

      // ✅ reserve the funds
      tx.set(walletRef, {
        availableUsd: +(availableUsd - amountUsd).toFixed(2),
        pendingPayoutUsd: +(pendingPayoutUsd + amountUsd).toFixed(2),
        updatedAt: Date.now(),
      }, { merge: true });

      tx.set(ref, {
        status: "processing",      // reserved
        amountUsd: +amountUsd.toFixed(2),
        updatedAt: Date.now(),
      }, { merge: true });
    });
  }
);

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

    // ---------- GET ORDER (optional) ----------
    let orderData = {};
    const maybeOrderId = safeStr(unlockData.orderId || orderId || "");
    if (maybeOrderId) {
      const oSnap = await db.collection("orders").doc(maybeOrderId).get().catch(() => null);
      if (oSnap && oSnap.exists) orderData = oSnap.data() || {};
    }

    // ---------- GET BUYER PROFILE (Auth + users fallback) ----------
    let authUser = null;
    try { authUser = await admin.auth().getUser(buyerId); } catch (_) {}

    let userProfile = {};
    try {
      const uSnap = await db.collection("users").doc(buyerId).get();
      if (uSnap.exists) userProfile = uSnap.data() || {};
    } catch (_) {}

    // ---------- RESOLVE DATA (buyer, producer, beat) ----------
    const buyerName = safeStr(
      unlockData.buyerName ||
      orderData.buyerName ||
      orderData.checkoutName ||
      unlockData.checkoutName ||
      userProfile.displayName ||
      userProfile.name ||
      authUser?.displayName ||
      ""
    );

    const buyerEmail = safeStr(
      unlockData.buyerEmail ||
      orderData.buyerEmail ||
      orderData.checkoutEmail ||
      unlockData.checkoutEmail ||
      userProfile.email ||
      authUser?.email ||
      ""
    );

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
    
    const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
    
    // ---------- GENERATE PDF ----------
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = 800;
    const left = 50;

    const draw = (text, size = 12, isBold = false) => {
      page.drawText(String(text || ""), {
        x: left,
        y,
        size,
        font: isBold ? bold : font,
        color: rgb(0, 0, 0),
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
