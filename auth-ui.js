import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* 🔥 FIREBASE CONFIG */
const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* =========================
   REGISTER
========================= */
window.registerUser = async function () {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const role = document.querySelector("input[name='role']:checked")?.value;

  if (!role) {
    alert("Please select a role");
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    // Save user profile
    await setDoc(doc(db, "users", uid), {
      email,
      role,
      createdAt: Date.now()
    });

    // Save role-specific collection
    if (role === "producer") {
      await setDoc(doc(db, "producers", uid), {
        email,
        beatsCount: 0,
        followers: 0
      });
    }

    if (role === "buyer") {
      await setDoc(doc(db, "buyers", uid), {
        email,
        purchases: 0
      });
    }

    redirectByRole(role);

  } catch (err) {
    alert(err.message);
  }
};

/* =========================
   LOGIN
========================= */
window.loginUser = async function () {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    alert(err.message);
  }
};

/* =========================
   AUTH STATE LISTENER
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const snap = await getDoc(doc(db, "users", user.uid));

  if (!snap.exists()) {
    alert("Profile not found");
    return;
  }

  const role = snap.data().role;

  redirectByRole(role);
});

/* =========================
   REDIRECT LOGIC (FIXED)
========================= */
function redirectByRole(role) {
  if (role === "admin") {
    location.href = "admin-dashboard.html";
    return;
  }

  if (role === "producer") {
    location.href = "dashboard.html";
    return;
  }

  if (role === "buyer") {
    location.href = "buyer-dashboard.html";
    return;
  }

  alert("Invalid role");
}

/* =========================
   LOGOUT (GLOBAL)
========================= */
window.logout = async function () {
  await signOut(auth);
  location.href = "login.html";
};
