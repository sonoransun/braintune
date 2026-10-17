// Entrainment mathematics: bands, beat and carrier ranges, mode and carrier
// recommendations, per-mode voice frequencies and the partial-beat table that
// explains why beat voices are sines. Pure: no browser globals. Units: Hz.

const range = (lo, hi) => Object.freeze([lo, hi]);

/** Brainwave bands as [lowHz, highHz]; a beat belongs to the band containing it, upper bound exclusive except for gamma. */
export const BANDS = Object.freeze({
  delta: range(0.5, 4),
  theta: range(4, 8),
  alpha: range(8, 13),
  beta: range(13, 30),
  gamma: range(30, 60),
});

/** Beat range per mode, Hz. */
export const BEAT_RANGE = Object.freeze({
  binaural: range(0.5, 30),
  monaural: range(0.5, 40),
  isochronic: range(0.5, 60),
});

/** Carrier range per mode, Hz. */
export const CARRIER_RANGE = Object.freeze({
  binaural: range(100, 1000),
  monaural: range(120, 1000),
  isochronic: range(120, 1200),
});

/** Pitch slider range offered in the UI, Hz. */
export const UI_CARRIER = range(120, 800);

/** Lowest carrier for speakers on a phone, Hz: small speakers reproduce little below it. */
const PHONE_SPEAKER_MIN_HZ = 400;
/** Beats at or above this are always isochronic; binaural beats fade out towards 30 Hz. */
const ISOCHRONIC_ONLY_HZ = 30;
/** A partial of a binaural pair is a plausible secondary beat only below these limits (see §6.2 of the plan). */
const PERCEPTIBLE_PARTIAL_HZ = 1000;
const PERCEPTIBLE_BEAT_HZ = 35;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Band name for a beat; beats below 0.5 Hz or above 60 Hz map to the nearest band. */
export function bandOf(beatHz) {
  for (const [name, [, hi]] of Object.entries(BANDS)) if (beatHz < hi) return name;
  return 'gamma';
}

/** Beat clamped to BEAT_RANGE[mode]. */
export function clampBeat(beatHz, mode) {
  const [lo, hi] = rangeFor(BEAT_RANGE, mode);
  return clamp(beatHz, lo, hi);
}

/** Mode for a setup: beat >= 30 Hz is always isochronic; otherwise an explicit override (anything but 'auto' or empty) wins; headphones give binaural; anything else isochronic. */
export function recommendMode({ listening, beatHz, override = 'auto' }) {
  if (beatHz >= ISOCHRONIC_ONLY_HZ) return 'isochronic';
  if (override && override !== 'auto') return override;
  return listening === 'headphones' ? 'binaural' : 'isochronic';
}

/** Carrier for a setup: speakers on a phone raise it to at least 400 Hz, then it is clamped to CARRIER_RANGE[mode]. */
export function recommendCarrier({ presetCarrierHz, mode, device, listening }) {
  const onPhoneSpeakers = listening === 'speakers' && device === 'phone';
  const hz = onPhoneSpeakers ? Math.max(presetCarrierHz, PHONE_SPEAKER_MIN_HZ) : presetCarrierHz;
  const [lo, hi] = rangeFor(CARRIER_RANGE, mode);
  return clamp(hz, lo, hi);
}

/** Oscillator frequencies per mode: binaural and monaural {left: f - beat/2, right: f + beat/2}; isochronic {carrier: f, pulse: beat}. */
export function voiceFrequencies(f, beatHz, mode) {
  if (mode === 'isochronic') return { carrier: f, pulse: beatHz };
  if (mode !== 'binaural' && mode !== 'monaural') throw new RangeError(`Unknown mode: ${mode}`);
  return { left: f - beatHz / 2, right: f + beatHz / 2 };
}

/** Secondary beats a timbre would add to binaural voices: one row per partial with amplitude > 0 (n = index + 1) beating at n * beat, perceptible when n * f < 1000 and n * beat < 35. */
export function partialBeatTable(f, beatHz, partials) {
  const { left, right } = voiceFrequencies(f, beatHz, 'binaural');
  return partials.flatMap((amp, i) => {
    const n = i + 1;
    if (!(amp > 0)) return [];
    const perceptible = n * f < PERCEPTIBLE_PARTIAL_HZ && n * beatHz < PERCEPTIBLE_BEAT_HZ;
    return [{ n, left: n * left, right: n * right, interauralHz: n * beatHz, perceptible }];
  });
}

function rangeFor(table, mode) {
  const found = table[mode];
  if (!found) throw new RangeError(`Unknown mode: ${mode}`);
  return found;
}
