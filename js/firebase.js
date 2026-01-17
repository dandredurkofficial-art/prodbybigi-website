// /js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi",
  storageBucket: "prodbybigi.firebasestorage.app",
  messagingSenderId: "1040553526206",
  appId: "1:1040553526206:web:38216a9f75eabfe556efef",
  measurementId: "G-7HR862H9L7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ------- helpers -------
function safeText(v, fallback = "") {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function pickAudio(beat) {
  return (
    beat.previewAudio ||
    beat.previewUrl ||
    beat.audioUrl ||
    beat.audioURL ||
    beat.audio ||
    ""
  );
}

function pickCover(beat) {
  return (
    beat.coverUrl ||
    beat.coverURL ||
    beat.artwork ||
    beat.artworkUrl ||
    beat.artworkURL ||
    ""
  );
}

function pickProducerName(beat) {
  return (
    beat.producerName ||
    beat.producerDisplayName ||
    beat.displayName ||
    beat.username ||
    "Producer"
  );
}

function formatPrice(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toFixed(0);
}

function beatCardHTML(beatDoc) {
  const beat = beatDoc;
  const title = safeText(beat.title, "Untitled Beat");
  const cover = pickCover(beat);
  const audio = pickAudio(beat);
  const producerId = safeText(beat.producerId, "");
  const producerName = pickProducerName(beat);
  const price = formatPrice(beat.price);

  return `
  <article class="beat-card">
    <div class="beat-cover">
      ${cover ? `<img src="${cover}" alt="${title} cover">` : `<div class="cover-fallback">No Artwork</div>`}
      <button class="play-btn" type="button" aria-label="Play preview" data-audio="${audio}">
        <span class="icon">▶</span>
      </button>
    </div>

    <div class="beat-meta">
      <div class="meta-left">
        <h3 class="beat-title">${title}</h3>
        <a class="producer-link" href="producer-profile.html?producerId=${encodeURIComponent(producerId)}">
          ${producerName}
        </a>
      </div>
      <button class="price-btn" type="button">$${price}</button>
    </div>
  </article>`;
}

// ------- public loaders -------
export async function loadTrendingBeats(containerEl, { max = 10 } = {}) {
  containerEl.innerHTML = `<div class="loading">Loading beats…</div>`;

  const q = query(
    collection(db, "beats"),
    where("published", "==", true),
    orderBy("createdAt", "desc"),
    limit(max)
  );

  const snap = await getDocs(q);
  if (snap.empty) {
    containerEl.innerHTML = `<div class="empty">No beats yet. Upload your first beat in the Producer Dashboard.</div>`;
    return;
  }

  const html = [];
  snap.forEach((d) => html.push(beatCardHTML(d.data())));
  containerEl.innerHTML = html.join("");
}

export async function loadMarketplaceBeats(containerEl, { max = 40 } = {}) {
  containerEl.innerHTML = `<div class="loading">Loading marketplace…</div>`;

  const q = query(
    collection(db, "beats"),
    where("published", "==", true),
    orderBy("createdAt", "desc"),
    limit(max)
  );

  const snap = await getDocs(q);
  if (snap.empty) {
    containerEl.innerHTML = `<div class="empty">No beats published yet.</div>`;
    return;
  }

  const html = [];
  snap.forEach((d) => html.push(beatCardHTML(d.data())));
  containerEl.innerHTML = html.join("");
}
