// /auth-ui.js
// FULL UPDATED + USER HANDLES + CUSTOM RESEND EMAIL VERIFICATION ✅

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
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

/* =========================
   APP / BACKEND URLS
========================= */

const APP_URL = "https://audiory.site";
const SEND_VERIFICATION_URL = "https://sendverificationemail-f65rhsquva-uc.a.run.app";
const RESEND_VERIFICATION_URL = "https://resendverificationemail-f65rhsquva-uc.a.run.app";
const VERIFY_TOKEN_URL = "https://verifyemailtoken-f65rhsquva-uc.a.run.app";

/* =========================
   HELPERS
========================= */

function $(id) {
  return document.getElementById(id);
}

function statusEl() {
  return $("status");
}

function setStatus(msg) {
  const el = statusEl();
  if (el) el.textContent = msg || "";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isAuthPage() {
  const p = location.pathname || "/";
  return (
    p.startsWith("/login") ||
    p.startsWith("/register") ||
    p.startsWith("/reset") ||
    p.startsWith("/verify-email")
  );
}

function isVerifyEmailPage() {
  return (location.pathname || "").startsWith("/verify-email");
}

function getRoleSelected() {
  const r = document.querySelector("input[name='role']:checked");
  return r ? String(r.value) : "";
}

function getReturnUrl() {
  try {
    const u = new URL(location.href);
    const r = (
      u.searchParams.get("return") ||
      u.searchParams.get("next") ||
      ""
    ).trim();

    if (r.startsWith("/")) return r;
  } catch {}
  return "";
}

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

function goAfterAuth(role) {
  const ret = getReturnUrl();
  if (ret) {
    location.href = ret;
    return;
  }
  redirectByRole(role);
}

function goToVerifyEmail() {
  const ret = getReturnUrl();
  const url = ret
    ? `/verify-email/?next=${encodeURIComponent(ret)}`
    : `/verify-email/`;

  location.href = url;
}

function getAuthOrThrow() {
  const auth = window.FB?.auth;
  if (!auth) throw new Error("Firebase auth not ready");
  return auth;
}

function getDbOrThrow() {
  const db = window.FB?.db;
  if (!db) throw new Error("Firestore not ready");
  return db;
}

function setPendingRole(role) {
  if (!role) return;
  localStorage.setItem("pendingRole", String(role));
}

function getPendingRole() {
  return String(localStorage.getItem("pendingRole") || "").trim();
}

function clearPendingRole() {
  localStorage.removeItem("pendingRole");
}

async function syncEmailVerifiedToUserDoc(user, verifiedOverride = null) {
  try {
    const db = getDbOrThrow();

    await setDoc(doc(db, "users", user.uid), {
      emailVerified: verifiedOverride === null ? !!user.emailVerified : !!verifiedOverride,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.warn("syncEmailVerifiedToUserDoc:", e);
  }
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });

  const text = await res.text().catch(() => "");
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(data?.error || data?.message || "Request failed");
  }

  return data;
}

async function sendVerificationEmailViaBackend({ uid, email, name }) {
  return postJSON(SEND_VERIFICATION_URL, {
    uid,
    email,
    name
  });
}

async function resendVerificationEmailViaBackend({ uid }) {
  return postJSON(RESEND_VERIFICATION_URL, {
    uid
  });
}

async function verifyEmailTokenViaBackend({ token, email }) {
  return postJSON(VERIFY_TOKEN_URL, {
    token,
    email
  });
}

/* =========================
   HANDLE GENERATOR
========================= */

async function generateHandle(email) {
  const db = getDbOrThrow();

  const baseRaw = String(email || "")
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const base = baseRaw || "user";

  let handle = base;
  let i = 0;

  while (true) {
    const ref = doc(db, "handles", handle);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      return handle;
    }

    i += 1;
    handle = `${base}${i}`;
  }
}

async function reserveHandle(uid, email) {
  const db = getDbOrThrow();

  const existingUserSnap = await getDoc(doc(db, "users", uid));
  if (existingUserSnap.exists()) {
    const existingHandle = String(existingUserSnap.data()?.handle || "").trim();
    if (existingHandle) return existingHandle;
  }

  const handle = await generateHandle(email);

  await setDoc(doc(db, "handles", handle), {
    uid
  }, { merge: true });

  return handle;
}

/* =========================
   USER PROFILE CREATION
========================= */

async function createBaseUserDocs({ uid, email, role, displayName }) {
  const db = getDbOrThrow();
  const cleanEmail = normalizeEmail(email);
  const handle = await reserveHandle(uid, cleanEmail);

  await setDoc(doc(db, "users", uid), {
    email: cleanEmail,
    role,
    handle,
    emailVerified: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    displayName
  }, { merge: true });

  if (role === "producer") {
    await setDoc(doc(db, "producers", uid), {
      email: cleanEmail,
      beatsCount: 0,
      followers: 0,
      createdAt: serverTimestamp()
    }, { merge: true });
  }

  if (role === "buyer") {
    await setDoc(doc(db, "buyers", uid), {
      email: cleanEmail,
      purchases: 0,
      createdAt: serverTimestamp()
    }, { merge: true });
  }

  return handle;
}

async function ensureUserProfile(user, { roleHint = "" } = {}) {
  const db = getDbOrThrow();
  const uref = doc(db, "users", user.uid);
  const snap = await getDoc(uref);

  if (snap.exists()) {
    const data = snap.data() || {};

    if (!data.handle) {
      const handle = await reserveHandle(user.uid, user.email || "");
      await setDoc(uref, {
        handle,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    return;
  }

  const pendingRole = (roleHint || getPendingRole() || "").trim();

  if (!pendingRole) {
    if (location.pathname.startsWith("/register")) {
      return;
    }

    location.href = "/register/";
    return;
  }

  clearPendingRole();

  const displayName = user.displayName || (pendingRole === "producer" ? "Producer" : "Buyer");

  await createBaseUserDocs({
    uid: user.uid,
    email: user.email || "",
    role: pendingRole,
    displayName
  });

  try {
    await sendVerificationEmailViaBackend({
      uid: user.uid,
      email: normalizeEmail(user.email || ""),
      name: displayName
    });
  } catch (e) {
    console.warn("Verification email send failed during ensureUserProfile:", e);
  }
}

/* =========================
   REGISTER
========================= */

window.registerUser = async function registerUser() {
  const auth = getAuthOrThrow();

  const email = normalizeEmail($("email")?.value || "");
  const password = String($("password")?.value || "");
  const role = getRoleSelected();

  if (!email || !password) return alert("Enter email and password");
  if (password.length < 6) return alert("Password must be at least 6 characters");
  if (!role) return alert("Please select a role");

  try {
    setStatus("Creating account...");
    setPendingRole(role);

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const user = cred.user;
    const displayName = role === "producer" ? "Producer" : "Buyer";

    try {
      await updateProfile(user, { displayName });
    } catch (e) {
      console.warn("updateProfile failed:", e);
    }

    await createBaseUserDocs({
      uid: user.uid,
      email,
      role,
      displayName
    });

    clearPendingRole();

    try {
      await sendVerificationEmailViaBackend({
        uid: user.uid,
        email,
        name: displayName
      });
      setStatus("Verification email sent.");
    } catch (mailErr) {
      console.error("Verification email send failed:", mailErr);
      setStatus("Account created. Verification email was not sent yet. You can resend it on the next page.");
    }

    goToVerifyEmail();
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
  const db = getDbOrThrow();

  const email = normalizeEmail($("email")?.value || "");
  const password = String($("password")?.value || "");

  if (!email || !password) return alert("Enter email and password");

  try {
    setStatus("Signing in...");

    const cred = await signInWithEmailAndPassword(auth, email, password);
    const user = cred.user;

    let snap = await getDoc(doc(db, "users", user.uid));

    if (!snap.exists()) {
      await ensureUserProfile(user, { roleHint: getPendingRole() });
      snap = await getDoc(doc(db, "users", user.uid));
    }

    const role = snap.exists() ? String(snap.data()?.role || "") : "";
    const emailVerifiedInDb = snap.exists() ? (snap.data()?.emailVerified === true) : false;

    await syncEmailVerifiedToUserDoc(user, emailVerifiedInDb);

    if (!role) {
      setStatus("");
      location.href = "/register/";
      return;
    }

    if (!emailVerifiedInDb) {
      setStatus("");
      goToVerifyEmail();
      return;
    }

    const twoFactorEnabled =
      snap.data()?.twoFactorEnabled === true;
    console.log(
      "2FA STATUS:",
      twoFactorEnabled
    );

    console.log(
      snap.data()
    );

    if (twoFactorEnabled) {

      const functions = getFunctions();

      const send2FACode =
        httpsCallable(
          functions,
          "send2FACode"
        );

      await send2FACode();

      localStorage.setItem(
        "pending2FARole",
        role
      );

      alert("2FA redirect starting");

      location.href =
        "/login-verify/";

      return;
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
   RESET PASSWORD
========================= */

window.resetPassword = async function resetPassword() {
  const auth = getAuthOrThrow();

  const email = normalizeEmail($("email")?.value || "");
  if (!email) return alert("Enter your email");

  try {
    setStatus("Sending reset email...");

    await sendPasswordResetEmail(auth, email, {
      url: `${APP_URL}/login/`,
      handleCodeInApp: false
    });

    setStatus("✅ Reset email sent");
  } catch (err) {
    console.error(err);
    setStatus("");
    alert(err?.message || String(err));
  }
};

/* =========================
   GOOGLE LOGIN / REGISTER
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
      /iPhone|Android/i.test(navigator.userAgent);

    if (popupRelated) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }

    throw e;
  }
}

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
    const emailVerifiedInDb = snap.exists() ? (snap.data()?.emailVerified === true) : false;

    setStatus("");

    if (!role) {
      location.href = "/register/";
      return;
    }

    await syncEmailVerifiedToUserDoc(res.user, emailVerifiedInDb);

    if (!emailVerifiedInDb) {
      goToVerifyEmail();
      return;
    }

    goAfterAuth(role);
  } catch (err) {
    console.error(err);
    setStatus("");
    alert("Google login failed: " + (err?.message || String(err)));
  }
};

window.googleRegister = async function googleRegister() {
  const auth = getAuthOrThrow();
  const db = getDbOrThrow();

  const role = getRoleSelected();
  if (!role) return alert("Select a role first");

  setPendingRole(role);

  try {
    setStatus("Opening Google...");

    const res = await googleSignInSmart(auth);
    if (!res?.user) return;

    await ensureUserProfile(res.user, { roleHint: role });

    const snap = await getDoc(doc(db, "users", res.user.uid));
    const finalRole = snap.exists() ? (snap.data()?.role || role) : role;
    const emailVerifiedInDb = snap.exists() ? (snap.data()?.emailVerified === true) : false;

    setStatus("");

    await syncEmailVerifiedToUserDoc(res.user, emailVerifiedInDb);

    if (!emailVerifiedInDb) {
      goToVerifyEmail();
      return;
    }

    goAfterAuth(finalRole);
  } catch (err) {
    console.error(err);
    setStatus("");
    alert("Google signup failed: " + (err?.message || String(err)));
  }
};

/* =========================
   VERIFY EMAIL PAGE HELPERS
========================= */

window.resendVerificationEmail = async function resendVerificationEmail() {
  const auth = getAuthOrThrow();
  const user = auth.currentUser;

  if (!user) {
    alert("Please login first");
    location.href = "/login/";
    return;
  }

  try {
    setStatus("Sending verification email...");
    await resendVerificationEmailViaBackend({
      uid: user.uid
    });
    setStatus("✅ Verification email sent");
  } catch (err) {
    console.error(err);
    setStatus("");
    alert(err?.message || String(err));
  }
};

window.refreshVerificationStatus = async function refreshVerificationStatus() {
  const auth = getAuthOrThrow();
  const db = getDbOrThrow();
  const user = auth.currentUser;

  if (!user) {
    alert("Please login first");
    location.href = "/login/";
    return;
  }

  try {
    setStatus("Checking verification status...");

    const snap = await getDoc(doc(db, "users", user.uid));
    const role = snap.exists() ? (snap.data()?.role || "") : "";
    const verified = snap.exists() ? (snap.data()?.emailVerified === true) : false;

    await syncEmailVerifiedToUserDoc(user, verified);

    if (!verified) {
      setStatus("Still not verified. Please check your inbox.");
      return;
    }

    setStatus("✅ Email verified");
    setTimeout(() => {
      goAfterAuth(role);
    }, 700);
  } catch (err) {
    console.error(err);
    setStatus("");
    alert(err?.message || String(err));
  }
};

window.verifyEmailByToken = async function verifyEmailByToken(token, email) {
  const auth = getAuthOrThrow();

  try {
    const data = await verifyEmailTokenViaBackend({ token, email });

    if (auth.currentUser) {
      await syncEmailVerifiedToUserDoc(auth.currentUser, true);
    }

    return data;
  } catch (err) {
    throw err;
  }
};

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
    await ensureUserProfile(user, { roleHint: getPendingRole() });

    const snap = await getDoc(doc(db, "users", user.uid));
    const role = snap.exists() ? (snap.data()?.role || "") : "";
    const verified = snap.exists() ? (snap.data()?.emailVerified === true) : false;

    await syncEmailVerifiedToUserDoc(user, verified);

    if (isVerifyEmailPage()) {
      const emailEl = $("verifyEmailText");
      const stateEl = $("verifyState");

      if (emailEl) emailEl.textContent = user.email || "";
      if (stateEl) {
        stateEl.textContent = verified ? "Verified ✅" : "Not verified yet";
        stateEl.style.color = verified ? "#22c55e" : "#fbbf24";
      }

      if (verified) {
        setTimeout(() => goAfterAuth(role), 800);
      }

      return;
    }

    if (!role) {
      if (!location.pathname.startsWith("/register")) {
        location.href = "/register/";
      }
      return;
    }

    if (!verified) {
      goToVerifyEmail();
      return;
    }

    goAfterAuth(role);
  } catch (e) {
    console.error(e);
  }
});

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
