// /js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "YOUR_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export async function fetchBeats(limit = null) {
  const beatsRef = collection(db, "beats");
  let q = query(beatsRef, where("published", "==", true), orderBy("createdAt", "desc"));

  const snap = await getDocs(q);
  let beats = [];

  snap.forEach(doc => {
    beats.push({ id: doc.id, ...doc.data() });
  });

  return limit ? beats.slice(0, limit) : beats;
}
