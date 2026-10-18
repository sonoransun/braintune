// Consonance helpers for the pad-voicing tests (v0.4 spec §3.2, §3.10).
//
// pairRoughness is Sethares' (1993) parametrisation of the Plomp & Levelt (1965) pure-tone
// dissonance curve, r = w · (e^(−b1·s·x) − e^(−b2·s·x)) with x = |f2 − f1| and
// s = d* / (s1·min(f1, f2) + s2); w is a1·a2 (1993) or min(a1, a2) (Sethares 2005). Summed over
// every pair of components it estimates the roughness of a spectrum. harmonicSpectrum and
// lowpassMagnitude build the spectra the tone layer makes; beatGuardViolations is the §3.10 guard:
// a pad component must sit on a harmonic of the carrier or keep 20 Hz from every beat voice and
// isochronic carrier partial, so it can never beat slowly against them.

const D_STAR = 0.24;
const S1 = 0.0207;
const S2 = 18.96;
const B1 = 3.51;
const B2 = 5.75;
const WAVE_SAMPLES = 2048;

/** Roughness of two pure tones (Hz, linear amplitude); `weighting` 'product' (a1·a2) or 'min' (min(a1, a2)). */
export function pairRoughness(f1, a1, f2, a2, { weighting = 'product' } = {}) {
  const s = D_STAR / (S1 * Math.min(f1, f2) + S2);
  const x = Math.abs(f2 - f1);
  const w = weighting === 'min' ? Math.min(a1, a2) : a1 * a2;
  return w * (Math.exp(-B1 * s * x) - Math.exp(-B2 * s * x));
}

/** Total roughness of a spectrum [[hz, amplitude], …]: the sum over every pair of components. */
export function spectrumRoughness(components, options = {}) {
  let sum = 0;
  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) sum += pairRoughness(components[i][0], components[i][1], components[j][0], components[j][1], options);
  }
  return sum;
}

/** Components [[k·f, a_k·gain/peak], …] of a harmonic tone with partial amplitudes `partials` (index 0 = fundamental), scaled so its waveform peaks at `gain`, as a normalised PeriodicWave does. */
export function harmonicSpectrum(f, partials, gain = 1) {
  let peak = 0;
  for (let i = 0; i < WAVE_SAMPLES; i++) {
    let v = 0;
    partials.forEach((a, k) => { v += a * Math.sin((2 * Math.PI * (k + 1) * i) / WAVE_SAMPLES); });
    peak = Math.max(peak, Math.abs(v));
  }
  return partials.flatMap((a, k) => (a > 0 ? [[f * (k + 1), (a * gain) / peak]] : []));
}

/** Magnitude of a second-order low-pass (cutoff fc, quality Q) at f: 1 / √((1 − (f/fc)²)² + (f / (fc·Q))²). */
export function lowpassMagnitude(f, fc, Q) {
  const r = f / fc;
  return 1 / Math.sqrt((1 - r * r) ** 2 + (r / Q) ** 2);
}

/**
 * The §3.10 beat guard for a pad voicing on carrier f: every sounding slot and every partial of amplitude ≥ 0.1 of a timbred
 * slot is an integer multiple of f or at least `minGapHz` from the beat voices (f ± halfBeatHz) and from every isochronic
 * carrier partial k·f (k ≤ 7). Returns the offending components as [{ name, hz }] (empty when the voicing passes).
 */
export function beatGuardViolations(f, slots, partials, { halfBeatHz = 20, minGapHz = 20, carrierPartials = 7 } = {}) {
  const components = slots.flatMap(({ name, ratio, timbred }) =>
    timbred ? partials.flatMap((a, k) => (a >= 0.1 ? [{ name, hz: ratio * (k + 1) * f }] : [])) : [{ name, hz: ratio * f }]);
  const harmonic = (hz) => Math.abs(hz / f - Math.round(hz / f)) < 1e-9;
  const gapToVoices = (hz) => Math.max(0, Math.abs(hz - f) - halfBeatHz);
  const gapToCarrier = (hz) => Math.min(...Array.from({ length: carrierPartials }, (_, k) => Math.abs(hz - (k + 1) * f)));
  return components.filter(({ hz }) => !harmonic(hz) && (gapToVoices(hz) < minGapHz || gapToCarrier(hz) < minGapHz));
}
