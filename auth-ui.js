import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

window.loginUser = () => {
  signInWithEmailAndPassword(auth, email.value, password.value)
    .then(() => location.href = "dashboard.html")
    .catch(err => alert(err.message));
};

window.registerUser = () => {
  createUserWithEmailAndPassword(auth, email.value, password.value)
    .then(() => location.href = "dashboard.html")
    .catch(err => alert(err.message));
};
