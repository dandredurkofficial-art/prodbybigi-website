// /js/player.js
let currentAudio = null;

document.addEventListener("click", e => {
  const btn = e.target.closest("[data-audio]");
  if (!btn) return;

  const src = btn.dataset.audio;

  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  currentAudio = new Audio(src);
  currentAudio.play();
});
