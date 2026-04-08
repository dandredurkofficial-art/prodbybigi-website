// /js/firebase.js — AUDIORY (FAST LOAD + CACHE + INBOX + CAMPAIGNS + ANALYTICS + FOLLOW + NAV)
// Firebase v10.12.0 (ESM)
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
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
  setDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
  updateDoc,
  increment,
  getCountFromServer // ✅ ADDED (for Advanced Analytics fast counts)
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
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

// Expose helpers (single source of truth)
window.FB = window.FB || {};
Object.assign(window.FB, {
  app,
  auth,
  db,
  storage,

  // core Firestore helpers (used by your pages)
  collection,
  getDocs,
  getDoc,
  addDoc,
  doc,
  query,
  where,
  orderBy,
  limit,

  // extra
  setDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
  updateDoc,
  increment,

  // ✅ analytics agg helper
  getCountFromServer
});

// ✅ ALSO expose globals (compat with your dashboard scripts that call window.addDoc/window.collection etc.)
window.app = app;
window.auth = auth;
window.db = db;
window.storage = storage;

window.collection = collection;
window.getDocs = getDocs;
window.getDoc = getDoc;
window.addDoc = addDoc;
window.doc = doc;
window.query = query;
window.where = where;
window.orderBy = orderBy;
window.limit = limit;
window.setDoc = setDoc;
window.deleteDoc = deleteDoc;
window.serverTimestamp = serverTimestamp;
window.onSnapshot = onSnapshot;
window.updateDoc = updateDoc;
window.increment = increment;

// ✅ Advanced analytics fast counts helper
window.getCountFromServer = getCountFromServer;

// ✅ FAST token getter
window.FB.getIdToken = async () => {
  const user = auth.currentUser;
  if (!user) return null;
  return await user.getIdToken();
};

/* =========================================================
   ✅ NAV AUTH UI (GLOBAL)
========================================================= */
function el(id) { return document.getElementById(id); }

function setNavLoggedIn() {
  el("navSignIn")?.classList.add("hidden");
  el("navStartSelling")?.classList.add("hidden");
  el("mNavSignIn")?.classList.add("hidden");
  el("mNavStartSelling")?.classList.add("hidden");

  el("navDashboard")?.classList.remove("hidden");
  el("mNavDashboard")?.classList.remove("hidden");
  el("navSignOut")?.classList.remove("hidden");
  el("mNavSignOut")?.classList.remove("hidden");
}

function setNavLoggedOut() {
  el("navSignIn")?.classList.remove("hidden");
  el("navStartSelling")?.classList.remove("hidden");
  el("mNavSignIn")?.classList.remove("hidden");
  el("mNavStartSelling")?.classList.remove("hidden");

  el("navDashboard")?.classList.add("hidden");
  el("mNavDashboard")?.classList.add("hidden");
  el("navSignOut")?.classList.add("hidden");
  el("mNavSignOut")?.classList.add("hidden");
}

window.FB.user = null;
window.currentUser = null;
window.FB.currentUser = null;
window.FB.authReady = false;

onAuthStateChanged(auth, (u) => {
  window.FB.user = u || null;
  window.currentUser = u || null;
  window.FB.currentUser = u || null;
  window.FB.authReady = true;

  try {
    window.FB.user ? setNavLoggedIn() : setNavLoggedOut();
  } catch {}

  try {
    window.dispatchEvent(
      new CustomEvent("firebase-auth-changed", {
        detail: { user: window.FB.user }
      })
    );
  } catch {}

  try {
    window.dispatchEvent(
      new CustomEvent("firebase-ready", {
        detail: { user: window.FB.user }
      })
    );
  } catch {}
});

// Sign out buttons
["navSignOut", "mNavSignOut"].forEach(id => {
  el(id)?.addEventListener("click", async () => {
    await signOut(auth);
    location.href = "/index.html";
  });
});

/* =========================================================
   ✅ PROFILE PHOTO RESOLVER
========================================================= */
const __photoResolveCache = new Map();

function looksLikeHttpUrl(u) { return /^https?:\/\//i.test(String(u || "")); }
function looksLikeGsUrl(u) { return /^gs:\/\//i.test(String(u || "")); }
function looksLikeStoragePath(u) {
  const s = String(u || "");
  if (!s) return false;
  if (looksLikeHttpUrl(s) || looksLikeGsUrl(s)) return false;
  return s.includes("/") && !s.startsWith("blob:");
}

window.FB.resolvePhotoURL = async function resolvePhotoURL(url, producerId = "") {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("blob:")) return "";
  if (looksLikeHttpUrl(raw)) return raw;

  const cacheKey = `photo:${producerId}:${raw}`;
  if (__photoResolveCache.has(cacheKey)) return __photoResolveCache.get(cacheKey);

  try {
    // gs://... or storage path
    const dl = await getDownloadURL(ref(storage, raw));
    __photoResolveCache.set(cacheKey, dl);
    return dl;
  } catch {
    try {
      if (looksLikeStoragePath(raw)) {
        const dl2 = await getDownloadURL(ref(storage, raw));
        __photoResolveCache.set(cacheKey, dl2);
        return dl2;
      }
    } catch {}
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

  return { id: producerId, ...prof, photoURL: resolved || "" };
};

/* =========================================================
   ✅ BEATS CACHE + FETCH
========================================================= */
const CACHE_KEY = "audiory_cached_beats_v3";
const CACHE_TTL_MS = 1000 * 60 * 30;
let memCache = null;
let memCacheAt = 0;
let inflight = null;
const now = () => Date.now();

function readLocalCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.beats) || !parsed.ts) return null;
    return parsed;
  } catch { return null; }
}

function writeLocalCache(beats) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: now(), beats })); } catch {}
}

window.FB.clearBeatsCache = function () {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
  memCache = null;
  memCacheAt = 0;
};

function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function isTruthyFree(data) { return data?.freeDownload === true || data?.isFree === true || data?.free === true; }

function pickDisplayPrice(data) {
  if (isTruthyFree(data)) return 0;
  const lic = data?.licenses || {};
  if (lic?.basic?.enabled === true) return toNum(lic.basic.price) ?? 0;
  if (lic?.premium?.enabled === true) return toNum(lic.premium.price) ?? 0;
  if (lic?.exclusive?.enabled === true) return toNum(lic.exclusive.price) ?? 0;
  return toNum(data?.price) ?? 0;
}

function normalizeBeat(docId, data) {
  const artwork = data.artwork || data.beatArtwork || data.coverurl || data.coverUrl || data.coverURL || "";
  const previewAudio =
    data.previewAudio || data.previewAudioUrl || data.audiourl ||
    data.audioUrl || data.audioURL || data.audio || "";

  const fullAudio = data.fullAudio || data.audio || previewAudio || "";

  const producerId = data.producerId || data.producerid || data.producerID || "";
  const producerName = data.producerName || data.producer || data.producerDisplayName || "";
  const genre = (data.genre || data.Genre || "").toString().trim();
  const createdAt = data.createdAt || data.createdat || data.timestamp || 0;

  const displayPrice = pickDisplayPrice(data);
  const isFree = displayPrice === 0;

  return {
    id: docId,

    title: data.title || data.beatTitle || data.Title || "Untitled Beat",
    artwork,

    // audio
    audio: previewAudio,
    previewAudio,
    fullAudio,

    genre,
    producerId,
    producerName,
    producerPlan: data.producerPlan || "",

    published: data.published === true,
    createdAt,
    updatedAt: data.updatedAt || null,

    // old/basic field
    bpm: data.bpm || null,
    key: data.key || null,
    plays: Number(data.plays ?? 0),
    price: displayPrice,
    isFree,
    likes: Number(data.likes ?? data.likeCount ?? 0) || 0,
    sales: Number(data.sales ?? data.sold ?? data.salesCount ?? 0) || 0,
    licenses: data.licenses || null,
    freeDownload: data.freeDownload === true,
    downloadUrl: data.downloadUrl || data.freeDownloadUrl || "",
    featured: data.featured === true,
    featuredUntil: data.featuredUntil || null,

    // ✅ NEW METADATA FIELDS
    typeBeat: String(data.typeBeat || "").trim(),
    tags: Array.isArray(data.tags) ? data.tags : [],
    mood: Array.isArray(data.mood) ? data.mood : [],
    beatDescription: String(data.beatDescription || "").trim(),
    searchableText: String(data.searchableText || "").trim()
  };
}

async function fetchBeats({ max = 60, force = false } = {}) {
  if (!force && memCache && now() - memCacheAt < CACHE_TTL_MS) return memCache;

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

window.FB.fetchBeatById = async function fetchBeatById(beatId){
  const id = String(beatId || "").trim();
  if (!id) return null;

  const snap = await getDoc(doc(db, "beats", id));
  if (!snap.exists()) return null;

  return normalizeBeat(snap.id, snap.data());
};

/* =========================================================
   ✅ FETCH PRODUCER BEATS (FAST RELATED BEATS)
========================================================= */

async function fetchProducerBeats(producerId, maxItems = 6){
  if(!producerId) return [];

  const qy = query(
    collection(db, "beats"),
    where("producerId", "==", producerId),
    limit(maxItems)
  );

  const snap = await getDocs(qy);

  const arr = [];
  snap.forEach((d) => {
    const beat = normalizeBeat(d.id, d.data());
    if (beat.published) arr.push(beat);
  });

  return arr;
}

window.FB.fetchProducerBeats = fetchProducerBeats;

/* =========================================================
   ✅ FOLLOW SYSTEM
   producerFollows/{producerId}/followers/{uid}
========================================================= */
function _requireUser() {
  const u = auth.currentUser;
  if (!u) throw new Error("NOT_AUTHENTICATED");
  return u;
}

window.FB.isFollowingProducer = async function (producerId) {
  const user = auth.currentUser;
  if (!user) return false;
  const refDoc = doc(db, "producerFollows", String(producerId), "followers", user.uid);
  const snap = await getDoc(refDoc);
  return snap.exists();
};

window.FB.followProducer = async function (producerId) {
  const user = _requireUser();
  const refDoc = doc(db, "producerFollows", String(producerId), "followers", user.uid);
  await setDoc(refDoc, { uid: 
    user.uid, 
    createdAt: serverTimestamp()
  });
  
  return true;
};

window.FB.unfollowProducer = async function (producerId) {
  const user = _requireUser();
  const refDoc = doc(db, "producerFollows", String(producerId), "followers", user.uid);
  await deleteDoc(refDoc);
  return true;
};

window.FB.getProducerFollowerCount = async function (producerId, { fast = true } = {}) {
  const pid = String(producerId || "").trim();
  if (!pid) return 0;

  if (fast) {
    try {
      const snap = await getDoc(doc(db, "users", pid));
      if (snap.exists()) {
        const n = Number(snap.data()?.followersCount ?? 0);
        if (Number.isFinite(n)) return n;
      }
    } catch {}
  }

  try {
    const colRef = collection(db, "producerFollows", pid, "followers");
    const snap = await getDocs(query(colRef, limit(5000)));
    return snap.size || 0;
  } catch {
    return 0;
  }
};

/* =========================================================
   ✅ INBOX (THREADS + MESSAGES)
   threads/{threadId}
   threads/{threadId}/messages/{messageId}
========================================================= */
function _sortedPair(a, b) {
  const x = String(a || "").trim();
  const y = String(b || "").trim();
  return [x, y].sort();
}

function _threadIdFor(uidA, uidB) {
  const [x, y] = _sortedPair(uidA, uidB);
  return `${x}__${y}`;
}

window.FB.getThreadId = function (otherUid) {
  const me = _requireUser().uid;
  return _threadIdFor(me, otherUid);
};

window.FB.ensureThread = async function ({ otherUid, otherDisplayName = "" } = {}) {
  const me = _requireUser();
  const other = String(otherUid || "").trim();

  if (!other) throw new Error("Missing otherUid");
  if (other === me.uid) throw new Error("Cannot DM yourself");

  const threadId = _threadIdFor(me.uid, other);
  const tref = doc(db, "threads", threadId);
  const snap = await getDoc(tref);

  const correctMembers = _sortedPair(me.uid, other);
  const myName = me.displayName || me.email || me.uid;

  if (!snap.exists()) {
    await setDoc(tref, {
      threadId,
      members: correctMembers,
      createdAt: serverTimestamp(),
      lastMessageText: "",
      lastMessageAt: serverTimestamp(),
      lastSenderId: "",
      unreadMap: {
        [me.uid]: 0,
        [other]: 0
      },
      memberNames: {
        [me.uid]: myName,
        [other]: otherDisplayName || other
      }
    });
    return threadId;
  }

  const data = snap.data() || {};
  const members = Array.isArray(data.members) ? data.members.map(v => String(v || "").trim()).sort() : [];
  const shouldRepair =
    members.length !== 2 ||
    members[0] !== correctMembers[0] ||
    members[1] !== correctMembers[1];

  if (shouldRepair) {
    await updateDoc(tref, {
      members: correctMembers,
      [`memberNames.${me.uid}`]: myName,
      [`memberNames.${other}`]: otherDisplayName || data?.memberNames?.[other] || other,
      [`unreadMap.${me.uid}`]: Number(data?.unreadMap?.[me.uid] || 0),
      [`unreadMap.${other}`]: Number(data?.unreadMap?.[other] || 0)
    });
  } else {
    await updateDoc(tref, {
      [`memberNames.${me.uid}`]: myName,
      [`memberNames.${other}`]: otherDisplayName || data?.memberNames?.[other] || other
    });
  }

  return threadId;
};

window.FB.sendMessage = async function ({ otherUid, text, otherDisplayName = "" } = {}) {
  const me = _requireUser();
  const other = String(otherUid || "").trim();
  const clean = String(text || "").trim();

  if (!other) throw new Error("Missing otherUid");
  if (!clean) throw new Error("Empty message");

  const threadId = await window.FB.ensureThread({ otherUid: other, otherDisplayName });

  await addDoc(collection(db, "threads", threadId, "messages"), {
    threadId,
    senderId: me.uid,
    text: clean,
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, "threads", threadId), {
    lastMessageText: clean.slice(0, 300),
    lastMessageAt: serverTimestamp(),
    lastSenderId: me.uid,
    [`unreadMap.${other}`]: increment(1),
    [`memberNames.${me.uid}`]: me.displayName || me.email || me.uid,
    [`memberNames.${other}`]: otherDisplayName || other
  });

  return threadId;
};

window.FB.markThreadRead = async function (threadId) {
  const me = _requireUser();
  if (!threadId) throw new Error("Missing threadId");
  await updateDoc(doc(db, "threads", threadId), {
    [`unreadMap.${me.uid}`]: 0
  });
  return true;
};

window.FB.getMyThreads = async function ({ max = 50 } = {}) {
  const me = _requireUser();
  const qy = query(
    collection(db, "threads"),
    where("members", "array-contains", me.uid),
    orderBy("lastMessageAt", "desc"),
    limit(max)
  );
  const snap = await getDocs(qy);
  const out = [];
  snap.forEach(d => out.push({ id: d.id, ...d.data() }));
  return out;
};

window.FB.listenThreadMessages = function (threadId, { max = 200, onData } = {}) {
  _requireUser();
  if (!threadId) throw new Error("Missing threadId");
  if (typeof onData !== "function") throw new Error("onData callback required");

  const qy = query(
    collection(db, "threads", threadId, "messages"),
    orderBy("createdAt", "asc"),
    limit(max)
  );

  return onSnapshot(qy, (snap) => {
    const msgs = [];
    snap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
    onData(msgs);
  });
};

/* =========================================================
   ✅ CAMPAIGNS
   campaigns/{campaignId}
========================================================= */
window.FB.createCampaign = async function ({
  title = "",
  message = "",
  audience = "followers", // followers | buyers | custom
  status = "draft",       // draft | scheduled | sent
  scheduledAt = null      // ms timestamp or null
} = {}) {
  const me = _requireUser();

  const payload = {
    ownerId: me.uid,
    title: String(title || "").trim(),
    message: String(message || "").trim(),
    audience: String(audience || "followers"),
    status: String(status || "draft"),
    scheduledAt: scheduledAt ? Number(scheduledAt) : null,
    sentAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    stats: { sent: 0, opened: 0, clicked: 0 }
  };

  if (!payload.title) throw new Error("Missing campaign title");
  if (!payload.message) throw new Error("Missing campaign message");

  const refDoc = await addDoc(collection(db, "campaigns"), payload);
  return { id: refDoc.id, ...payload };
};

window.FB.listMyCampaigns = async function ({ max = 50 } = {}) {
  const me = _requireUser();
  const qy = query(
    collection(db, "campaigns"),
    where("ownerId", "==", me.uid),
    orderBy("createdAt", "desc"),
    limit(max)
  );
  const snap = await getDocs(qy);
  const out = [];
  snap.forEach(d => out.push({ id: d.id, ...d.data() }));
  return out;
};

window.FB.updateCampaign = async function (campaignId, patch = {}) {
  const me = _requireUser();
  if (!campaignId) throw new Error("Missing campaignId");

  const refDoc = doc(db, "campaigns", String(campaignId));
  const snap = await getDoc(refDoc);
  if (!snap.exists()) throw new Error("Campaign not found");
  if (snap.data()?.ownerId !== me.uid) throw new Error("NOT_ALLOWED");

  await updateDoc(refDoc, { ...patch, updatedAt: serverTimestamp() });
  return true;
};

window.FB.deleteCampaign = async function (campaignId) {
  const me = _requireUser();
  if (!campaignId) throw new Error("Missing campaignId");

  const refDoc = doc(db, "campaigns", String(campaignId));
  const snap = await getDoc(refDoc);
  if (!snap.exists()) return true;
  if (snap.data()?.ownerId !== me.uid) throw new Error("NOT_ALLOWED");

  await deleteDoc(refDoc);
  return true;
};

/* =========================================================
   ✅ REAL ANALYTICS EVENTS
   analyticsEvents/{eventId}
========================================================= */
function _safeStr(v) { return v === null || v === undefined ? "" : String(v); }

window.FB.trackEvent = async function ({
  type,             // page_view | beat_play | add_to_cart | checkout | purchase | follow | message_send ...
  beatId = "",
  producerId = "",
  threadId = "",
  campaignId = "",
  path = "",
  meta = {}
} = {}) {
  const u = auth.currentUser || null;

  const payload = {
    type: _safeStr(type).trim(),
    uid: u ? u.uid : null,
    beatId: _safeStr(beatId),
    producerId: _safeStr(producerId),
    threadId: _safeStr(threadId),
    campaignId: _safeStr(campaignId),
    path: _safeStr(path || (location.pathname + location.search)),
    referrer: _safeStr(document.referrer || ""),
    ua: _safeStr(navigator.userAgent || ""),
    ts: Date.now(),
    meta: meta && typeof meta === "object" ? meta : {}
  };

  if (!payload.type) throw new Error("Missing analytics event type");
  await addDoc(collection(db, "analyticsEvents"), payload);
  return true;
};

/* =========================================================
   ✅ NEW: SIMPLE PLAY/VIEW LOGGER (for Advanced Analytics page)
   Uses: { producerId, type:"view"|"play", beatId, actorUid, createdAt }
   ✅ Uses serverTimestamp() so Firestore writes are consistent
========================================================= */
window.FB.logAnalyticsEvent = async function ({ producerId, type, beatId = null } = {}) {

  try{

    if(!producerId || !type) return false;

    const u = auth.currentUser || null;

    await addDoc(collection(db,"analyticsEvents"),{

      producerId: String(producerId),

      type: String(type), // view | play

      beatId: beatId ? String(beatId) : null,

      actorUid: u ? u.uid : null, // null if guest visitor

      createdAt: Date.now()

    });

    return true;

  }catch(e){

    console.log("analytics event failed", e);

    return false;

  }

};

// ✅ convenience global alias (so pages can call logAnalyticsEvent directly)
window.logAnalyticsEvent = window.FB.logAnalyticsEvent;

// ✅ small client-side de-dupe store (optional)
window.__ANA_SENT__ = window.__ANA_SENT__ || { play: {}, view: {} };

// Summary for a producer (last N days)
window.FB.getAnalyticsSummary = async function ({
  producerId = "",
  days = 7,
  max = 500
} = {}) {
  const pid = String(producerId || "").trim();
  const since = Date.now() - (Number(days || 7) * 86400000);

  const qy = query(
    collection(db, "analyticsEvents"),
    where("ts", ">=", since),
    orderBy("ts", "desc"),
    limit(max)
  );

  const snap = await getDocs(qy);

  const totals = {
    events: 0,
    page_view: 0,
    beat_play: 0,
    add_to_cart: 0,
    checkout: 0,
    purchase: 0,
    follow: 0,
    message_send: 0
  };

  snap.forEach(d => {
    const e = d.data() || {};
    if (pid && String(e.producerId || "") !== pid) return;
    totals.events += 1;
    const t = String(e.type || "");
    if (t in totals) totals[t] += 1;
  });

  return totals;
};

/* =========================================================
   ✅ COLLAB MARKETPLACE HELPERS
========================================================= */

// Create collab request
window.FB.createCollabRequest = async function ({
  title = "",
  description = "",
  genre = "",
  budget = 0,
  mood = [],
  deadline = null
} = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("NOT_AUTHENTICATED");

  const cleanTitle = String(title || "").trim();
  const cleanDescription = String(description || "").trim();
  const cleanGenre = String(genre || "").trim();
  const cleanMood = Array.isArray(mood)
    ? mood.map(x => String(x || "").trim()).filter(Boolean)
    : [];

  if (!cleanTitle) throw new Error("Missing title");
  if (!cleanDescription) throw new Error("Missing description");

  return await addDoc(collection(db, "collabRequests"), {
    title: cleanTitle,
    description: cleanDescription,
    genre: cleanGenre,
    budget: Number(budget || 0),
    mood: cleanMood,
    deadline: deadline ? Number(deadline) : null,
    createdBy: user.uid,
    createdAt: Date.now(),
    status: "open"
  });
};

// Read collab requests
window.FB.fetchCollabRequests = async function () {
  const snap = await getDocs(collection(db, "collabRequests"));
  const arr = [];
  snap.forEach(d => {
    arr.push({
      id: d.id,
      ...d.data()
    });
  });

  arr.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return arr;
};

// Fetch current producer beats
window.FB.fetchMyProducerBeats = async function () {
  const user = auth.currentUser;
  if (!user) throw new Error("NOT_AUTHENTICATED");

  const qy = query(
    collection(db, "beats"),
    where("producerId", "==", user.uid)
  );

  const snap = await getDocs(qy);
  const arr = [];
  snap.forEach(d => {
    arr.push({
      id: d.id,
      ...d.data()
    });
  });

  arr.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return arr;
};

// Submit to request
window.FB.createCollabSubmission = async function ({
  requestId = "",
  beatId = "",
  beatTitle = "",
  beatGenre = "",
  message = ""
} = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("NOT_AUTHENTICATED");

  const cleanRequestId = String(requestId || "").trim();
  const cleanBeatId = String(beatId || "").trim();
  const cleanBeatTitle = String(beatTitle || "").trim();
  const cleanBeatGenre = String(beatGenre || "").trim();
  const cleanMessage = String(message || "").trim();

  if (!cleanRequestId) throw new Error("Missing requestId");
  if (!cleanMessage) throw new Error("Missing message");

  return await addDoc(collection(db, "collabSubmissions"), {
    requestId: cleanRequestId,
    producerId: user.uid,
    producerName: user.displayName || user.email || "Producer",
    beatId: cleanBeatId,
    beatTitle: cleanBeatTitle,
    beatGenre: cleanBeatGenre,
    message: cleanMessage,
    createdAt: Date.now(),
    status: "pending"
  });
};

// Requests created by current user
window.FB.fetchMyCollabRequests = async function () {
  const user = auth.currentUser;
  if (!user) throw new Error("NOT_AUTHENTICATED");

  const qy = query(
    collection(db, "collabRequests"),
    where("createdBy", "==", user.uid)
  );

  const snap = await getDocs(qy);
  const arr = [];
  snap.forEach(d => {
    arr.push({
      id: d.id,
      ...d.data()
    });
  });

  arr.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return arr;
};

// Submissions for one request
window.FB.fetchSubmissionsForRequest = async function (requestId) {
  const user = auth.currentUser;
  if (!user) throw new Error("NOT_AUTHENTICATED");
  if (!requestId) throw new Error("Missing requestId");

  const qy = query(
    collection(db, "collabSubmissions"),
    where("requestId", "==", String(requestId))
  );

  const snap = await getDocs(qy);
  const arr = [];
  snap.forEach(d => {
    arr.push({
      id: d.id,
      ...d.data()
    });
  });

  arr.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return arr;
};
