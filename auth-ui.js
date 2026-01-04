import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ✅ FULL CONFIG — REQUIRED */
const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi",
  storageBucket: "prodbybigi.appspot.com",
  messagingSenderId: "1040553526206",
  appId: "1:1040553526206:web:38216a9f75eabfe556efef"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* =========================
   LOGIN
========================= */
window.loginUser = async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "dashboard.html";
  } catch (err) {
    alert(err.message);
  }
};

/* =========================
   REGISTER + PRODUCER DOC (ONE TIME)
========================= */
window.registerUser = async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    // ✅ CREATE PRODUCER DOCUMENT (ONE TIME)
    await setDoc(doc(db, "producers", cred.user.uid), {
      uid: cred.user.uid,
      email: email,
      displayName: email.split("@")[0],
      createdAt: Date.now(),
      followers: [],
      verified: false
    });

    window.location.href = "dashboard.html";
  } catch (err) {
    alert(err.message);
  }
};
