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

/* =========================
   ✅ Expose for your pages
========================= */
window.FB = {
  app,
  db,
  // Firestore helpers
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  // Convenience
  fetchBeats,
  renderBeats
};

/* =========================
   ✅ Ready signal for home/market scripts
   - some scripts attach listeners AFTER this module loads,
     so we set a flag AND dispatch an event (twice-safe).
========================= */
function signalFirebaseReady() {
  window.FB_READY = true;
  window.dispatchEvent(new Event("firebase-ready"));
}
// fire asap
queueMicrotask(signalFirebaseReady);
// fire again after DOM ready (safe for late listeners)
document.addEventListener("DOMContentLoaded", signalFirebaseReady);

/**
 * ✅ Beat document normalizer (supports BOTH your old & new field names)
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

  // Price priority:
  // 1) direct "price"
  // 2) licenses.basic.price
  // 3) fallback 29.99
  let price = data.price;
  if (price == null && data.licenses?.basic?.price != null) price = data.licenses.basic.price;
  if (price == null) price = 29.99;

  const producerId = data.producerId || data.producerID || data.producerid || "";
  const producerName = data.producerName || data.producer || data.producerDisplayName || "";

  // createdAt can be number, Firestore timestamp, string, missing
  let createdAt = 0;
  if (typeof data.createdAt === "number") createdAt = data.createdAt;
  else if (typeof data.createdAt === "string") createdAt = Number(data.createdAt) || 0;
  else if (data.createdAt && typeof data.createdAt.toMillis === "function") createdAt = data.createdAt.toMillis();

  return {
    id: docId,
    title: data.title || data.Title || "Untitled Beat",
    artwork,
    previewAudio,
    producerId,
    producerName,
    price: Number(price) || 0,
    published: data.published === true,
    createdAt
  };
}

/**
 * ✅ Fetch beats with fallback (prevents “Could not load beats…”)
 * Primary:
 *   orderBy(createdAt desc) + limit
 * Fallback:
 *   limit only (no orderBy)
 */
export async function fetchBeats({ max = 60 } = {}) {
  const beatsRef = collection(db, "beats");

  let snap;

  // Try ordered query first
  try {
    const q1 = query(beatsRef, orderBy("createdAt", "desc"), limit(max));
    snap = await getDocs(q1);
  } catch (e) {
    console.warn("[firebase.js] orderBy(createdAt) failed, using fallback query:", e?.message || e);
    const q2 = query(beatsRef, limit(max));
    snap = await getDocs(q2);
  }

  const beats = [];
  snap.forEach((d) => {
    const beat = normalizeBeat(d.id, d.data());
    if (beat.published) beats.push(beat);
  });

  // If fallback query returned unordered docs, sort client-side
  beats.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return beats;
}

/**
 * ✅ Render beats into these common containers:
 * - #beatsGrid / .beats-grid / [data-beats-grid]
 * - #trendingGrid / #marketGrid
 *
 * NOTE: Your HOME page uses #trendingStrip + #chartGrid
 * so home uses its own script (loadHomeBeats) — this is fine.
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
    if (!b.producerId) return "Unknown producer";
    return "Prod. " + String(b.producerId).slice(0, 8);
  };

  const priceLabel = (b) => {
    const p = Number(b.price || 0);
    return "$" + (isFinite(p) ? p.toFixed(2) : "0.00");
  };

  grid.innerHTML = beats.map((b) => `
    <div class="beat-card">
      <div class="beat-cover">
        ${b.artwork
          ? `<img class="beat-art" src="${b.artwork}" alt="${safeText(b.title)}" loading="lazy" />`
          : `<div class="beat-art" style="display:grid;place-items:center;font-weight:900;">${safeText((b.title||"B").slice(0,2).toUpperCase())}</div>`
        }
        <button class="play-btn"
          data-audio="${b.previewAudio || ""}"
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

  window.__LATEST_BEATS__ = beats;
}

/**
 * ✅ Auto-boot for pages that have marketplace-like grids.
 * (Doesn’t interfere with your homepage custom loader)
 */
async function boot() {
  const loadingBox =
    document.querySelector("#loadingBeats") ||
    document.querySelector("[data-loading-beats]") ||
    document.querySelector(".loading-beats");

  // Only auto-render if a known grid exists
  const hasGrid =
    document.querySelector("#beatsGrid") ||
    document.querySelector("#trendingGrid") ||
    document.querySelector("#marketGrid") ||
    document.querySelector("[data-beats-grid]") ||
    document.querySelector(".beats-grid");

  if (!hasGrid) return;

  try {
    const beats = await fetchBeats({ max: 60 });
    if (loadingBox) loadingBox.remove();
    renderBeats(beats);
  } catch (err) {
    console.error("Beats load failed:", err);
    const grid =
      document.querySelector("#beatsGrid") ||
      document.querySelector("#trendingGrid") ||
      document.querySelector("#marketGrid") ||
      document.querySelector("[data-beats-grid]") ||
      document.querySelector(".beats-grid");

    if (grid) {
      grid.innerHTML = `
        <div class="empty-state">
          Failed to load beats.<br/>
          <small>${(err && err.message) ? err.message : "Unknown error"}</small>
        </div>
      `;
    }
  }
}

document.addEventListener("DOMContentLoaded", boot);
