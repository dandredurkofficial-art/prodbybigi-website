// /js/firebase.js (faster fetch + in-memory cache)

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

window.FB = window.FB || {};
window.FB.app = app;
window.FB.auth = auth;
window.FB.db = db;

window.FB.getIdToken = async () => {
  const user = auth.currentUser;
  if (!user) return null;
  return await user.getIdToken();
};

window.FB.user = null;
onAuthStateChanged(auth, (u) => {
  window.FB.user = u || null;
});

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

  const producerId = data.producerId || data.producerid || data.producerID || "";
  const producerName = data.producerName || data.producer || data.producerDisplayName || "";

  const genre = String(data.genre || data.Genre || "").trim();

  // pick a base price just for displaying pill (modal uses fixed tiers)
  let price = data.price;
  if (price == null && data.licenses?.basic?.price != null) price = data.licenses.basic.price;
  if (price == null) price = 29.99;

  return {
    id: docId,
    title: data.title || data.beatTitle || data.Title || "Untitled Beat",
    artwork,
    audio,
    genre,
    producerId,
    producerName,
    price: Number(price) || 29.99,
    published: data.published === true,
    createdAt: data.createdAt || data.createdat || 0,
    desc: data.desc || data.description || ""
  };
}

// ✅ in-memory cache to avoid refetch when navigating back
let _cache = { ts: 0, beats: [] };
const CACHE_MS = 60 * 1000; // 60s

async function fetchBeats({ max = 30, force = false } = {}) {
  const now = Date.now();
  if (!force && _cache.beats.length && (now - _cache.ts) < CACHE_MS) {
    return _cache.beats.slice(0, max);
  }

  const beatsRef = collection(db, "beats");
  const qy = query(beatsRef, orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(qy);

  const beats = [];
  snap.forEach((d) => {
    const beat = normalizeBeat(d.id, d.data());
    if (beat.published) beats.push(beat);
  });

  _cache = { ts: now, beats };
  return beats;
}

window.FB.fetchBeats = fetchBeats;

window.dispatchEvent(new Event("firebase-ready"));
