// beats.js
import { db } from "./firebase.js";
import {
  collection,
  query,
  orderBy,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const beatsContainer = document.getElementById("beatsContainer");

if (beatsContainer) {
  const q = query(collection(db, "beats"), orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    beatsContainer.innerHTML = "";

    if (snapshot.empty) {
      beatsContainer.innerHTML = "<p>No beats uploaded yet</p>";
      return;
    }

    snapshot.forEach(doc => {
      const beat = doc.data();

      beatsContainer.innerHTML += `
        <div class="beat-card">
          <img src="${beat.cover}" />
          <h3>${beat.title}</h3>
          <p>${beat.producer}</p>
          <p>$${beat.price}</p>
          <audio controls src="${beat.audio}"></audio>
          <button onclick="buyBeat('${doc.id}', ${beat.price})">
            Buy Beat
          </button>
        </div>
      `;
    });
  }, (error) => {
    beatsContainer.innerHTML = "Error loading beats";
    console.error(error);
  });
}

window.buyBeat = (id, price) => {
  localStorage.setItem("checkoutBeat", JSON.stringify({ id, price }));
  window.location.href = "/checkout.html";
};
