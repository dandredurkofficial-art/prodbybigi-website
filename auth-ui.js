let passwordStrong = false;

window.togglePassword = (id, el) => {
  const input = document.getElementById(id);
  input.type = input.type === "password" ? "text" : "password";
  el.textContent = input.type === "password" ? "👁" : "🙈";
};

const pwd = document.getElementById("registerPassword");
const btn = document.getElementById("registerBtn");

if (pwd) {
  pwd.addEventListener("input", () => {
    const fill = document.getElementById("strengthFill");
    const text = document.getElementById("strengthText");
    let s = 0;

    if (pwd.value.length >= 8) s++;
    if (/[A-Z]/.test(pwd.value)) s++;
    if (/[0-9]/.test(pwd.value)) s++;
    if (/[^A-Za-z0-9]/.test(pwd.value)) s++;

    const labels = ["", "Weak", "Fair", "Good", "Strong"];
    const colors = ["", "red", "orange", "#ffcc00", "#22c55e"];

    fill.style.width = s * 25 + "%";
    fill.style.background = colors[s];
    text.textContent = labels[s];

    passwordStrong = s === 4;
    btn.disabled = !passwordStrong;
    btn.style.opacity = passwordStrong ? "1" : "0.5";
  });
}
