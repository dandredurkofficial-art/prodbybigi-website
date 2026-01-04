import {
  getFirestore,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  updateDoc,
  increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const db = getFirestore();
const auth = getAuth();

const followBtn = document.getElementById("followBtn");
const followersCountEl = document.getElementById("followersCount");

const producerId = username; // same from URL (?username=bigi)

onAuthStateChanged(auth, async user => {
  if (!user) {
    followBtn.textContent = "Login to follow";
    followBtn.disabled = true;
    return;
  }

  const userId = user.uid;

  const followRef = doc(db, "users", userId, "following", producerId);
  const producerRef = doc(db, "producers", producerId);

  const followSnap = await getDoc(followRef);
  const producerSnap = await getDoc(producerRef);

  // SET FOLLOW STATE
  if (followSnap.exists()) {
    followBtn.textContent = "Following";
    followBtn.classList.add("following");
  }

  // SET FOLLOWERS COUNT
  if (producerSnap.exists()) {
    followersCountEl.textContent =
      producerSnap.data().followersCount + " followers";
  }

  followBtn.onclick = async () => {
    if (followBtn.classList.contains("following")) {
      // UNFOLLOW
      await deleteDoc(followRef);
      await updateDoc(producerRef, {
        followersCount: increment(-1)
      });

      followBtn.textContent = "Follow";
      followBtn.classList.remove("following");
    } else {
      // FOLLOW
      await setDoc(followRef, {
        followedAt: new Date()
      });

      await updateDoc(producerRef, {
        followersCount: increment(1)
      });

      followBtn.textContent = "Following";
      followBtn.classList.add("following");
    }
  };
});
