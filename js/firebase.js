// /js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/** ✅ Your Firebase config */
const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi",
  storageBucket: "prodbybigi.firebasestorage.app",
  messagingSenderId: "1040553526206",
  appId: "1:1040553526206:web:38216a9f75eabfe556efef"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/**
 * ✅ Expose Firestore helpers for your INLINE scripts in index.html + marketplace.html
 * They do: const { db, collection, getDocs, query, where, orderBy, limit } = window.FB;
 */
window.FB = {
  db,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit
};

/**
 * ✅ Fire an event so pages can start loading beats after Firebase is ready.
 * Your index.html uses:
 *   window.addEventListener("firebase-ready", loadHomeBeats);
 * Your marketplace.html uses:
 *   window.addEventListener("firebase-ready", loadMarketplace);
 */
window.dispatchEvent(new Event("firebase-ready"));

/* ---------------------------
   OPTIONAL: helper you can reuse anywhere
   (not required for your current pages, but safe to keep)
---------------------------- */

/** Normalize beat doc (supports your fields) */
function normalizeBeat(data) {
  const title = data.title || data.Title || "Untitled";
  const cover =
    data.artwork ||
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

  let price =
    (data.licenses?.basic?.price != null ? data.licenses.basic.price : null);

  if (price == null) price = (data.price != null ? data.price : 0);

  return {
    title,
    cover,
    audio,
    producerId,
    producerName,
    price: Number(price || 0) || 0,
    createdAt: data.createdAt || 0,
    published: data.published === true
  };
}

/**
 * ✅ Gets published beats WITHOUT needing composite indexes.
 * - orderBy(createdAt) + limit
 * - filter published in JS
 */
export async function fetchPublishedBeats(max = 60) {
  const beatsRef = collection(db, "beats");
  const q = query(beatsRef, orderBy("createdAt", "desc"), limit(max));

  const snap = await getDocs(q);
  const out = [];

  snap.forEach((d) => {
    const b = normalizeBeat(d.data());
    if (b.published) out.push(b);
  });

  return out;
}
