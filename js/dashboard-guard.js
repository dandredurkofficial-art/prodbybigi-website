import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "/login.html";
    return;
  }

  const ref = doc(db, "producers", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    alert("Profile not found. Contact support.");
    location.href = "/";
    return;
  }

  const role = snap.data().role;

  // ✅ ALLOWED ROLES FOR DASHBOARD
  if (role !== "producer" && role !== "admin") {
    alert("Access denied.");
    location.href = "/";
  }
});
