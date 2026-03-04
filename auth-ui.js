// /auth-ui.js (FULL UPDATED + USER HANDLES) ✅

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

/* =========================
   APP DOMAIN
========================= */

const APP_URL = "https://audiory.site";

/* =========================
   HELPERS
========================= */

function $(id){ return document.getElementById(id); }
function statusEl(){ return $("status"); }
function setStatus(msg){ if(statusEl()) statusEl().textContent = msg || ""; }

function isAuthPage(){
  const p = location.pathname || "/";
  return (
    p.startsWith("/login") ||
    p.startsWith("/register") ||
    p.startsWith("/reset")
  );
}

function getRoleSelected(){
  const r = document.querySelector("input[name='role']:checked");
  return r ? String(r.value) : "";
}

function getReturnUrl(){
  try{
    const u = new URL(location.href);
    const r = (u.searchParams.get("return") || "").trim();
    if(r.startsWith("/")) return r;
  }catch{}
  return "";
}

function goAfterAuth(role){
  const ret = getReturnUrl();
  if(ret){
    location.href = ret;
    return;
  }
  redirectByRole(role);
}

function getAuthOrThrow(){
  const auth = window.FB?.auth;
  if(!auth) throw new Error("Firebase auth not ready");
  return auth;
}

function getDbOrThrow(){
  const db = window.FB?.db;
  if(!db) throw new Error("Firestore not ready");
  return db;
}

/* =========================
   HANDLE GENERATOR
========================= */

async function generateHandle(email){

  const db = getDbOrThrow();

  const base = email.split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g,"");

  let handle = base;
  let i = 0;

  while(true){

    const ref = doc(db,"handles",handle);
    const snap = await getDoc(ref);

    if(!snap.exists()){
      return handle;
    }

    i++;
    handle = base + i;

  }

}

async function reserveHandle(uid,email){

  const db = getDbOrThrow();

  const handle = await generateHandle(email);

  await setDoc(doc(db,"handles",handle),{
    uid
  });

  return handle;

}

/* =========================
   REGISTER
========================= */

window.registerUser = async function registerUser(){

  const auth = getAuthOrThrow();
  const db = getDbOrThrow();

  const email = String($("email")?.value || "").trim();
  const password = String($("password")?.value || "");
  const role = getRoleSelected();

  if(!email || !password) return alert("Enter email and password");
  if(!role) return alert("Please select a role");

  try{

    setStatus("Creating account...");

    let user;

    if(auth.currentUser && auth.currentUser.email === email){
      user = auth.currentUser;
    }else{
      const cred = await createUserWithEmailAndPassword(auth,email,password);
      user = cred.user;
    }

    const uid = user.uid;

    const handle = await reserveHandle(uid,email);

    try{
      await updateProfile(user,{
        displayName: role === "producer" ? "Producer" : "Buyer"
      });
    }catch{}

    await setDoc(doc(db,"users",uid),{
      email: email.toLowerCase(),
      role,
      handle,
      createdAt: serverTimestamp(),
      displayName: role === "producer" ? "Producer" : "Buyer"
    },{merge:true});

    if(role === "producer"){
      await setDoc(doc(db,"producers",uid),{
        email: email.toLowerCase(),
        beatsCount: 0,
        followers: 0,
        createdAt: serverTimestamp()
      },{merge:true});
    }

    if(role === "buyer"){
      await setDoc(doc(db,"buyers",uid),{
        email: email.toLowerCase(),
        purchases: 0,
        createdAt: serverTimestamp()
      },{merge:true});
    }

    setStatus("");
    goAfterAuth(role);

  }catch(err){
    console.error(err);
    setStatus("");
    alert(err?.message || String(err));
  }

};

/* =========================
   LOGIN
========================= */

window.loginUser = async function loginUser(){

  const auth = getAuthOrThrow();

  const email = String($("email")?.value || "").trim();
  const password = String($("password")?.value || "");

  if(!email || !password) return alert("Enter email and password");

  try{

    setStatus("Signing in...");
    await signInWithEmailAndPassword(auth,email,password);

  }catch(err){

    console.error(err);
    setStatus("");
    alert(err?.message || String(err));

  }

};

/* =========================
   RESET PASSWORD
========================= */

window.resetPassword = async function resetPassword(){

  const auth = getAuthOrThrow();

  const email = String($("email")?.value || "").trim();
  if(!email) return alert("Enter your email");

  try{

    setStatus("Sending reset email...");

    await sendPasswordResetEmail(auth,email,{
      url:`${APP_URL}/login/`,
      handleCodeInApp:false
    });

    setStatus("✅ Reset email sent");

  }catch(err){

    console.error(err);
    setStatus("");
    alert(err?.message || String(err));

  }

};

/* =========================
   GOOGLE LOGIN
========================= */

const googleProvider = new GoogleAuthProvider();

async function googleSignInSmart(auth){

  try{
    const res = await signInWithPopup(auth,googleProvider);
    return res;
  }catch(e){

    const code = e?.code || "";

    const popupRelated =
      code.includes("popup") ||
      code.includes("blocked") ||
      code.includes("cancelled") ||
      code.includes("closed-by-user") ||
      /iPhone|Android/i.test(navigator.userAgent);

    if(popupRelated){
      await signInWithRedirect(auth,googleProvider);
      return null;
    }

    throw e;

  }

}

/* =========================
   GOOGLE LOGIN BUTTON
========================= */

window.googleLogin = async function googleLogin(){

  const auth = getAuthOrThrow();
  const db = getDbOrThrow();

  try{

    setStatus("Opening Google...");

    const res = await googleSignInSmart(auth);
    if(!res?.user) return;

    await ensureUserProfile(res.user,{roleHint:""});

    const snap = await getDoc(doc(db,"users",res.user.uid));
    const role = snap.exists() ? (snap.data()?.role || "") : "";

    setStatus("");

    if(!role){
      location.href="/register/";
      return;
    }

    goAfterAuth(role);

  }catch(err){

    console.error(err);
    setStatus("");
    alert("Google login failed: "+(err?.message || String(err)));

  }

};

/* =========================
   GOOGLE REGISTER
========================= */

window.googleRegister = async function googleRegister(){

  const auth = getAuthOrThrow();
  const db = getDbOrThrow();

  const role = getRoleSelected();
  if(!role) return alert("Select a role first");

  localStorage.setItem("pendingRole",role);

  try{

    setStatus("Opening Google...");

    const res = await googleSignInSmart(auth);
    if(!res?.user) return;

    await ensureUserProfile(res.user,{roleHint:role});

    const snap = await getDoc(doc(db,"users",res.user.uid));
    const finalRole = snap.exists() ? (snap.data()?.role || role) : role;

    setStatus("");
    goAfterAuth(finalRole);

  }catch(err){

    console.error(err);
    setStatus("");
    alert("Google signup failed: "+(err?.message || String(err)));

  }

};

/* =========================
   CREATE USER PROFILE
========================= */

async function ensureUserProfile(user,{roleHint=""}={}){

  const db = getDbOrThrow();
  const uref = doc(db,"users",user.uid);
  const snap = await getDoc(uref);

  if(snap.exists()) return;

  const pendingRole = (roleHint || localStorage.getItem("pendingRole") || "").trim();

  if(!pendingRole){

    if(location.pathname.startsWith("/register")){
      return;
    }

    location.href="/register/";
    return;

  }

  localStorage.removeItem("pendingRole");

  const email = (user.email || "").toLowerCase();
  const handle = await reserveHandle(user.uid,email);

  await setDoc(uref,{
    email,
    role: pendingRole,
    handle,
    createdAt: serverTimestamp(),
    displayName: user.displayName || (pendingRole === "producer" ? "Producer" : "Buyer")
  },{merge:true});

}

/* =========================
   AUTH STATE LISTENER
========================= */

onAuthStateChanged(getAuthOrThrow(),async(user)=>{

  const db = window.FB?.db;

  if(localStorage.getItem("justLoggedOut")==="1"){
    if(!user) localStorage.removeItem("justLoggedOut");
    return;
  }

  if(!user) return;
  if(!isAuthPage()) return;

  try{

    await ensureUserProfile(user,{roleHint:localStorage.getItem("pendingRole") || ""});

    const snap = await getDoc(doc(db,"users",user.uid));
    const role = snap.exists() ? (snap.data()?.role || "") : "";

    if(!role){
      if(!location.pathname.startsWith("/register")){
        location.href="/register/";
      }
      return;
    }

    goAfterAuth(role);

  }catch(e){
    console.error(e);
  }

});

/* =========================
   REDIRECT LOGIC
========================= */

function redirectByRole(role){

  const r = String(role || "").toLowerCase();

  if(r==="admin"){
    location.href="/admin-dashboard/";
    return;
  }

  if(r==="producer"){
    location.href="/dashboard/";
    return;
  }

  if(r==="buyer"){
    location.href="/buyer-dashboard/";
    return;
  }

  location.href="/buyer-dashboard/";

}

/* =========================
   LOGOUT
========================= */

window.logout = async function logout(){

  const auth = getAuthOrThrow();

  try{

    localStorage.setItem("justLoggedOut","1");
    await signOut(auth);
    location.replace("/login/");

  }catch(err){

    console.error(err);
    alert(err?.message || String(err));

  }

};
