import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// LOGIN
window.loginUser = async () => {
  try {
    const cred = await signInWithEmailAndPassword(auth, email.value, password.value);
    location.href = "dashboard.html";
  } catch (err) {
    alert(err.message);
  }
};

// REGISTER
window.registerUser = async () => {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email.value, password.value);
    const uid = cred.user.uid;

    const producerRef = doc(db, "producers", uid);
    const snap = await getDoc(producerRef);

    // ⛔ Prevent overwrite
    if (!snap.exists()) {
      await setDoc(producerRef, {
        uid,
        email: cred.user.email,
        name: "New Producer",
        role: "producer", // 👈 DEFAULT ROLE
        plan: "free",
        uploads: 0,
        createdAt: serverTimestamp()
      });
    }

    location.href = "dashboard.html";
  } catch (err) {
    alert(err.message);
  }
};

// Attach button handlers AFTER DOM loads
document.addEventListener("DOMContentLoaded", () => {
  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");

  if (loginBtn) {
    loginBtn.addEventListener("click", window.loginUser);
  }

  if (registerBtn) {
    registerBtn.addEventListener("click", window.registerUser);
  }
});

