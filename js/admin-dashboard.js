import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let checked = false; // ⛔ prevents refresh loop

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  if (checked) return;
  checked = true;

  const snap = await getDoc(doc(db, "users", user.uid));

  if (!snap.exists()) {
    alert("Admin profile missing");
    await signOut(auth);
    window.location.replace("login.html");
    return;
  }

  const role = snap.data().role;

  if (role !== "admin") {
    // 🚫 not admin → redirect ONCE
    window.location.replace(
      role === "producer" ? "dashboard.html" : "buyer-dashboard.html"
    );
    return;
  }

  // ✅ ADMIN VERIFIED — DO NOT REDIRECT
  console.log("Admin access granted");
});

/* LOGOUT */
window.logout = async () => {
  await signOut(auth);
  window.location.replace("login.html");
};
