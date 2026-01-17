// /js/player.js
let currentAudio = null;
let currentButton = null;

function setButtonState(btn, playing) {
  const icon = btn?.querySelector(".icon");
  if (!icon) return;
  icon.textContent = playing ? "⏸" : "▶";
  btn.setAttribute("aria-label", playing ? "Pause preview" : "Play preview");
}

export function wirePlayers(root = document) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest(".play-btn");
    if (!btn) return;

    const url = btn.dataset.audio || "";
    if (!url) return;

    // Toggle same track
    if (currentAudio && currentButton === btn) {
      if (currentAudio.paused) {
        currentAudio.play();
        setButtonState(btn, true);
      } else {
        currentAudio.pause();
        setButtonState(btn, false);
      }
      return;
    }

    // Stop previous track
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }
    if (currentButton) setButtonState(currentButton, false);

    // Start new
    currentAudio = new Audio(url);
    currentButton = btn;
    setButtonState(btn, true);

    currentAudio.play().catch(() => {
      setButtonState(btn, false);
      currentAudio = null;
      currentButton = null;
    });

    currentAudio.addEventListener("ended", () => {
      setButtonState(btn, false);
      if (currentButton === btn) currentButton = null;
      currentAudio = null;
    });
  });
}
