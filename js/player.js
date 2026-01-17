// /js/player.js
let currentAudio = null;
let currentBtn = null;

function setBtn(btn, state) {
  // states: idle, loading, playing, paused
  if (!btn) return;

  btn.classList.remove("is-loading", "is-playing", "is-paused");

  if (state === "loading") {
    btn.classList.add("is-loading");
    btn.textContent = "…";
    return;
  }

  if (state === "playing") {
    btn.classList.add("is-playing");
    btn.textContent = "❚❚";
    return;
  }

  if (state === "paused") {
    btn.classList.add("is-paused");
    btn.textContent = "▶";
    return;
  }

  btn.textContent = "▶";
}

async function playFromButton(btn) {
  const url = btn?.dataset?.audio;
  if (!url) return;

  // If clicking same button, toggle play/pause
  if (currentBtn === btn && currentAudio) {
    if (currentAudio.paused) {
      currentAudio.play();
      setBtn(btn, "playing");
    } else {
      currentAudio.pause();
      setBtn(btn, "paused");
    }
    return;
  }

  // Stop previous
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentBtn) setBtn(currentBtn, "idle");

  // Start new
  currentBtn = btn;
  setBtn(btn, "loading");

  const audio = new Audio(url);
  currentAudio = audio;

  audio.addEventListener("canplay", () => {
    // canplay = faster start
    if (currentBtn === btn) setBtn(btn, "playing");
  });

  audio.addEventListener("ended", () => {
    if (currentBtn === btn) setBtn(btn, "idle");
  });

  audio.addEventListener("pause", () => {
    if (currentBtn === btn) setBtn(btn, "paused");
  });

  audio.addEventListener("play", () => {
    if (currentBtn === btn) setBtn(btn, "playing");
  });

  audio.addEventListener("error", () => {
    if (currentBtn === btn) setBtn(btn, "idle");
    console.error("Audio failed:", url);
    alert("Audio failed to play.");
  });

  try {
    await audio.play();
  } catch (e) {
    setBtn(btn, "idle");
    console.error(e);
    alert("Tap again to play (browser blocked autoplay).");
  }
}

// Global click handler (works even after beats render)
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".play-btn");
  if (!btn) return;
  playFromButton(btn);
});
