function togglePassword(inputId, el) {
  const input = document.getElementById(inputId);
  if (input.type === "password") {
    input.type = "text";
    el.textContent = "🙈";
  } else {
    input.type = "password";
    el.textContent = "👁";
  }
}

const passwordInput = document.getElementById("registerPassword");
if (passwordInput) {
  passwordInput.addEventListener("input", () => {
    const val = passwordInput.value;
    const fill = document.getElementById("strengthFill");
    const text = document.getElementById("strengthText");

    let strength = 0;
    if (val.length >= 8) strength++;
    if (/[A-Z]/.test(val)) strength++;
    if (/[0-9]/.test(val)) strength++;
    if (/[^A-Za-z0-9]/.test(val)) strength++;

    if (strength === 0) {
      fill.style.width = "0%";
      text.textContent = "Password strength";
    } else if (strength === 1) {
      fill.style.width = "25%";
      fill.style.background = "red";
      text.textContent = "Weak";
    } else if (strength === 2) {
      fill.style.width = "50%";
      fill.style.background = "orange";
      text.textContent = "Fair";
    } else if (strength === 3) {
      fill.style.width = "75%";
      fill.style.background = "#ffcc00";
      text.textContent = "Good";
    } else {
      fill.style.width = "100%";
      fill.style.background = "#22c55e";
      text.textContent = "Strong";
    }
  });
}
