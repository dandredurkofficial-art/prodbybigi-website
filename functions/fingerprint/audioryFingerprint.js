const FFT = require("fft-js").fft;
const FFTUtil = require("fft-js").util;

function toMono(channelData) {
  return channelData;
}

function getSpectralPeaks(samples) {
  const chunkSize = 1024;
  const peaks = [];

  for (let i = 0; i < samples.length; i += chunkSize) {
    const slice = samples.slice(i, i + chunkSize);
    if (slice.length < chunkSize) continue;

    const phasors = FFT(slice);
    const mags = FFTUtil.fftMag(phasors);

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

function hashPoint(f1, f2, delta) {
  return `${f1}|${f2}|${delta}`;
}

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
  createFingerprint
};
