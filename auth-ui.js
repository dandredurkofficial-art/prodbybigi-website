// /auth-ui.js (FULL UPDATED) ✅
// Works with your NEW “no .html” routes like /login/ /register/ /dashboard/ etc.
// ✅ Uses your existing /js/firebase.js as the SINGLE SOURCE OF TRUTH (no double initialize).
// ✅ Exposes global functions for onclick: loginUser, registerUser, googleLogin, googleRegister, resetPassword, logout
// ✅ Google Popup first, Redirect fallback (mobile / popup blocked)
// ✅ Only auto-redirects when you're on auth pages (/login/, /register/, /reset/) so it won't hijack other pages.

import "/js/firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ✅ Your live domain (used inside reset email link) */
const APP_URL = "https://audiory.site";

function $(id) { return document.getElementById(id); }
function statusEl() { return $("status"); }
function setStatus(msg) { if (statusEl()) statusEl().textContent = msg || ""; }

function isAuthPage() {
  const p = location.pathname || "/";
  return (
    p.startsWith("/login") ||
    p.startsWith("/register") ||
    p.startsWith("/reset")
  );
}

function getRoleSelected() {
  const r = document.querySelector("input[name='role']:checked");
  return r ? String(r.value) : "";
}

function getReturnUrl() {
  // supports /login/?return=/producer-profile/?producerId=...
  try {
    const u = new URL(location.href);
    const r = (u.searchParams.get("return") || "").trim();
    if (r.startsWith("/")) return r;
  } catch {}
  return "";
}

function goAfterAuth(role) {
  // 1) if return exists, always go there (same-site path only)
  const ret = getReturnUrl();
  if (ret) {
    location.href = ret;
    return;
  }

  // 2) otherwise route by role (NO .html)
  redirectByRole(role);
}

/* =========================
   ✅ Helpers: Firebase handles
========================= */
function getAuthOrThrow() {
  const auth = window.FB?.auth;
  if (!auth) throw new Error("Firebase auth not ready (window.FB.auth missing).");
  return auth;
}

function getDbOrThrow() {
  const db = window.FB?.db;
  if (!db) throw new Error("Firestore not ready (window.FB.db missing).");
  return db;
}

/* =========================
   ✅ REGISTER (email+password)
========================= */
window.registerUser = async function registerUser() {
  const auth = getAuthOrThrow();
  const db = getDbOrThrow();

  const email = String($("email")?.value || "").trim();
  const password = String($("password")?.value || "");
  const role = getRoleSelected();

  if (!email || !password) return alert("Enter email and password");
  if (!role) return alert("Please select a role (Producer or Buyer)");

  try {
    setStatus("Creating account...");
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    // Optional nice displayName (can be replaced later)
    try {
      await updateProfile(cred.user, { displayName: role === "producer" ? "Producer" : "Buyer" });
    } catch {}

    // Save user profile
    await setDoc(doc(db, "users", uid), {
      email: email.toLowerCase(),
      role,
      createdAt: serverTimestamp(),
      displayName: role === "producer" ? "Producer" : "Buyer"
    }, { merge: true });

    // Role-specific collection (keep your current structure)
    if (role === "producer") {
      await setDoc(doc(db, "producers", uid), {
        email: email.toLowerCase(),
        beatsCount: 0,
        followers: 0,
        createdAt: serverTimestamp()
      }, { merge: true });
    }

    if (role === "buyer") {
      await setDoc(doc(db, "buyers", uid), {
        email: email.toLowerCase(),
        purchases: 0,
        createdAt: serverTimestamp()
      }, { merge: true });
    }

    setStatus("");
    goAfterAuth(role);
  } catch (err) {
    console.error(err);
    setStatus("");
    alert(err?.message || String(err));
  }
};

/* =========================
   ✅ LOGIN (email+password)
========================= */
window.loginUser = async function loginUser() {
  const auth = getAuthOrThrow();

  const email = String($("email")?.value || "").trim();
  const password = String($("password")?.value || "");

  if (!email || !password) return alert("Enter email and password");

  try {
    setStatus("Signing in...");
    await signInWithEmailAndPassword(auth, email, password);
    // redirect handled by auth listener (only on auth pages)
  } catch (err) {
    console.error(err);
    setStatus("");
    alert(err?.message || String(err));
  }
};

/* =========================
   ✅ RESET PASSWORD
========================= */
window.resetPassword = async function resetPassword() {
  const auth = getAuthOrThrow();

  const email = String($("email")?.value || "").trim();
  if (!email) return alert("Enter your email first");

  try {
    setStatus("Sending reset email...");

    await sendPasswordResetEmail(auth, email, {
      url: `${APP_URL}/login/`,
      handleCodeInApp: false
    });

    setStatus("✅ Reset email sent. Check inbox/spam.");
  } catch (err) {
    console.error(err);
    setStatus("");
    alert(err?.message || String(err));
  }
};

/* =========================
   ✅ GOOGLE SIGN IN/REGISTER
========================= */
const googleProvider = new GoogleAuthProvider();

async function googleSignInSmart(auth) {
  try {
    // ✅ popup first
    const res = await signInWithPopup(auth, googleProvider);
    return res;
  } catch (e) {
    // ✅ redirect fallback for mobile/popup issues
    const code = e?.code || "";
    const popupRelated =
      code.includes("popup") ||
      code.includes("blocked") ||
      code.includes("cancelled") ||
      code.includes("closed-by-user") ||
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    if (popupRelated) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw e;
  }
}

// Google LOGIN button
window.googleLogin = async function googleLogin() {
  const auth = getAuthOrThrow();
  const db = getDbOrThrow();

  try {
    setStatus("Opening Google...");
    const res = await googleSignInSmart(auth);
    if (!res?.user) return; // redirect started

    // ensure profile exists
    await ensureUserProfile(res.user, { roleHint: "" });

    const snap = await getDoc(doc(db, "users", res.user.uid));
    const role = snap.exists() ? (snap.data()?.role || "buyer") : "buyer";

    setStatus("");
    goAfterAuth(role);
  } catch (err) {
    console.error(err);
    setStatus("");
    alert("Google login failed: " + (err?.message || String(err)));
  }
};

// Google REGISTER button (role required)
window.googleRegister = async function googleRegister() {
  const auth = getAuthOrThrow();
  const db = getDbOrThrow();

  const role = getRoleSelected();
  if (!role) return alert("Please select a role first (Producer or Buyer)");

  localStorage.setItem("pendingRole", role);

  try {
    setStatus("Opening Google...");
    const res = await googleSignInSmart(auth);
    if (!res?.user) return; // redirect started

    await ensureUserProfile(res.user, { roleHint: role });

    const snap = await getDoc(doc(db, "users", res.user.uid));
    const finalRole = snap.exists() ? (snap.data()?.role || role) : role;

    setStatus("");
    goAfterAuth(finalRole);
  } catch (err) {
    console.error(err);
    setStatus("");
    alert("Google signup failed: " + (err?.message || String(err)));
  }
};

// Handle redirect result (mobile / popup blocked)
(async function handleGoogleRedirectResult() {
  const auth = window.FB?.auth;
  const db = window.FB?.db;
  if (!auth || !db) return;

  try {
    const res = await getRedirectResult(auth);
    if (!res?.user) return;

    const pendingRole = localStorage.getItem("pendingRole") || "";
    await ensureUserProfile(res.user, { roleHint: pendingRole });

    const snap = await getDoc(doc(db, "users", res.user.uid));
    const role = snap.exists() ? (snap.data()?.role || "buyer") : "buyer";

    setStatus("");
    goAfterAuth(role);
  } catch (e) {
    // ignore if none
  }
})();

/* =========================
   ✅ AUTH STATE LISTENER
   Only redirects on auth pages to avoid hijacking other pages.
========================= */
onAuthStateChanged(getAuthOrThrow(), async (user) => {
  const db = window.FB?.db;

  // Prevent redirect loop right after logout
  if (localStorage.getItem("justLoggedOut") === "1") {
    if (!user) localStorage.removeItem("justLoggedOut");
    return;
  }

  if (!user) return;
  if (!isAuthPage()) return; // ✅ IMPORTANT

  try {
    await ensureUserProfile(user, { roleHint: localStorage.getItem("pendingRole") || "" });

    if (!db) return;
    const snap = await getDoc(doc(db, "users", user.uid));
    const role = snap.exists() ? (snap.data()?.role || "buyer") : "buyer";

    goAfterAuth(role);
  } catch (e) {
    console.error(e);
  }
});

/* =========================
   ✅ Create Firestore profile if missing (Google sign-in users)
========================= */
async function ensureUserProfile(user, { roleHint = "" } = {}) {
  const db = getDbOrThrow();
  const uref = doc(db, "users", user.uid);
  const snap = await getDoc(uref);

  if (snap.exists()) return;

  const pendingRole = (roleHint || localStorage.getItem("pendingRole") || "buyer").trim() || "buyer";
  localStorage.removeItem("pendingRole");

  const email = (user.email || "").toLowerCase();

  await setDoc(uref, {
    email,
    role: pendingRole,
    createdAt: serverTimestamp(),
    displayName: user.displayName || (pendingRole === "producer" ? "Producer" : "Buyer")
  }, { merge: true });

  if (pendingRole === "producer") {
    await setDoc(doc(db, "producers", user.uid), {
      email,
      beatsCount: 0,
      followers: 0,
      createdAt: serverTimestamp()
    }, { merge: true });
  }

  if (pendingRole === "buyer") {
    await setDoc(doc(db, "buyers", user.uid), {
      email,
      purchases: 0,
      createdAt: serverTimestamp()
    }, { merge: true });
  }
}

/* =========================
   ✅ REDIRECT LOGIC (NO .html)
========================= */
function redirectByRole(role) {
  const r = String(role || "").toLowerCase();

  if (r === "admin") {
    location.href = "/admin-dashboard/";
    return;
  }
  if (r === "producer") {
    location.href = "dashboard.html";
    return;
  }
  if (r === "buyer") {
    location.href = "/buyer-dashboard/";
    return;
  }

  // fallback
  location.href = "/buyer-dashboard/";
}

/* =========================
   ✅ LOGOUT (GLOBAL)
========================= */
window.logout = async function logout() {
  const auth = getAuthOrThrow();
  try {
    localStorage.setItem("justLoggedOut", "1");
    await signOut(auth);
    location.replace("/login/");
  } catch (err) {
    console.error(err);
    alert(err?.message || String(err));
  }
};
