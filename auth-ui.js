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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 🔥 Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
};

// 🔥 Init Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// =======================
// 🔐 LOGIN
// =======================
window.loginUser = () => {
  signInWithEmailAndPassword(auth, email.value, password.value)
    .then(() => {
      window.location.href = "dashboard.html";
    })
    .catch(err => alert(err.message));
};

// =======================
// 🧑‍🎤 REGISTER + PRODUCER DOC (ONE-TIME)
// =======================
window.registerUser = async () => {
  try {
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email.value,
      password.value
    );

    const user = userCredential.user;

    // ✅ CREATE PRODUCER DOCUMENT (ONLY ON SIGNUP)
    await setDoc(doc(db, "producers", user.uid), {
      displayName: "New Producer",
      followersCount: 0,
      verified: false,
      createdAt: serverTimestamp()
    });

    // ✅ SAFE REDIRECT
    window.location.href = "dashboard.html";

  } catch (err) {
    alert(err.message);
  }
};
