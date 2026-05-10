const admin = require("firebase-admin");
const { createFingerprint } = require("./audioryFingerprint");
const { compareFingerprints } = require("./matchEngine");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Save fingerprint to Firestore
 */
async function saveFingerprint(beatId, userId, audioBuffer) {
  const fingerprint = createFingerprint(audioBuffer);

  await db.collection("fingerprints").doc(beatId).set({
    beatId,
    userId,
    landmarks: fingerprint.landmarks,
    createdAt: Date.now()
  });

  return fingerprint;
}

/**
 * Scan all existing beats for matches (MVP version)
 */
async function scanForMatches(newFingerprint, beatId) {
  const snapshot = await db.collection("fingerprints").get();

  const matches = [];

  snapshot.forEach(doc => {
    const data = doc.data();

    if (data.beatId === beatId) return;

    const score = compareFingerprints(newFingerprint, data);

    if (score > 0.7) {
      matches.push({
        beatId: data.beatId,
        owner: data.userId,
        score
      });
    }
  });

  return matches;
}

module.exports = {
  saveFingerprint,
  scanForMatches
};
