// /js/firebase.js (FAST LOAD + CACHE + SINGLE SOURCE OF TRUTH) — AUDIORY VERSION (PROFILE PHOTO FIX)
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

// ✅ NEW: Storage (for profile pictures)
import {
  getStorage,
  ref,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

/* ✅ AUDIORY FIREBASE CONFIG */
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
const storage = getStorage(app);

// Expose helpers
window.FB = window.FB || {};
window.FB.app = app;
window.FB.auth = auth;
window.FB.db = db;
window.FB.storage = storage;

window.FB.collection = collection;
window.FB.getDocs = getDocs;
window.FB.getDoc = getDoc;
window.FB.addDoc = addDoc;
window.FB.doc = doc;
window.FB.query = query;
window.FB.where = where;
window.FB.orderBy = orderBy;
window.FB.limit = limit;

// ✅ FAST token getter
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

/* =========================
   ✅ PROFILE PHOTO RESOLVER
   Fixes: Android shows but iPhone/PC doesn't (blob: URL saved)
========================= */
const __photoResolveCache = new Map();

function looksLikeHttpUrl(u){
  return /^https?:\/\//i.test(String(u || ""));
}

function looksLikeGsUrl(u){
  return /^gs:\/\//i.test(String(u || ""));
}

// If you stored a storage path like "profilePics/UID.jpg"
function looksLikeStoragePath(u){
  const s = String(u || "");
  if (!s) return false;
  if (looksLikeHttpUrl(s) || looksLikeGsUrl(s)) return false;
  // basic heuristic: has a folder + file-ish
  return s.includes("/") && !s.startsWith("blob:");
}

window.FB.resolvePhotoURL = async function resolvePhotoURL(url, producerId = "") {
  const raw = String(url || "").trim();
  if (!raw) return "";

  // ❌ blob urls work only on the same device/session
  if (raw.startsWith("blob:")) return "";

  // ✅ normal https link
  if (looksLikeHttpUrl(raw)) return raw;

  const cacheKey = `photo:${producerId}:${raw}`;
  if (__photoResolveCache.has(cacheKey)) return __photoResolveCache.get(cacheKey);

  try {
    // ✅ gs://... link -> download URL
    if (looksLikeGsUrl(raw)) {
      const dl = await getDownloadURL(ref(storage, raw));
      __photoResolveCache.set(cacheKey, dl);
      return dl;
    }

    // ✅ storage path like "profilePics/<uid>.jpg" OR "users/<uid>/avatar.jpg"
    if (looksLikeStoragePath(raw)) {
      const dl = await getDownloadURL(ref(storage, raw));
      __photoResolveCache.set(cacheKey, dl);
      return dl;
    }

    return "";
  } catch (e) {
    // If the file doesn't exist or rules block it, fallback to initials
    return "";
  }
};

window.FB.getProducerProfile = async function getProducerProfile(producerId){
  if (!producerId) throw new Error("Missing producerId");
  const snap = await getDoc(doc(db, "users", String(producerId)));
  if (!snap.exists()) return null;

  const prof = snap.data() || {};
  const raw =
    prof.photoURL ||
    prof.photoUrl ||
    prof.photo ||
    "";

  const resolved = await window.FB.resolvePhotoURL(raw, producerId);

  return {
    id: producerId,
    ...prof,
    // Always prefer resolved HTTPS url
    photoURL: resolved || ""
  };
};

// --------------------
// ✅ FAST CACHE LAYER (BEATS)
// --------------------
const CACHE_KEY = "audiory_cached_beats_v3";
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

window.FB.clearBeatsCache = function () {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
  memCache = null;
  memCacheAt = 0;
};

/* =========================
   ✅ PRICE PICKER (AUDIORY)
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
  return fallback !== null ? fallback : 0;
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

  const likes = Number(data.likes ?? data.likeCount ?? 0) || 0;
  const sales = Number(data.sales ?? data.sold ?? data.salesCount ?? 0) || 0;

  const licenses = data.licenses || null;

  const displayPrice = pickDisplayPrice(data);
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

    price: displayPrice,
    isFree,

    likes,
    sales,
    licenses,

    freeDownload: data.freeDownload === true,
    downloadUrl: data.downloadUrl || data.freeDownloadUrl || ""
  };
}

// --------------------
// ✅ FAST FETCH (dedupe + fallback)
// --------------------
async function fetchBeats({ max = 60, force = false } = {}) {
  if (!force && memCache && (now() - memCacheAt) < CACHE_TTL_MS) {
    return memCache;
  }

  const local = readLocalCache();
  const localFresh = local && (now() - local.ts) < CACHE_TTL_MS;

  if (!force && inflight) {
    if (localFresh) return local.beats;
    return await inflight;
  }

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
   ✅ FREE DOWNLOAD LOG
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
