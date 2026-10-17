// Harmonic timbres for the isochronic carrier and the pad as PeriodicWave
// partial tables, the purr pulse spectrum and a loudness trim per timbre.
// Pure: no browser globals; everything is computed from the tables below.

const partials = (...amps) => Object.freeze(amps);

/** Relative sine-partial amplitudes per timbre; index 0 is the fundamental. */
export const TIMBRES = Object.freeze({
  sine: partials(1),
  velvet: partials(1, 0.32, 0.14, 0.07, 0.03, 0.015, 0.008),
  glass: partials(1, 0.04, 0.22, 0.02, 0.06, 0, 0.02),
  warm: partials(1, 0.45, 0.22, 0.12, 0.06, 0.03, 0.015, 0.008),
});

/** Samples per period when a waveform is rendered for the loudness trim. */
const RENDER_SAMPLES = 2048;

/** PeriodicWave coefficients for a timbre: `real` all zero, `imag[0] = 0`, `imag[k]` = partial k. */
export function timbreCoefficients(name) {
  const amps = TIMBRES[name];
  if (!amps) throw new RangeError(`Unknown timbre: ${name}`);
  return coefficientsFromPartials(amps);
}

/** PeriodicWave coefficients for the purr pulse, `imag[k] = k^-0.7` for k = 1..n; `duty` is kept for API compatibility and unused in v1 (the pulse shape comes from the 26 Hz gate, not from the spectrum). */
export function pulseCoefficients(duty = 0.2, n = 42) {
  const amps = Array.from({ length: n }, (_, i) => (i + 1) ** -0.7);
  return coefficientsFromPartials(amps);
}

/** rms(sine) / rms(timbre), each period rendered at RENDER_SAMPLES and scaled to peak 1 as Web Audio normalises a PeriodicWave; 'sine' gives exactly 1. */
export function timbreGainTrim(name) {
  return normalisedRms(timbreCoefficients('sine').imag) / normalisedRms(timbreCoefficients(name).imag);
}

function coefficientsFromPartials(amps) {
  const real = new Float32Array(amps.length + 1);
  const imag = new Float32Array(amps.length + 1);
  imag.set(amps, 1);
  return { real, imag };
}

/** RMS of one period of sum(imag[k] * sin(2*pi*k*x)) after scaling its peak to 1. */
function normalisedRms(imag) {
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < RENDER_SAMPLES; i++) {
    const v = sampleAt(imag, i / RENDER_SAMPLES);
    peak = Math.max(peak, Math.abs(v));
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / RENDER_SAMPLES) / peak;
}

function sampleAt(imag, x) {
  let v = 0;
  for (let k = 1; k < imag.length; k++) v += imag[k] * Math.sin(2 * Math.PI * k * x);
  return v;
}
