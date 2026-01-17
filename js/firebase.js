/* /js/firebase.js
   ✅ Adds REAL diagnostics so you see WHY beats don’t load.
   ✅ Still exposes window.FB exactly like your pages expect.
*/

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================
   1) YOUR FIREBASE CONFIG
   =========================
   Replace with YOUR real config from Firebase Console:
   Project settings → Your apps → Web app → "Config"
*/
const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi",
  storageBucket: "prodbybigi.firebasestorage.app",
  messagingSenderId: "1040553526206",
  appId: "1:1040553526206:web:38216a9f75eabfe556efef"
};

/* =========================
   2) INIT
   ========================= */
let app = null;
try {
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
} catch (e) {
  console.error("[firebase.js] init failed (bad config?):", e);
}

/* =========================
   3) AUTH + DB
   ========================= */
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

// optional persistence
async function enableAuthPersistence(mode = "local") {
  if (!auth) return;
  try {
    await setPersistence(
      auth,
      mode === "session" ? browserSessionPersistence : browserLocalPersistence
    );
  } catch (e) {
    console.warn("[firebase.js] persistence not set:", e?.message || e);
  }
}
enableAuthPersistence("local");

/* =========================
   4) EXPOSE helpers your pages use
   ========================= */
window.FB = {
  app,
  db,
  auth,

  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,

  doc,
  addDoc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot
};

window.AUTH = {
  auth,
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup
};

/* =========================
   5) DIAGNOSTICS (shows why loading fails)
   ========================= */
window.FB_DIAG = {
  ok: false,
  projectId: firebaseConfig.projectId || "(missing projectId)",
  lastError: null
};

function showDiagBox(text) {
  // Only show in-page debug if you add ?debug=1 to URL
  if (!location.search.includes("debug=1")) return;
  let box = document.getElementById("fbDiagBox");
  if (!box) {
    box = document.createElement("div");
    box.id = "fbDiagBox";
    box.style.cssText =
      "position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;" +
      "background:rgba(0,0,0,.85);color:#fff;padding:12px;border-radius:12px;" +
      "font:12px/1.35 system-ui;white-space:pre-wrap;border:1px solid rgba(255,255,255,.15)";
    document.body.appendChild(box);
  }
  box.textContent = text;
}

function fireReady() {
  window.dispatchEvent(new Event("firebase-ready"));
}

/* =========================
   6) SANITY CHECK: can we read /beats ?
   ========================= */
(async function sanityCheck() {
  if (!db) {
    const msg =
      "❌ Firestore not available.\n" +
      "Check firebaseConfig (projectId/authDomain/etc).";
    window.FB_DIAG.lastError = msg;
    console.error("[firebase.js]", msg);
    showDiagBox(msg);
    fireReady();
    return;
  }

  // Print where we are connected (THIS IS KEY)
  console.log("[firebase.js] connected projectId =", firebaseConfig.projectId);

  try {
    // Simple read test (should work with your rules: allow read: if true)
    const testQ = query(collection(db, "beats"), limit(1));
    await getDocs(testQ);

    window.FB_DIAG.ok = true;

    const okMsg =
      "✅ Firebase OK\n" +
      "projectId: " + firebaseConfig.projectId + "\n" +
      "beats read: SUCCESS";
    console.log("[firebase.js]", okMsg);
    showDiagBox(okMsg);
  } catch (e) {
    const code = e?.code || "(no-code)";
    const message = e?.message || String(e);

    const errMsg =
      "❌ Firestore read FAILED\n" +
      "projectId: " + firebaseConfig.projectId + "\n" +
      "error code: " + code + "\n" +
      "error: " + message + "\n\n" +
      "Most common causes:\n" +
      "1) Wrong firebaseConfig (wrong projectId = different project)\n" +
      "2) Rules not PUBLISHED in Firestore Rules tab\n" +
      "3) Firestore Database not created/enabled in this project";

    window.FB_DIAG.lastError = { code, message };
    console.error("[firebase.js]", e);
    showDiagBox(errMsg);
  } finally {
    fireReady();
  }
})();
