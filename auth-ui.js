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
  try {
    const u = new URL(location.href);
    const r = (u.searchParams.get("return") || "").trim();
    if (r.startsWith("/")) return r;
  } catch {}
  return "";
}

function goAfterAuth(role) {

  const ret = getReturnUrl();
  if (ret) {
    location.href = ret;
    return;
  }

  redirectByRole(role);
}

/* =========================
   Firebase helpers
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
   REGISTER
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

    let user;

    /* ------------------------------------
       FIX: prevent duplicate Google account
    ------------------------------------ */

    if (auth.currentUser && auth.currentUser.email === email) {

      // user already signed in with Google
      user = auth.currentUser;

    } else {

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      user = cred.user;

    }

    const uid = user.uid;

    try {
      await updateProfile(user, {
        displayName: role === "producer" ? "Producer" : "Buyer"
      });
    } catch {}

    await setDoc(doc(db, "users", uid), {
      email: email.toLowerCase(),
      role,
      createdAt: serverTimestamp(),
      displayName: role === "producer" ? "Producer" : "Buyer"
    }, { merge: true });

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
   LOGIN
========================= */

window.loginUser = async function loginUser() {

  const auth = getAuthOrThrow();

  const email = String($("email")?.value || "").trim();
  const password = String($("password")?.value || "");

  if (!email || !password) return alert("Enter email and password");

  try {

    setStatus("Signing in...");

    await signInWithEmailAndPassword(auth, email, password);

  } catch (err) {

    console.error(err);
    setStatus("");
    alert(err?.message || String(err));

  }
};

/* =========================
   RESET PASSWORD
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
   GOOGLE LOGIN
========================= */

const googleProvider = new GoogleAuthProvider();

async function googleSignInSmart(auth) {

  try {

    const res = await signInWithPopup(auth, googleProvider);
    return res;

  } catch (e) {

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

/* GOOGLE LOGIN BUTTON */

window.googleLogin = async function googleLogin() {

  const auth = getAuthOrThrow();
  const db = getDbOrThrow();

  try {

    setStatus("Opening Google...");

    const res = await googleSignInSmart(auth);

    if (!res?.user) return;

    await ensureUserProfile(res.user, { roleHint: "" });

    const snap = await getDoc(doc(db, "users", res.user.uid));

    const role = snap.exists() ? (snap.data()?.role || "") : "";

    setStatus("");

    if (!role) {

      location.href = "/register/";
      return;

    }

    goAfterAuth(role);

  } catch (err) {

    console.error(err);
    setStatus("");
    alert("Google login failed: " + (err?.message || String(err)));

  }

};

/* GOOGLE REGISTER BUTTON */

window.googleRegister = async function googleRegister() {

  const auth = getAuthOrThrow();
  const db = getDbOrThrow();

  const role = getRoleSelected();

  if (!role) return alert("Please select a role first (Producer or Buyer)");

  localStorage.setItem("pendingRole", role);

  try {

    setStatus("Opening Google...");

    const res = await googleSignInSmart(auth);

    if (!res?.user) return;

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

/* =========================
   HANDLE GOOGLE REDIRECT
========================= */

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

    const role = snap.exists() ? (snap.data()?.role || "") : "";

    setStatus("");

    if (!role) {

      location.href = "/register/";
      return;

    }

    goAfterAuth(role);

  } catch (e) {}

})();

/* =========================
   AUTH STATE LISTENER
========================= */

onAuthStateChanged(getAuthOrThrow(), async (user) => {

  const db = window.FB?.db;

  if (localStorage.getItem("justLoggedOut") === "1") {

    if (!user) localStorage.removeItem("justLoggedOut");
    return;

  }

  if (!user) return;
  if (!isAuthPage()) return;

  try {

    await ensureUserProfile(user, { roleHint: localStorage.getItem("pendingRole") || "" });

    const snap = await getDoc(doc(db, "users", user.uid));

    const role = snap.exists() ? (snap.data()?.role || "") : "";

    if (!role) {

      if (!location.pathname.startsWith("/register")) {
        location.href = "/register/";
      }

      return;

    }

    goAfterAuth(role);

  } catch (e) {

    console.error(e);

  }

});

/* =========================
   CREATE USER PROFILE
========================= */

async function ensureUserProfile(user, { roleHint = "" } = {}) {

  const db = getDbOrThrow();
  const uref = doc(db, "users", user.uid);
  const snap = await getDoc(uref);

  if (snap.exists()) return;

  const pendingRole = (roleHint || localStorage.getItem("pendingRole") || "").trim();

  if (!pendingRole) {

    // already on register page → don't redirect again
    if (location.pathname.startsWith("/register")) {
      return;
    }

    window.location.href = "/register/";
    return;
  }

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
   REDIRECT LOGIC
========================= */

function redirectByRole(role) {

  const r = String(role || "").toLowerCase();

  if (r === "admin") {
    location.href = "/admin-dashboard/";
    return;
  }

  if (r === "producer") {
    location.href = "/dashboard/";
    return;
  }

  if (r === "buyer") {
    location.href = "/buyer-dashboard/";
    return;
  }

  location.href = "/buyer-dashboard/";

}

/* =========================
   LOGOUT
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
