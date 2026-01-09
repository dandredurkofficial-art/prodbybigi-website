import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "YOUR_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export async function loadBeats(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const q = query(collection(db, "beats"), where("published", "==", true));
  const snap = await getDocs(q);

  container.innerHTML = "";

  snap.forEach(doc => {
    const beat = doc.data();

    const card = document.createElement("div");
    card.className = "beat-card";

    card.innerHTML = `
      <img src="${beat.artwork}" />
      <h3>${beat.title}</h3>
      <p>${beat.producerName}</p>
      <button onclick="playBeat('${beat.audioUrl}')">▶ Play</button>
    `;

    container.appendChild(card);
  });
}
