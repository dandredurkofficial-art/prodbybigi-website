function compareFingerprints(a, b) {
  const setA = new Set(a.landmarks.map(l => l.hash));
  const setB = new Set(b.landmarks.map(l => l.hash));

  let match = 0;

  setA.forEach(h => {
    if (setB.has(h)) match++;
  });

  return match / Math.max(setA.size, setB.size);
}

module.exports = {
  compareFingerprints
};
