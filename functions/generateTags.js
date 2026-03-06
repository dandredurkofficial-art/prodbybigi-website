const { onRequest } = require("firebase-functions/v2/https");
const cors = require("cors")({ origin: true });

exports.generateTags = onRequest((req, res) => {
  cors(req, res, async () => {

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    try {

      const { title } = req.body;

      if (!title) {
        return res.status(400).json({ error: "Missing title" });
      }

      // your AI tagging logic here
      const tags = title
        .toLowerCase()
        .split(" ")
        .slice(0, 5);

      return res.json({ tags });

    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }

  });
});
