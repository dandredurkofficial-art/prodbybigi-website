import { db } from "./firebase.js";
import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", async () => {
  const container =
    document.getElementById("trendingBeats") ||
    document.getElementById("beatsGrid");

  if (!container) {
    console.warn("❌ Beats container not found");
    return;
  }

  container.innerHTML = "";

  try {
    const querySnapshot = await getDocs(collection(db, "beats"));

    if (querySnapshot.empty) {
      container.innerHTML = "<p style='color:#777'>No beats found</p>";
      return;
    }

    querySnapshot.forEach(doc => {
      const beat = doc.data();

      const card = document.createElement("div");
      card.className = "beat-card";

      card.innerHTML = `
        <img src="${beat.cover}" alt="${beat.title}">
        <h4>${beat.title}</h4>
        <p>${beat.producer || "ProdByBigi"}</p>
        <button onclick="playBeat('${beat.audio}')">▶ Play</button>
      `;

      container.appendChild(card);
    });

  } catch (err) {
    console.error("🔥 Firestore error:", err);
    container.innerHTML = "<p style='color:red'>Error loading beats</p>";
  }
});

window.playBeat = (src) => {
  let audio = document.getElementById("globalPlayer");

  if (!audio) {
    audio = document.createElement("audio");
    audio.id = "globalPlayer";
    document.body.appendChild(audio);
  }

  audio.src = src;
  audio.play();
};
