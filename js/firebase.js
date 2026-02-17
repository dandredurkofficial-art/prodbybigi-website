// /js/firebase.js (FAST LOAD + CACHE + SINGLE SOURCE OF TRUTH) — AUDIORY VERSION (PROFILE PHOTO FIX + NAV AUTH UI)
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  addDoc,
  doc,
  query,
  where,
  orderBy,
  limit,
  setDoc,       // ✅ ADDED (follow system)
  deleteDoc,    // ✅ ADDED (follow system)
  serverTimestamp // ✅ ADDED (follow system)
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ✅ Storage (for profile pictures)
import { getStorage, ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

/* ✅ AUDIORY FIREBASE CONFIG */
const firebaseConfig = {
  apiKey: "AIzaSyCmsFTjDryYOTddWfScTKsnrs0cWAHnpdc",
  authDomain: "audiory-beat-store.firebaseapp.com",
  projectId: "audiory-beat-store",
  storageBucket: "audiory-beat-store.firebasestorage.app",
  messagingSenderId: "688272560511",
  appId: "1:688272560511:web:9031e6ce215d6f08764a4a",
  measurementId: "G-GLYGWQGS26"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Expose helpers
window.FB = window.FB || {};
window.FB.app = app;
window.FB.auth = auth;
window.FB.db = db;
window.FB.storage = storage;

window.FB.collection = collection;
window.FB.getDocs = getDocs;
window.FB.getDoc = getDoc;
window.FB.addDoc = addDoc;
window.FB.doc = doc;
window.FB.query = query;
window.FB.where = where;
window.FB.orderBy = orderBy;
window.FB.limit = limit;

// ✅ FAST token getter
window.FB.getIdToken = async () => {
  const user = auth.currentUser;
  if (!user) return null;
  return await user.getIdToken();
};

/* =========================
   ✅ NAV AUTH UI (GLOBAL)
   Hides "Sign in" when logged in.
   Optional: hides "Start Selling" when logged in (set to false if you want it visible).
   Works if your HTML uses these IDs:
   Desktop: #navSignIn, #navStartSelling
   Mobile:  #mNavSignIn, #mNavStartSelling
========================= */
window.FB.NAV_HIDE_START_SELLING_WHEN_LOGGED_IN = true;

window.FB.updateNavAuthUI = function updateNavAuthUI(user) {
  const isIn = !!user;

  const navSignIn = document.getElementById("navSignIn");
  const navStart = document.getElementById("navStartSelling");
  const mSignIn = document.getElementById("mNavSignIn");
  const mStart = document.getElementById("mNavStartSelling");

  if (navSignIn) navSignIn.style.display = isIn ? "none" : "";
  if (mSignIn) mSignIn.style.display = isIn ? "none" : "";

  const hideStart = window.FB.NAV_HIDE_START_SELLING_WHEN_LOGGED_IN === true;
  if (hideStart) {
    if (navStart) navStart.style.display = isIn ? "none" : "";
    if (mStart) mStart.style.display = isIn ? "none" : "";
  } else {
    if (navStart) navStart.style.display = "";
    if (mStart) mStart.style.display = "";
  }
};

// Optional: keep current user reference + update nav immediately
window.FB.user = null;
onAuthStateChanged(auth, (u) => {
  window.FB.user = u || null;

  // ✅ global nav fix
  try {
    window.FB.updateNavAuthUI(window.FB.user);
  } catch {}

  // Optional event if pages want to react to auth changes
  try {
    window.dispatchEvent(new CustomEvent("firebase-auth-changed", { detail: { user: window.FB.user } }));
  } catch {}
});

/* =========================
   ✅ PROFILE PHOTO RESOLVER
   Fixes: Android shows but iPhone/PC doesn't (blob: URL saved)
========================= */
const __photoResolveCache = new Map();

function looksLikeHttpUrl(u) {
  return /^https?:\/\//i.test(String(u || ""));
}

function looksLikeGsUrl(u) {
  return /^gs:\/\//i.test(String(u || ""));
}

// If you stored a storage path like "profilePics/UID.jpg"
function looksLikeStoragePath(u) {
  const s = String(u || "");
  if (!s) return false;
  if (looksLikeHttpUrl(s) || looksLikeGsUrl(s)) return false;
  // basic heuristic: has a folder + file-ish
  return s.includes("/") && !s.startsWith("blob:");
}

window.FB.resolvePhotoURL = async function resolvePhotoURL(url, producerId = "") {
  const raw = String(url || "").trim();
  if (!raw) return "";

  // ❌ blob urls work only on the same device/session
  if (raw.startsWith("blob:")) return "";

  // ✅ normal https link
  if (looksLikeHttpUrl(raw)) return raw;

  const cacheKey = `photo:${producerId}:${raw}`;
  if (__photoResolveCache.has(cacheKey)) return __photoResolveCache.get(cacheKey);

  try {
    // ✅ gs://... link -> download URL
    if (looksLikeGsUrl(raw)) {
      const dl = await getDownloadURL(ref(storage, raw));
      __photoResolveCache.set(cacheKey, dl);
      return dl;
    }

    // ✅ storage path like "profilePics/<uid>.jpg" OR "users/<uid>/avatar.jpg"
    if (looksLikeStoragePath(raw)) {
      const dl = await getDownloadURL(ref(storage, raw));
      __photoResolveCache.set(cacheKey, dl);
      return dl;
    }

    return "";
  } catch (e) {
    // If the file doesn't exist or rules block it, fallback to initials
    return "";
  }
};

window.FB.getProducerProfile = async function getProducerProfile(producerId) {
  if (!producerId) throw new Error("Missing producerId");
  const snap = await getDoc(doc(db, "users", String(producerId)));
  if (!snap.exists()) return null;

  const prof = snap.data() || {};
  const raw = prof.photoURL || prof.photoUrl || prof.photo || "";
  const resolved = await window.FB.resolvePhotoURL(raw, producerId);

  return {
    id: producerId,
    ...prof,
    // Always prefer resolved HTTPS url
    photoURL: resolved || ""
  };
};

// --------------------
// ✅ FAST CACHE LAYER (BEATS)
// --------------------
const CACHE_KEY = "audiory_cached_beats_v3";
const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes
let memCache = null;
let memCacheAt = 0;
let inflight = null;

function now() {
  return Date.now();
}

function readLocalCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.beats) || !parsed.ts) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalCache(beats) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: now(), beats }));
  } catch {}
}

window.FB.clearBeatsCache = function () {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
  memCache = null;
  memCacheAt = 0;
};

/* =========================
   ✅ PRICE PICKER (AUDIORY)
========================= */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isTruthyFree(data) {
  return data?.freeDownload === true || data?.isFree === true || data?.free === true;
}

function pickDisplayPrice(data) {
  if (isTruthyFree(data)) return 0;

  const lic = data?.licenses || {};
  if (lic?.basic?.enabled === true) {
    const p = toNum(lic.basic.price);
    return p !== null ? p : 0;
  }
  if (lic?.premium?.enabled === true) {
    const p = toNum(lic.premium.price);
    return p !== null ? p : 0;
  }
  if (lic?.exclusive?.enabled === true) {
    const p = toNum(lic.exclusive.price);
    return p !== null ? p : 0;
  }

  const fallback = toNum(data?.price);
  return fallback !== null ? fallback : 0;
}

function normalizeBeat(docId, data) {
  const artwork =
    data.artwork ||
    data.beatArtwork ||
    data.coverurl ||
    data.coverUrl ||
    data.coverURL ||
    "";

  const audio =
    data.previewAudio ||
    data.previewAudioUrl ||
    data.audiourl ||
    data.audioUrl ||
    data.audioURL ||
    data.fullAudio ||
    "";

  const producerId = data.producerId || data.producerid || data.producerID || "";

  const producerName =
    data.producerName || data.producer || data.producerDisplayName || "";

  const genre = (data.genre || data.Genre || "").toString().trim();

  const createdAt = data.createdAt || data.createdat || data.timestamp || 0;

  const likes = Number(data.likes ?? data.likeCount ?? 0) || 0;
  const sales = Number(data.sales ?? data.sold ?? data.salesCount ?? 0) || 0;

  const licenses = data.licenses || null;

  const displayPrice = pickDisplayPrice(data);
  const isFree = displayPrice === 0;

  return {
    id: docId,
    title: data.title || data.beatTitle || data.Title || "Untitled Beat",
    artwork,
    audio,
    genre,
    producerId,
    producerName,
    published: data.published === true,
    createdAt,
    desc: data.desc || data.description || "",

    price: displayPrice,
    isFree,

    likes,
    sales,
    licenses,

    freeDownload: data.freeDownload === true,
    downloadUrl: data.downloadUrl || data.freeDownloadUrl || ""
  };
}

// --------------------
// ✅ FAST FETCH (dedupe + fallback)
// --------------------
async function fetchBeats({ max = 60, force = false } = {}) {
  if (!force && memCache && now() - memCacheAt < CACHE_TTL_MS) {
    return memCache;
  }

  const local = readLocalCache();
  const localFresh = local && now() - local.ts < CACHE_TTL_MS;

  if (!force && inflight) {
    if (localFresh) return local.beats;
    return await inflight;
  }

  inflight = (async () => {
    try {
      const beatsRef = collection(db, "beats");
      const qy = query(beatsRef, orderBy("createdAt", "desc"), limit(max));
      const snap = await getDocs(qy);

      const beats = [];
      snap.forEach((d) => {
        const beat = normalizeBeat(d.id, d.data());
        if (beat.published) beats.push(beat);
      });

      memCache = beats;
      memCacheAt = now();
      writeLocalCache(beats);

      return beats;
    } catch (err) {
      console.error("[FB.fetchBeats] network error:", err);

      if (local?.beats?.length) {
        memCache = local.beats;
        memCacheAt = now();
        return local.beats;
      }
      throw err;
    } finally {
      inflight = null;
    }
  })();

  if (!force && localFresh) return local.beats;
  return await inflight;
}

window.FB.fetchBeats = fetchBeats;

/* =========================
   ✅ FREE DOWNLOAD LOG
========================= */
window.FB.logFreeDownload = async function ({
  beatId,
  beatTitle,
  producerId,
  producerName,
  fullName,
  email,
  createdAt
} = {}) {
  if (!beatId) throw new Error("Missing beatId");
  if (!email) throw new Error("Missing email");

  const payload = {
    beatId,
    beatTitle: beatTitle || "",
    producerId: producerId || "",
    producerName: producerName || "",
    fullName: (fullName || "").trim(),
    email: (email || "").trim().toLowerCase(),
    createdAt: Number(createdAt || Date.now())
  };

  await addDoc(collection(db, "freeDownloads"), payload);
  return true;
};

/* =========================
   ✅ PRODUCER FOLLOW SYSTEM (ADDED)
   Collections:
   - producerFollows/{producerId}/followers/{uid}
   Counter:
   - users/{producerId}.followersCount  (optional; if not set, UI can count docs)
========================= */

// ✅ check if current user follows a producer
window.FB.isFollowingProducer = async function isFollowingProducer(producerId) {
  const user = auth.currentUser;
  if (!user) return false;

  const refDoc = doc(db, "producerFollows", String(producerId), "followers", user.uid);
  const snap = await getDoc(refDoc);
  return snap.exists();
};

// ✅ follow
window.FB.followProducer = async function followProducer(producerId) {
  const user = auth.currentUser;
  if (!user) throw new Error("NOT_AUTHENTICATED");

  const refDoc = doc(db, "producerFollows", String(producerId), "followers", user.uid);
  await setDoc(refDoc, { uid: user.uid, createdAt: serverTimestamp() }, { merge: true });
  return true;
};

// ✅ unfollow
window.FB.unfollowProducer = async function unfollowProducer(producerId) {
  const user = auth.currentUser;
  if (!user) throw new Error("NOT_AUTHENTICATED");

  const refDoc = doc(db, "producerFollows", String(producerId), "followers", user.uid);
  await deleteDoc(refDoc);
  return true;
};

// ✅ follower count (FAST if users/{producerId}.followersCount exists; fallback counts docs)
window.FB.getProducerFollowerCount = async function getProducerFollowerCount(producerId, { fast = true } = {}) {
  const pid = String(producerId || "").trim();
  if (!pid) return 0;

  // ✅ FAST path: users/{producerId}.followersCount
  if (fast) {
    try {
      const snap = await getDoc(doc(db, "users", pid));
      if (snap.exists()) {
        const n = Number(snap.data()?.followersCount ?? 0);
        if (Number.isFinite(n)) return n;
      }
    } catch (e) {
      // ignore, fallback below
    }
  }

  // ✅ fallback: count follower docs (ok for small counts)
  try {
    const col = collection(db, "producerFollows", pid, "followers");
    const snap = await getDocs(query(col, limit(5000)));
    return snap.size || 0;
  } catch {
    return 0;
  }
};

// ✅ Tell pages firebase is ready
window.dispatchEvent(new Event("firebase-ready"));

import { signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

function el(id){ return document.getElementById(id); }

function setNavLoggedIn(user){
  // hide logged-out links
  el("navSignIn")?.classList.add("hidden");
  el("navStartSelling")?.classList.add("hidden");
  el("mNavSignIn")?.classList.add("hidden");
  el("mNavStartSelling")?.classList.add("hidden");

  // show dashboard + signout
  el("navDashboard")?.classList.remove("hidden");
  el("mNavDashboard")?.classList.remove("hidden");
  el("navSignOut")?.classList.remove("hidden");
  el("mNavSignOut")?.classList.remove("hidden");

  // Optional: route admins / producers differently later
}

function setNavLoggedOut(){
  el("navSignIn")?.classList.remove("hidden");
  el("navStartSelling")?.classList.remove("hidden");
  el("mNavSignIn")?.classList.remove("hidden");
  el("mNavStartSelling")?.classList.remove("hidden");

  el("navDashboard")?.classList.add("hidden");
  el("mNavDashboard")?.classList.add("hidden");
  el("navSignOut")?.classList.add("hidden");
  el("mNavSignOut")?.classList.add("hidden");
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    setNavLoggedIn(user);
  } else {
    setNavLoggedOut();
  }
});

// Sign out buttons
["navSignOut","mNavSignOut"].forEach(id=>{
  el(id)?.addEventListener("click", async ()=>{
    await signOut(auth);
    location.href = "/index.html";
  });
});
