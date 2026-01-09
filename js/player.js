let currentAudio = null;

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".play-btn");
  if (!btn) return;

  const audioUrl = btn.dataset.audio;
  if (!audioUrl) return;

  if (currentAudio && currentAudio.src === audioUrl) {
    currentAudio.pause();
    currentAudio = null;
    btn.textContent = "▶";
    return;
  }

  if (currentAudio) currentAudio.pause();

  currentAudio = new Audio(audioUrl);
  currentAudio.play();

  document
    .querySelectorAll(".play-btn")
    .forEach((b) => (b.textContent = "▶"));

  btn.textContent = "⏸";

  currentAudio.onended = () => {
    btn.textContent = "▶";
    currentAudio = null;
  };
});
