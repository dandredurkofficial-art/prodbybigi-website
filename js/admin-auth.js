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

let resolved = false;

onAuthStateChanged(auth, async (user) => {
  if (resolved) return;
  resolved = true;

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      alert("Profile missing. Contact support.");
      await signOut(auth);
      window.location.href = "login.html";
      return;
    }

    const role = snap.data().role;

    if (role !== "admin") {
      window.location.href =
        role === "producer" ? "dashboard.html" : "buyer-dashboard.html";
      return;
    }

    // ✅ ADMIN VERIFIED — STOP HERE
    document.body.style.visibility = "visible";
  } catch (err) {
    console.error(err);
    alert("Auth error. Reload page.");
  }
});

window.logout = async () => {
  await signOut(auth);
  window.location.href = "login.html";
};
