// /js/firebase.js (single source of truth)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// expose basic firestore helpers (keep)
window.FB = { db, collection, getDocs, query, orderBy, limit };

function normalizeBeat(docId, data) {
  const artwork =
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
    title: data.title || data.Title || "Untitled Beat",
    artwork,
    audio,
    producerId,
    producerName,
    price: Number(price) || 0,
    published: data.published === true,
    createdAt: data.createdAt || data.createdat || 0
  };
}

// ✅ important: no composite index needed
async function fetchBeats({ max = 60 } = {}) {
  const beatsRef = collection(db, "beats");

  // NOTE: We order by createdAt. Missing createdAt won't crash; it just sorts lower.
  const qy = query(beatsRef, orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(qy);

  const beats = [];
  snap.forEach((d) => {
    const beat = normalizeBeat(d.id, d.data());
    if (beat.published) beats.push(beat);
  });

  return beats;
}

// expose it so index/marketplace can use it safely
window.FB.fetchBeats = fetchBeats;

// ✅ NOW we tell pages firebase is ready (AFTER fetchBeats exists)
window.dispatchEvent(new Event("firebase-ready"));

// marketplace auto-render (ONLY if a beats grid exists)
function renderMarketplaceBeats(beats) {
  const grid = document.querySelector("#beatsGrid") || document.querySelector(".beats-grid");
  if (!grid) return;

  grid.innerHTML = "";

  beats.forEach((b) => {
    const card = document.createElement("div");
    card.className = "card beat-card";
    card.innerHTML = `
      <div class="beat-cover">
        ${
          b.artwork
            ? `<img src="${b.artwork}" alt="${b.title}" loading="lazy" />`
            : `<div style="height:100%;display:grid;place-items:center;font-weight:900;color:rgba(255,255,255,.7)">NO ART</div>`
        }
        <button class="play-fab" data-play-btn data-audio-url="${b.audio || ""}">
          <span class="playIcon">▶</span>
        </button>
      </div>
      <div class="beat-meta">
        <div>
          <h3>${b.title}</h3>
          <div class="producer">${b.producerName || ("Prod. " + (b.producerId||"").slice(0,8))}</div>
        </div>
        <div class="price-pill">$${Number(b.price||0).toFixed(2)}</div>
      </div>
    `;
    grid.appendChild(card);
  });
}

// boot: hide status boxes if beats load
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const beats = await fetchBeats({ max: 60 });

    const homeStatus = document.getElementById("homeStatus");
    const marketStatus = document.getElementById("marketStatus");
    if (homeStatus) homeStatus.classList.add("hidden");
    if (marketStatus) marketStatus.classList.add("hidden");

    renderMarketplaceBeats(beats);
    window.__LATEST_BEATS__ = beats;
  } catch (err) {
    console.error("Beats load failed:", err);
    const homeStatus = document.getElementById("homeStatus");
    const marketStatus = document.getElementById("marketStatus");
    if (homeStatus) homeStatus.textContent = "Could not load beats. Check Firestore rules & console.";
    if (marketStatus) marketStatus.textContent = "Could not load beats. Check Firestore rules & console.";
  }
});
