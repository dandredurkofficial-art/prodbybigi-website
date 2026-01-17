// /js/firebase.js  (FINAL FIX)
// - keeps your "no index required" query approach
// - exposes window.FB for your existing inline scripts
// - fires "firebase-ready"
// - hides #homeStatus / #marketStatus when beats load successfully

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
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

// ✅ expose helpers for pages that use window.FB
window.FB = { db, collection, getDocs, query, orderBy, limit };

// ✅ tell your pages Firebase is ready
window.dispatchEvent(new Event("firebase-ready"));

/**
 * ✅ Beat normalizer (supports your mixed field names)
 */
function normalizeBeat(docId, data) {
  const artwork =
    data.artwork ||
    data.coverurl ||
    data.coverUrl ||
    data.coverURL ||
    "";

  const previewAudio =
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

  const producerId = data.producerId || data.producerid || data.producerID || "";
  const producerName = data.producerName || data.producer || data.producerDisplayName || "";

  return {
    id: docId,
    title: data.title || data.Title || "Untitled Beat",
    artwork,
    previewAudio,
    producerId,
    producerName,
    price: Number(price) || 0,
    published: data.published === true,
    createdAt: data.createdAt || data.createdat || 0
  };
}

/**
 * ✅ Query that DOES NOT require composite indexes:
 * orderBy(createdAt desc) then filter published client-side.
 */
export async function fetchBeats({ max = 60 } = {}) {
  const beatsRef = collection(db, "beats");
  const q = query(beatsRef, orderBy("createdAt", "desc"), limit(max));

  const snap = await getDocs(q);
  const beats = [];

  snap.forEach((d) => {
    const beat = normalizeBeat(d.id, d.data());
    if (beat.published) beats.push(beat);
  });

  return beats;
}

/**
 * ✅ Optional renderer (marketplace layout uses #beatsGrid or .beats-grid)
 */
export function renderBeats(beats) {
  const grid =
    document.querySelector("#beatsGrid") ||
    document.querySelector("#trendingGrid") ||
    document.querySelector("#marketGrid") ||
    document.querySelector("[data-beats-grid]") ||
    document.querySelector(".beats-grid");

  if (!grid) return;

  grid.innerHTML = "";

  if (!beats.length) {
    grid.innerHTML = `<div class="empty-state">No beats yet.</div>`;
    return;
  }

  const safeText = (s) =>
    String(s || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[m]));

  const producerLabel = (b) => {
    if (b.producerName) return b.producerName;
    if (!b.producerId) return "Prod. Unknown";
    return "Prod. " + b.producerId.slice(0, 8);
  };

  const priceLabel = (b) => "$" + (Number(b.price || 0)).toFixed(2);

  grid.innerHTML = beats.map((b) => `
    <div class="beat-card">
      <div class="beat-cover">
        ${b.artwork
          ? `<img class="beat-art" src="${b.artwork}" alt="${safeText(b.title)}" loading="lazy" />`
          : `<div class="beat-art" style="display:grid;place-items:center;font-weight:900;">${safeText(b.title).slice(0,2).toUpperCase()}</div>`
        }
        <button class="play-btn"
          data-audio="${b.previewAudio}"
          aria-label="Play preview"
          type="button">▶</button>
      </div>

      <div class="beat-meta">
        <div class="beat-left">
          <h3 class="beat-title">${safeText(b.title)}</h3>
          <div class="beat-producer">${safeText(producerLabel(b))}</div>
        </div>
        <button class="price-btn" type="button">${priceLabel(b)}</button>
      </div>
    </div>
  `).join("");
}

/**
 * ✅ Boot:
 * - loads beats (so marketplace still works)
 * - hides status boxes if beats load successfully
 */
async function boot() {
  try {
    const beats = await fetchBeats({ max: 60 });

    // ✅ hide these if they exist (fixes “could not load” text staying)
    const homeStatus = document.getElementById("homeStatus");
    const marketStatus = document.getElementById("marketStatus");
    if (homeStatus) homeStatus.classList.add("hidden");
    if (marketStatus) marketStatus.classList.add("hidden");

    // ✅ keep marketplace auto-render working
    renderBeats(beats);

    // handy for debugging
    window.__LATEST_BEATS__ = beats;
  } catch (err) {
    console.error("Beats load failed:", err);

    // show error ONLY if beats truly failed
    const homeStatus = document.getElementById("homeStatus");
    const marketStatus = document.getElementById("marketStatus");
    if (homeStatus) homeStatus.textContent = "Could not load beats. Check Firestore rules & console.";
    if (marketStatus) marketStatus.textContent = "Could not load beats. Check Firestore rules & console.";
  }
}

document.addEventListener("DOMContentLoaded", boot);
