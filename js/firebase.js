// /js/firebase.js (FAST LOAD + CACHE + SINGLE SOURCE OF TRUTH)
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi",
  storageBucket: "prodbybigi.firebasestorage.app",
  messagingSenderId: "1040553526206",
  appId: "1:1040553526206:web:38216a9f75eabfe556efef"
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
window.FB.query = query;
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
const CACHE_KEY = "pb_cached_beats_v1";
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

  const genre =
    (data.genre || data.Genre || "").toString().trim();

  const createdAt =
    data.createdAt || data.createdat || data.timestamp || 0;

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
    desc: data.desc || data.description || ""
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
    // return cached immediately if we have it, while inflight continues
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

// ✅ Tell pages firebase is ready
window.dispatchEvent(new Event("firebase-ready"));
