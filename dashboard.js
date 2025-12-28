function loadSection(name) {
  fetch(`sections/${name}.html`)
    .then(res => res.text())
    .then(html => {
      document.getElementById("content").innerHTML = html;
    });
}

loadSection("overview");
