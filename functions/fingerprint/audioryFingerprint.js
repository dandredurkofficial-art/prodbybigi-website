const FFT = require("fft-js").fft;
const FFTUtil = require("fft-js").util;

/**
 * Convert audio buffer → mono samples
 */
function toMono(channelData) {
  return channelData;
}

/**
 * STEP 1: get spectral peaks
 */
function getSpectralPeaks(samples) {
  const chunkSize = 1024;
  const peaks = [];

  for (let i = 0; i < samples.length; i += chunkSize) {
    const slice = samples.slice(i, i + chunkSize);

    if (slice.length < chunkSize) continue;

    const phasors = FFT(slice);
    const mags = FFTUtil.fftMag(phasors);

    // find top energy frequencies
    const topIndices = mags
      .map((v, i) => ({ v, i }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 5);

    peaks.push(
      topIndices.map(p => ({
        freq: p.i,
        amp: p.v,
        time: i
      }))
    );
  }

  return peaks;
}

/**
 * STEP 2: create "landmarks"
 * (core of Content ID systems)
 */
function createLandmarks(peaks) {
  const landmarks = [];

  for (let i = 0; i < peaks.length - 1; i++) {
    const current = peaks[i];
    const next = peaks[i + 1];

    for (let a of current) {
      for (let b of next) {
        landmarks.push({
          hash: hashPoint(a.freq, b.freq, b.time - a.time),
          time: a.time
        });
      }
    }
  }

  return landmarks;
}

/**
 * STEP 3: hash generator
 * (this is what makes matching fast)
 */
function hashPoint(f1, f2, delta) {
  return `${f1}|${f2}|${delta}`;
}

/**
 * STEP 4: MAIN FUNCTION (EXPORT)
 */
function createFingerprint(audioBuffer) {
  const channelData = audioBuffer.getChannelData(0);
  const samples = toMono(channelData);

  const peaks = getSpectralPeaks(samples);
  const landmarks = createLandmarks(peaks);

  return {
    landmarks,
    rawPeaks: peaks.length
  };
}

module.exports = {
  createFingerprint,
  hashPoint
};
