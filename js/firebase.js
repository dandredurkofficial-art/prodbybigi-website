/* /js/firebase.js
   ✅ This file MUST:
   1) initialize Firebase + Firestore
   2) expose helpers on window.FB (your index/marketplace scripts use this)
   3) dispatch "firebase-ready" so pages can load beats

   IMPORTANT:
   - Replace firebaseConfig with YOUR real config from Firebase Console
   - Do NOT paste this into DevTools console — save it as /js/firebase.js
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
   Replace this whole object with your real config.
   Firebase Console → Project settings → Your apps → Firebase SDK snippet → Config
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
   2) INIT (safe, no double init)
   ========================= */
let app;
try {
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
} catch (e) {
  console.error("[firebase.js] Failed to initialize Firebase. Check firebaseConfig.", e);
}

/* =========================
   3) AUTH + DB
   ========================= */
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

// Optional: keep users logged in (helps dashboards)
async function enableAuthPersistence(mode = "local") {
  if (!auth) return;
  try {
    const persistence = mode === "session" ? browserSessionPersistence : browserLocalPersistence;
    await setPersistence(auth, persistence);
  } catch (e) {
    // Not fatal (some browsers block in private mode)
    console.warn("[firebase.js] Auth persistence not set:", e?.message || e);
  }
}
enableAuthPersistence("local");

/* =========================
   4) EXPOSE HELPERS (your pages expect window.FB)
   ========================= */
window.FB = {
  // core
  app,
  db,
  auth,

  // firestore helpers used by your pages
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,

  // extra firestore helpers (for dashboard/upload/edit/delete)
  doc,
  addDoc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot
};

// Auth helpers (handy for login/register pages)
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
   5) READY EVENT (your pages wait for this)
   ========================= */
function fireReady() {
  try {
    window.dispatchEvent(new Event("firebase-ready"));
  } catch (e) {
    console.warn("[firebase.js] Could not dispatch firebase-ready:", e);
  }
}

/* =========================
   6) QUICK SANITY CHECK (helps debug “Could not load beats”)
   ========================= */
(async function sanityCheck() {
  if (!db) {
    console.error("[firebase.js] Firestore not available. Check firebaseConfig/projectId.");
    fireReady();
    return;
  }

  // We only READ one beat doc to verify permissions + connection.
  // Your rules allow read: if true; so this should work even signed out.
  try {
    const q = query(collection(db, "beats"), limit(1));
    await getDocs(q);
    // If this succeeds, your index/marketplace should be able to load beats.
  } catch (e) {
    console.error(
      "[firebase.js] Firestore read failed. This causes 'Could not load beats'. " +
      "Most common causes: wrong firebaseConfig (wrong projectId) OR rules not deployed.",
      e
    );
  } finally {
    fireReady();
  }
})();
