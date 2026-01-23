import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* 🔥 AUDIORY FIREBASE CONFIG (NEW) */
const firebaseConfig = {
  apiKey: "AIzaSyCmsFTjDryYOTddWfScTKsnrs0cWAHnpdc",
  authDomain: "audiory-beat-store.firebaseapp.com",
  projectId: "audiory-beat-store",
  storageBucket: "audiory-beat-store.firebasestorage.app",
  messagingSenderId: "688272560511",
  appId: "1:688272560511:web:9031e6ce215d6f08764a4a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const googleProvider = new GoogleAuthProvider();

/* =========================
   HELPERS
========================= */
function getSelectedRoleOrNull() {
  return document.querySelector("input[name='role']:checked")?.value || null;
}

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

async function ensureUserProfile(uid, email, role) {
  // If profile exists, keep it.
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (snap.exists()) return snap.data();

  // Create profile if missing (Google login often needs this)
  const data = {
    email: email || "",
    role,
    createdAt: Date.now()
  };
  await setDoc(ref, data);
  return data;
}

/* =========================
   REGISTER (EMAIL/PASS)
========================= */
window.registerUser = async function () {
  const email = document.getElementById("email")?.value?.trim();
  const password = document.getElementById("password")?.value;
  const role = getSelectedRoleOrNull();

  if (!email || !password) {
    alert("Enter email and password");
    return;
  }
  if (!role) {
    alert("Please select a role");
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    await ensureUserProfile(uid, email, role);
    redirectByRole(role);

  } catch (err) {
    alert(err.message);
  }
};

/* =========================
   LOGIN (EMAIL/PASS)
========================= */
window.loginUser = async function () {
  const email = document.getElementById("email")?.value?.trim();
  const password = document.getElementById("password")?.value;

  if (!email || !password) {
    alert("Enter email and password");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // redirect happens in onAuthStateChanged
  } catch (err) {
    alert(err.message);
  }
};

/* =========================
   GOOGLE LOGIN
========================= */
window.loginWithGoogle = async function () {
  try {
    const res = await signInWithPopup(auth, googleProvider);
    const user = res.user;

    // If they already have a profile, redirect by saved role.
    // If not, default role = buyer (safe default).
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      await ensureUserProfile(user.uid, user.email, "buyer");
      redirectByRole("buyer");
      return;
    }

    redirectByRole(snap.data().role);

  } catch (err) {
    alert(err.message);
  }
};

/* =========================
   GOOGLE REGISTER
   Uses selected role on register page
========================= */
window.registerWithGoogle = async function () {
  const role = getSelectedRoleOrNull();
  if (!role) {
    alert("Select Producer or Buyer first");
    return;
  }

  try {
    const res = await signInWithPopup(auth, googleProvider);
    const user = res.user;

    // Create profile only if missing; do NOT overwrite existing role
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      await ensureUserProfile(user.uid, user.email, role);
      redirectByRole(role);
      return;
    }

    // If profile exists already, just use existing role
    redirectByRole(snap.data().role);

  } catch (err) {
    alert(err.message);
  }
};

/* =========================
   RESET PASSWORD
========================= */
window.resetPassword = async function () {
  const email = document.getElementById("email")?.value?.trim();

  if (!email) {
    alert("Enter your email first");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    alert("✅ Password reset email sent. Check your inbox/spam.");
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
    // If somehow missing, create a safe default profile
    const data = await ensureUserProfile(user.uid, user.email, "buyer");
    redirectByRole(data.role);
    return;
  }

  redirectByRole(snap.data().role);
});

/* =========================
   LOGOUT (GLOBAL)
========================= */
window.logout = async function () {
  await signOut(auth);
  location.replace("login.html");
};
