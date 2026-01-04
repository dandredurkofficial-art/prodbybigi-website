// auth-ui.js (ES MODULE)

// 🔥 Firebase imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 🔥 Firebase config (MUST include projectId)
const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi", // ✅ REQUIRED
};

// 🔥 Init Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 🔥 Inputs
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

// ==========================
// 🔐 LOGIN
// ==========================
const loginBtn = document.getElementById("loginBtn");
if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    try {
      await signInWithEmailAndPassword(
        auth,
        emailInput.value,
        passwordInput.value
      );

      window.location.href = "dashboard.html";
    } catch (err) {
      alert(err.message);
    }
  });
}

// ==========================
// 🧑‍🎤 REGISTER + PRODUCER DOC (ONE TIME)
// ==========================
const registerBtn = document.getElementById("registerBtn");
if (registerBtn) {
  registerBtn.addEventListener("click", async () => {
    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        emailInput.value,
        passwordInput.value
      );

      const user = cred.user;

      const producerRef = doc(db, "producers", user.uid);
      const snap = await getDoc(producerRef);

      // ✅ Create producer document ONLY if it doesn't exist
      if (!snap.exists()) {
        await setDoc(producerRef, {
          uid: user.uid,
          email: user.email,
          displayName: "",
          beatsCount: 0,
          followers: 0,
          createdAt: Date.now()
        });
      }

      window.location.href = "dashboard.html";
    } catch (err) {
      alert(err.message);
    }
  });
}
