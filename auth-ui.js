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

/* ---------- AUTH FUNCTIONS ---------- */

async function loginUser() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);

    const snap = await getDoc(doc(db, "users", cred.user.uid));
    if (!snap.exists()) {
      alert("Profile not found. Contact support.");
      return;
    }

    const role = snap.data().role;
    location.href =
      role === "producer"
        ? "dashboard.html"
        : role === "buyer"
        ? "buyer-dashboard.html"
        : "index.html";

  } catch (err) {
    alert(err.message);
  }
}

async function registerUser() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const role = document.querySelector('input[name="role"]:checked')?.value;

  if (!role) {
    alert("Select a role");
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      email,
      role,
      createdAt: serverTimestamp()
    });

    location.href =
      role === "producer" ? "dashboard.html" : "buyer-dashboard.html";

  } catch (err) {
    alert(err.message);
  }
}

/* ---------- SAFE BUTTON WIRING ---------- */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loginBtn")?.addEventListener("click", loginUser);
  document.getElementById("registerBtn")?.addEventListener("click", registerUser);
});
