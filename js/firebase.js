// /js/firebase.js (single source of truth + FAST AUTH TOKEN)
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  getDocs,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

// Normalize beats so homepage + marketplace get SAME license data
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

  let price = data.price;
  if (price == null && data.licenses?.basic?.price != null) price = data.licenses.basic.price;
  if (price == null) price = 29.99;

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

  return {
    id: docId,

    // ✅ your requested fields (beatTitle/beatArtwork support)
    title: data.title || data.beatTitle || data.Title || "Untitled Beat",
    artwork,
    audio,

    // ✅ IMPORTANT: include licenses always
    licenses: data.licenses || data.Licenses || null,

    // ✅ for search filtering later
    genre: data.genre || data.Genre || "",

    producerId,
    producerName,
    price: Number(price) || 0,
    published: data.published === true,
    createdAt: data.createdAt || data.createdat || 0,
    desc: data.desc || data.description || ""
  };
}

async function fetchBeats({ max = 60 } = {}) {
  const beatsRef = collection(db, "beats");
  const qy = query(beatsRef, orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(qy);

  const beats = [];
  snap.forEach((d) => {
    const beat = normalizeBeat(d.id, d.data());
    if (beat.published) beats.push(beat);
  });

  return beats;
}

window.FB.fetchBeats = fetchBeats;

// ✅ Tell pages firebase is ready
window.dispatchEvent(new Event("firebase-ready"));
