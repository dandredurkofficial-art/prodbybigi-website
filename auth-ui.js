import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ✅ AUDIORY FIREBASE CONFIG (your new firebase) */
const firebaseConfig = {
  apiKey: "AIzaSyCmsFTjDryYOTddWfScTKsnrs0cWAHnpdc",
  authDomain: "audiory-beat-store.firebaseapp.com",
  projectId: "audiory-beat-store",
  storageBucket: "audiory-beat-store.firebasestorage.app",
  messagingSenderId: "688272560511",
  appId: "1:688272560511:web:9031e6ce215d6f08764a4a",
  measurementId: "G-GLYGWQGS26"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Expose (optional, helpful)
window.auth = auth;
window.db = db;

const statusEl = () => document.getElementById("status");

/* ✅ Put your live domain here (for reset links) */
const APP_URL = "https://prodby.officialbigi.shop"; // you can change to https://officialbigi.shop if you want

/* =========================
   REGISTER (email+password)
========================= */
window.registerUser = async function () {
  const email = document.getElementById("email")?.value?.trim();
  const password = document.getElementById("password")?.value;
  const role = document.querySelector("input[name='role']:checked")?.value;

  if (!email || !password) return alert("Enter email and password");
  if (!role) return alert("Please select a role");

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
   LOGIN (email+password)
========================= */
window.loginUser = async function () {
  const email = document.getElementById("email")?.value?.trim();
  const password = document.getElementById("password")?.value;

  if (!email || !password) return alert("Enter email and password");

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // redirect handled by auth listener
  } catch (err) {
    alert(err.message);
  }
};

/* =========================
   RESET PASSWORD
========================= */
window.resetPassword = async function () {
  const email = document.getElementById("email")?.value?.trim();
  if (!email) return alert("Enter your email first");

  try {
    if (statusEl()) statusEl().textContent = "Sending reset email...";

    await sendPasswordResetEmail(auth, email, {
      url: `${APP_URL}/login.html`,
      handleCodeInApp: false
    });

    if (statusEl()) statusEl().textContent = "✅ Reset email sent. Check inbox/spam.";
  } catch (err) {
    if (statusEl()) statusEl().textContent = "";
    alert(err.message);
  }
};

/* =========================
   GOOGLE SIGN IN (login)
========================= */
const googleProvider = new GoogleAuthProvider();

async function googleSignInSmart() {
  try {
    // Try popup first (best UX on desktop)
    return await signInWithPopup(auth, googleProvider);
  } catch (e) {
    // Popup blocked / mobile -> redirect
    await signInWithRedirect(auth, googleProvider);
    return null;
  }
}

window.googleLogin = async function () {
  try {
    await googleSignInSmart();
    // redirect handled by auth listener / redirect result
  } catch (err) {
    alert(err.message);
  }
};

/* =========================
   GOOGLE REGISTER (needs role)
========================= */
window.googleRegister = async function () {
  const role = document.querySelector("input[name='role']:checked")?.value;
  if (!role) return alert("Please select a role first (Producer or Buyer)");

  // store role temporarily (so after redirect/popup we can create user doc)
  localStorage.setItem("pendingRole", role);

  try {
    await googleSignInSmart();
  } catch (err) {
    alert(err.message);
  }
};

/* Handle redirect result (when popup fails / mobile) */
(async function handleGoogleRedirectResult() {
  try {
    const res = await getRedirectResult(auth);
    if (!res || !res.user) return;

    // user signed in via redirect; ensure profile exists
    await ensureUserProfile(res.user);
  } catch (e) {
    // ignore if none
  }
})();

/* =========================
   AUTH STATE LISTENER
   ✅ Fix: don't auto-login after logout
========================= */
onAuthStateChanged(auth, async (user) => {
  // if just logged out, do nothing (prevents auto redirect loops)
  if (localStorage.getItem("justLoggedOut") === "1") {
    if (!user) localStorage.removeItem("justLoggedOut");
    return;
  }

  if (!user) return;

  await ensureUserProfile(user);

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) return alert("Profile not found");

  const role = snap.data().role;
  redirectByRole(role);
});

/* Create Firestore profile if missing (Google sign-in users) */
async function ensureUserProfile(user) {
  const uref = doc(db, "users", user.uid);
  const snap = await getDoc(uref);

  if (snap.exists()) return;

  const pendingRole = localStorage.getItem("pendingRole") || "buyer";
  localStorage.removeItem("pendingRole");

  const email = user.email || "";

  await setDoc(uref, {
    email,
    role: pendingRole,
    createdAt: Date.now()
  });

  if (pendingRole === "producer") {
    await setDoc(doc(db, "producers", user.uid), {
      email,
      beatsCount: 0,
      followers: 0
    });
  }

  if (pendingRole === "buyer") {
    await setDoc(doc(db, "buyers", user.uid), {
      email,
      purchases: 0
    });
  }
}

/* =========================
   REDIRECT LOGIC
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
   LOGOUT (GLOBAL) ✅ FIX
========================= */
window.logout = async function () {
  try {
    localStorage.setItem("justLoggedOut", "1");
    await signOut(auth);
    location.replace("login.html");
  } catch (err) {
    alert(err.message);
  }
};
