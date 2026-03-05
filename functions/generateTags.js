const { onRequest } = require("firebase-functions/v2/https");

exports.generateTags = onRequest((req, res) => {

  const { title, genre, bpm } = req.body;

  let tags = [];

  const text = (title || "").toLowerCase();

  // genre tag
  if (genre) tags.push(genre.toLowerCase());

  // bpm detection
  if (bpm) {
    if (bpm < 90) tags.push("slow beat");
    if (bpm >= 90 && bpm <= 120) tags.push("mid tempo");
    if (bpm > 120) tags.push("fast beat");
  }

  // keyword detection
  if (text.includes("trap")) tags.push("trap beat");
  if (text.includes("drill")) tags.push("drill beat");
  if (text.includes("afro")) tags.push("afrobeats");
  if (text.includes("amapiano")) tags.push("amapiano");
  if (text.includes("rage")) tags.push("rage beat");
  if (text.includes("melodic")) tags.push("melodic beat");

  // artist type beat detection
  if (text.includes("lil baby")) tags.push("lil baby type beat");
  if (text.includes("drake")) tags.push("drake type beat");
  if (text.includes("future")) tags.push("future type beat");
  if (text.includes("central cee")) tags.push("central cee type beat");

  // default tags
  tags.push("instrumental", "freestyle beat");

  // remove duplicates
  tags = [...new Set(tags)];

  res.json({
    tags
  });

});
