let currentAudio = null;

document.addEventListener("click", e => {
  const btn = e.target.closest("[data-audio]");
  if (!btn) return;

  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  currentAudio = new Audio(btn.dataset.audio);
  currentAudio.play();
});
