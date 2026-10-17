// Goertzel band-energy helper for spectral tests (no FFT, no dependencies).
//
// goertzelBandEnergy(x, sampleRate, f0, f1) probes K = 16 frequencies evenly spaced over
// [f0, f1] (both ends included). Each probe uses the generalised Goertzel recurrence, which
// evaluates the rectangular-window DFT of x at an arbitrary frequency f, not only at bin
// centres:
//   s[n] = x[n] + 2cos(w)·s[n−1] − s[n−2],   w = 2π·f / sampleRate
//   |X(f)|² = s[N−1]² + s[N−2]² − 2cos(w)·s[N−1]·s[N−2]
// A window holds up to 2^16 samples. x is cut into consecutive full windows of that length
// (a shorter x is one window) and their periodograms are averaged, which keeps the estimate's
// variance low on long noise loops. Power is normalised as 2|X|²/N², so a sinusoid of
// amplitude A at a probed frequency reads ≈ A²/2 (its mean-square value) and wide-band noise
// reads proportionally to its power spectral density. Absolute values depend on the window
// length, so compare bands measured on inputs of equal length.

const BINS = 16;
const MAX_WINDOW = 1 << 16;

/** |X(w)|² of x[start … start+length) via the Goertzel recurrence. */
function goertzelPower(x, start, length, w) {
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let n = start; n < start + length; n++) {
    const s0 = x[n] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/** Mean power (linear) over 16 evenly spaced frequencies in [f0, f1]; see the header comment. */
export function goertzelBandEnergy(x, sampleRate, f0, f1) {
  const length = Math.min(x.length, MAX_WINDOW);
  if (length === 0) return 0;
  const windows = Math.floor(x.length / length);
  let total = 0;
  for (let k = 0; k < BINS; k++) {
    const f = f0 + ((f1 - f0) * k) / (BINS - 1);
    const w = (2 * Math.PI * f) / sampleRate;
    for (let m = 0; m < windows; m++) total += goertzelPower(x, m * length, length, w);
  }
  return (2 * total) / (BINS * windows * length * length);
}

/** Linear power to dB, floored at −300 dB so silence stays finite. */
export function powerDb(p) {
  return 10 * Math.log10(Math.max(p, 1e-30));
}
