import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* 🔐 YOUR REAL CONFIG */
const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "YOUR_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_BUCKET",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* 🧠 RENDER BEATS */
async function loadBeats(containerId) {
  const grid = document.getElementById(containerId);
  if (!grid) return;

  const q = query(
    collection(db, "beats"),
    where("published", "==", true),
    orderBy("createdAt", "desc")
  );

  const snap = await getDocs(q);
  grid.innerHTML = "";

  snap.forEach((doc) => {
    const b = doc.data();

    grid.innerHTML += `
      <div class="beat-card">
        <div class="beat-cover">
          <img src="${b.artwork}" alt="${b.title}">
          <button class="play-btn" data-audio="${b.previewAudio}">▶</button>
        </div>

        <div class="beat-meta">
          <h3>${b.title}</h3>
          <a href="producer-profile.html?id=${b.producerId}">
            Prod. ${b.producerName || "Producer"}
          </a>
          <span class="price">$${b.price}</span>
        </div>
      </div>
    `;
  });
}

/* AUTO LOAD */
loadBeats("beatsGrid");
loadBeats("homeGrid");
