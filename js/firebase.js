// /js/firebase.js (FAST LOAD + CACHE + SINGLE SOURCE OF TRUTH) — AUDIORY VERSION
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  addDoc,
  doc,
  query,
  where,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ✅ AUDIORY FIREBASE CONFIG (NEW) */
const firebaseConfig = {
  apiKey: "AIzaSyCmsFTjDryYOTddWfScTKsnrs0cWAHnpdc",
  authDomain: "audiory-beat-store.firebaseapp.com",
  projectId: "audiory-beat-store",
  storageBucket: "audiory-beat-store.firebasestorage.app",
  messagingSenderId: "688272560511",
  appId: "1:688272560511:web:9031e6ce215d6f08764a4a",
  measurementId: "G-GLYGWQGS26"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Expose helpers
window.FB = window.FB || {};
window.FB.app = app;
window.FB.auth = auth;
window.FB.db = db;

window.FB.collection = collection;
window.FB.getDocs = getDocs;
window.FB.getDoc = getDoc;
window.FB.addDoc = addDoc;
window.FB.doc = doc;
window.FB.query = query;
window.FB.where = where;
window.FB.orderBy = orderBy;
window.FB.limit = limit;

// ✅ FAST token getter (no dynamic import)
window.FB.getIdToken = async () => {
  const user = auth.currentUser;
  if (!user) return null;
  return await user.getIdToken();
};

// Optional: keep current user reference
window.FB.user = null;
onAuthStateChanged(auth, (u) => {
  window.FB.user = u || null;
});

// --------------------
// ✅ FAST CACHE LAYER
// --------------------
const CACHE_KEY = "audiory_cached_beats_v2";
const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes
let memCache = null;
let memCacheAt = 0;
let inflight = null;

function now() {
  return Date.now();
}

function readLocalCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.beats) || !parsed.ts) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalCache(beats) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: now(), beats }));
  } catch {}
}

/* =========================
   ✅ BEAT NORMALIZER (AUDIORY)
   Works with your Producer Studio payload:
   artwork, fullAudio, previewAudio, licenses, freeDownload, stemsZipUrl, etc.
========================= */
function pickMainPrice(data) {
  // Try to choose a “display price”:
  // 1) if freeDownload -> 0
  // 2) if basic enabled -> basic price
  // 3) else premium -> premium price
  // 4) else exclusive -> exclusive price
  // 5) else data.price
  const free = data.freeDownload === true || Number(data.price || 0) === 0;
  if (free) return 0;

  const lic = data.licenses || {};
  if (lic.basic?.enabled) return Number(lic.basic.price || 0) || 0;
  if (lic.premium?.enabled) return Number(lic.premium.price || 0) || 0;
  if (lic.exclusive?.enabled) return Number(lic.exclusive.price || 0) || 0;

  return Number(data.price || 0) || 0;
}

function normalizeBeat(docId, data) {
  const artwork =
    data.artwork ||
    data.beatArtwork ||
    data.coverurl ||
    data.coverUrl ||
    data.coverURL ||
    "";

  const audio =
    data.previewAudio ||
    data.previewAudioUrl ||
    data.audiourl ||
    data.audioUrl ||
    data.audioURL ||
    data.fullAudio ||
    "";

  const producerId =
    data.producerId ||
    data.producerid ||
    data.producerID ||
    "";

  const producerName =
    data.producerName ||
    data.producer ||
    data.producerDisplayName ||
    "";

  const genre = (data.genre || data.Genre || "").toString().trim();

  const createdAt =
    data.createdAt || data.createdat || data.timestamp || 0;

  // ✅ PRICE / LICENSE FIELDS (IMPORTANT)
  // supports multiple possible field names from your dashboard
  const priceRaw =
    data.price ??
    data.basicPrice ??
    data.licensePrice ??
    data.amount ??
    null;

  const price = priceRaw === null ? null : Number(priceRaw);

  // If your beat uses "isFree" or "free" toggle
  const isFree = (data.isFree === true) || (data.free === true) || (Number(priceRaw) === 0);

  // Optional ranking fields (for later “Top charting” sorting)
  const likes = Number(data.likes ?? data.likeCount ?? 0);
  const sales = Number(data.sales ?? data.sold ?? data.salesCount ?? 0);

  // Optional: your per-license prices if you store them
  const licenses = data.licenses || null;

  return {
    id: docId,
    title: data.title || data.beatTitle || data.Title || "Untitled Beat",
    artwork,
    audio,
    genre,
    producerId,
    producerName,
    published: data.published === true,
    createdAt,
    desc: data.desc || data.description || "",

    // ✅ added
    price: (Number.isFinite(price) ? price : null),
    isFree,
    likes,
    sales,
    licenses
  };
}

// --------------------
// ✅ FAST FETCH (dedupe + fallback)
// --------------------
async function fetchBeats({ max = 60, force = false } = {}) {
  // 1) in-memory cache
  if (!force && memCache && (now() - memCacheAt) < CACHE_TTL_MS) {
    return memCache;
  }

  // 2) local cache (instant paint)
  const local = readLocalCache();
  const localFresh = local && (now() - local.ts) < CACHE_TTL_MS;

  // 3) avoid duplicate network calls
  if (!force && inflight) {
    if (localFresh) return local.beats;
    return await inflight;
  }

  // 4) start network request
  inflight = (async () => {
    try {
      const beatsRef = collection(db, "beats");

      // ✅ Most dashboards write createdAt. If some docs miss it, Firestore orderBy can fail.
      // So we do: orderBy("createdAt","desc") and rely on your createdAt existing.
      const qy = query(beatsRef, orderBy("createdAt", "desc"), limit(max));
      const snap = await getDocs(qy);

      const beats = [];
      snap.forEach((d) => {
        const beat = normalizeBeat(d.id, d.data());
        if (beat.published) beats.push(beat);
      });

      // update caches
      memCache = beats;
      memCacheAt = now();
      writeLocalCache(beats);

      return beats;
    } catch (err) {
      console.error("[FB.fetchBeats] network error:", err);

      // fallback to local cache if exists
      if (local?.beats?.length) {
        memCache = local.beats;
        memCacheAt = now();
        return local.beats;
      }
      throw err;
    } finally {
      inflight = null;
    }
  })();

  // If local cache is fresh, return it instantly while inflight updates in background
  if (!force && localFresh) return local.beats;

  // Otherwise wait for network
  return await inflight;
}

window.FB.fetchBeats = fetchBeats;

/* =========================
   ✅ FREE DOWNLOAD LOG
   Used by the FREE popup we added in index.html
   Saves a lead into Firestore collection: freeDownloads
========================= */
window.FB.logFreeDownload = async function ({
  beatId,
  beatTitle,
  producerId,
  producerName,
  fullName,
  email,
  createdAt
} = {}) {
  if (!beatId) throw new Error("Missing beatId");
  if (!email) throw new Error("Missing email");

  const payload = {
    beatId,
    beatTitle: beatTitle || "",
    producerId: producerId || "",
    producerName: producerName || "",
    fullName: (fullName || "").trim(),
    email: (email || "").trim().toLowerCase(),
    createdAt: Number(createdAt || Date.now())
  };

  await addDoc(collection(db, "freeDownloads"), payload);
  return true;
};

// ✅ Tell pages firebase is ready
window.dispatchEvent(new Event("firebase-ready"));
