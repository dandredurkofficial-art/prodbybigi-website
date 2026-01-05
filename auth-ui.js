import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ======================
   LOGIN
====================== */
window.loginUser = async () => {
  try {
    const cred = await signInWithEmailAndPassword(
      auth,
      email.value,
      password.value
    );

    const uid = cred.user.uid;

    // 🔑 ENSURE USER DOC EXISTS
    const producerRef = doc(db, "producers", uid);
    const snap = await getDoc(producerRef);

    if (!snap.exists()) {
      await setDoc(producerRef, {
        uid,
        email: cred.user.email,
        role: "producer",
        plan: "free",
        createdAt: serverTimestamp(),
      });
    }

    location.href = "dashboard.html";
  } catch (err) {
    alert(err.message);
  }
};

/* ======================
   REGISTER
====================== */
window.registerUser = async () => {
  try {
    const cred = await createUserWithEmailAndPassword(
      auth,
      email.value,
      password.value
    );

    const uid = cred.user.uid;

    // 🧱 CREATE USER DOC (ONE TIME)
    await setDoc(doc(db, "producers", uid), {
      uid,
      email: cred.user.email,
      role: "producer",
      plan: "free",
      createdAt: serverTimestamp(),
    });

    location.href = "dashboard.html";
  } catch (err) {
    alert(err.message);
  }
};
