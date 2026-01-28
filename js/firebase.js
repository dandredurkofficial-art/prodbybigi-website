// /js/firebase.js (FAST LOAD + CACHE + SINGLE SOURCE OF TRUTH) — AUDIORY VERSION (FIXED)
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
const CACHE_KEY = "audiory_cached_beats_v3"; // ✅ bump to avoid old cached "free" beats
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

// Optional helper (debug)
window.FB.clearBeatsCache = function () {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
  memCache = null;
  memCacheAt = 0;
};

/* =========================
   ✅ PRICE PICKER (AUDIORY)
   Priority:
   - freeDownload / isFree / free true  -> 0
   - licenses.basic.enabled -> basic.price
   - licenses.premium.enabled -> premium.price
   - licenses.exclusive.enabled -> exclusive.price
   - fallback: data.price (if number)
========================= */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isTruthyFree(data) {
  return (
    data?.freeDownload === true ||
    data?.isFree === true ||
    data?.free === true
  );
}

function pickDisplayPrice(data) {
  if (isTruthyFree(data)) return 0;

  const lic = data?.licenses || {};
  if (lic?.basic?.enabled === true) {
    const p = toNum(lic.basic.price);
    return p !== null ? p : 0;
  }
  if (lic?.premium?.enabled === true) {
    const p = toNum(lic.premium.price);
    return p !== null ? p : 0;
  }
  if (lic?.exclusive?.enabled === true) {
    const p = toNum(lic.exclusive.price);
    return p !== null ? p : 0;
  }

  const fallback = toNum(data?.price);
  return fallback !== null ? fallback : 0; // if nothing exists, treat as free until producer sets licenses/price
}

/* =========================
   ✅ BEAT NORMALIZER (FIXED)
   - NO MORE Number(null) bug
   - Computes price from licenses correctly
========================= */
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

  // ranking fields (optional)
  const likes = Number(data.likes ?? data.likeCount ?? 0) || 0;
  const sales = Number(data.sales ?? data.sold ?? data.salesCount ?? 0) || 0;

  const licenses = data.licenses || null;

  // ✅ display price computed from licenses/free toggles
  const displayPrice = pickDisplayPrice(data);

  // ✅ IMPORTANT FIX:
  // isFree must NOT be based on Number(null) or missing field
  const isFree = displayPrice === 0;

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

    // ✅ what your UI should use
    price: displayPrice,
    isFree,

    // optional extras
    likes,
    sales,
    licenses,

    // if you store these later
    freeDownload: data.freeDownload === true,
    downloadUrl: data.downloadUrl || data.freeDownloadUrl || ""
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
      const qy = query(beatsRef, orderBy("createdAt", "desc"), limit(max));
      const snap = await getDocs(qy);

      const beats = [];
      snap.forEach((d) => {
        const beat = normalizeBeat(d.id, d.data());
        if (beat.published) beats.push(beat);
      });

      memCache = beats;
      memCacheAt = now();
      writeLocalCache(beats);

      return beats;
    } catch (err) {
      console.error("[FB.fetchBeats] network error:", err);

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

  if (!force && localFresh) return local.beats;
  return await inflight;
}

window.FB.fetchBeats = fetchBeats;

/* =========================
   ✅ PRODUCER PROFILE FETCH
   Reads users/{producerId} so profile picture updates everywhere
========================= */
window.FB.getProducerProfile = async function (producerId) {
  const pid = String(producerId || "").trim();
  if (!pid) return null;

  try {
    const ref = doc(db, "users", pid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;

    const data = snap.data() || {};
    return {
      id: snap.id,
      displayName: data.displayName || "",
      firstName: data.firstName || "",
      lastName: data.lastName || "",
      photoURL: data.photoURL || data.photoUrl || data.photo || ""
    };
  } catch (err) {
    console.error("[FB.getProducerProfile] error:", err);
    return null;
  }
};

/* =========================
   ✅ FREE DOWNLOAD LOG
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
