import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ✅ AUDIORY FIREBASE CONFIG (NEW PROJECT) */
const firebaseConfig = {
  apiKey: "AIzaSyCmsFTjDryYOTddWfScTKsnrs0cWAHnpdc",
  authDomain: "audiory-beat-store.firebaseapp.com",
  projectId: "audiory-beat-store",
  storageBucket: "audiory-beat-store.firebasestorage.app",
  messagingSenderId: "688272560511",
  appId: "1:688272560511:web:9031e6ce215d6f08764a4a",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const googleProvider = new GoogleAuthProvider();

/* =========================
   HELPERS
========================= */
function isOnAuthPage() {
  const p = (location.pathname || "").toLowerCase();
  return p.includes("login") || p.includes("register") || p.includes("reset");
}

function redirectByRole(role) {
  if (role === "admin") return (location.href = "admin-dashboard.html");
  if (role === "producer") return (location.href = "dashboard.html");
  if (role === "buyer") return (location.href = "buyer-dashboard.html");
  alert("Invalid role");
}

/* =========================
   REGISTER (EMAIL/PASS)
========================= */
window.registerUser = async function () {
  const email = (document.getElementById("email")?.value || "").trim();
  const password = document.getElementById("password")?.value || "";
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

    // role-specific docs
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
    alert(err?.message || err);
  }
};

/* =========================
   LOGIN (EMAIL/PASS)
========================= */
window.loginUser = async function () {
  const email = (document.getElementById("email")?.value || "").trim();
  const password = document.getElementById("password")?.value || "";
  if (!email || !password) return alert("Enter email and password");

  try {
    localStorage.removeItem("justLoggedOut");
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged will redirect
  } catch (err) {
    alert(err?.message || err);
  }
};

/* =========================
   GOOGLE LOGIN (works for login + register)
========================= */
window.loginWithGoogle = async function () {
  try {
    localStorage.removeItem("justLoggedOut");
    localStorage.removeItem("pendingRole");
    await signInWithRedirect(auth, googleProvider);
  } catch (err) {
    alert(err?.message || err);
  }
};

window.registerWithGoogle = async function () {
  const role = document.querySelector("input[name='role']:checked")?.value;
  if (!role) return alert("Select Producer or Buyer first");

  try {
    localStorage.removeItem("justLoggedOut");
    localStorage.setItem("pendingRole", role);
    await signInWithRedirect(auth, googleProvider);
  } catch (err) {
    alert(err?.message || err);
  }
};

/* Handle redirect results safely */
getRedirectResult(auth).catch(() => {});

/* =========================
   PASSWORD RESET
   - Uses your own domain reset page (clean)
========================= */
window.resetPassword = async function () {
  const email = (document.getElementById("email")?.value || "").trim();
  if (!email) return alert("Type your email first, then click Forgot password.");

  try {
    const actionCodeSettings = {
      // ✅ This makes the email link go to YOUR site instead of the ugly firebase page
      url: "https://prodby.officialbigi.shop/reset.html",
      handleCodeInApp: false,
    };

    await sendPasswordResetEmail(auth, email, actionCodeSettings);
    alert("✅ Password reset email sent. Check inbox/spam.");
  } catch (err) {
    alert(err?.message || err);
  }
};

/* =========================
   AUTH STATE LISTENER
   - prevents auto redirect after logout
========================= */
onAuthStateChanged(auth, async (user) => {
  // If user just clicked logout, don't auto-redirect
  if (localStorage.getItem("justLoggedOut") === "1") {
    return;
  }

  // If no user, stay on auth pages
  if (!user) return;

  // If you’re already on dashboard pages, continue.
  // If you're on login/register, still redirect (normal).
  try {
    const uref = doc(db, "users", user.uid);
    const snap = await getDoc(uref);

    // If user came from Google and has no profile yet, create it
    if (!snap.exists()) {
      const pendingRole = localStorage.getItem("pendingRole"); // from registerWithGoogle
      const role = pendingRole || "buyer"; // fallback
      await setDoc(uref, {
        email: user.email || "",
        role,
        createdAt: Date.now()
      });

      if (role === "producer") {
        await setDoc(doc(db, "producers", user.uid), {
          email: user.email || "",
          beatsCount: 0,
          followers: 0
        });
      } else {
        await setDoc(doc(db, "buyers", user.uid), {
          email: user.email || "",
          purchases: 0
        });
      }

      localStorage.removeItem("pendingRole");
      redirectByRole(role);
      return;
    }

    const role = snap.data().role;
    redirectByRole(role);
  } catch (err) {
    alert("Auth error: " + (err?.message || err));
  }
});

/* =========================
   LOGOUT (GLOBAL)
   - fixes “auto login again”
========================= */
window.logout = async function () {
  try {
    localStorage.setItem("justLoggedOut", "1");
    await signOut(auth);

    // hard redirect so back button won't restore signed-in state
    location.replace("login.html");
  } catch (err) {
    alert("Logout failed: " + (err?.message || err));
  }
};
