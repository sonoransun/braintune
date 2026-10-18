// Pad voicing by register: which of the five pad slots sound under a carrier and
// how loud, the pad low-pass, the entry order, and the canon variant whose two
// voices share the upper slots' gain. Pure: no browser globals. Every slot is a
// harmonic of the sub (ratios 2^a * 3^b). Below 240 Hz the fifth sits less than
// 120 Hz from the tone, close enough to roughen (Plomp & Levelt 1965), so the low
// registers take the twelfth; below 150 Hz the double octave is a fullness choice.

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** Registers by carrier, lowest first: a carrier belongs to the first whose maxHz exceeds it. */
export const REGISTERS = deepFreeze([{ id: 'low', maxHz: 150 }, { id: 'lowMid', maxHz: 240 }, { id: 'mid', maxHz: 360 }, { id: 'high', maxHz: Infinity }]);

/** Slots that exist in the graph, in creation order; `timbred` slots are two-oscillator pairs with the carrier's PeriodicWave. */
export const PAD_SLOTS = deepFreeze([
  { name: 'sub', ratio: 0.5, timbred: false }, { name: 'fifth', ratio: 1.5, timbred: true }, { name: 'octave', ratio: 2, timbred: true },
  { name: 'twelfth', ratio: 3, timbred: false }, { name: 'double', ratio: 4, timbred: false },
]);

/** Slot gains per register (sums 1.45, 1.40, 1.60 and 1.35). */
export const PAD_VOICINGS = deepFreeze({
  low: { sub: 0.4, fifth: 0, octave: 0.6, twelfth: 0.3, double: 0.15 },
  lowMid: { sub: 0.45, fifth: 0, octave: 0.6, twelfth: 0.35, double: 0 },
  mid: { sub: 0.4, fifth: 0.4, octave: 0.6, twelfth: 0.2, double: 0 },
  high: { sub: 0.35, fifth: 0.5, octave: 0.5, twelfth: 0, double: 0 },
});

/** Entry choreography after the pad becomes audible: seconds after the anchor and swell length (shape 'scurve'). */
export const PAD_ENTRIES = deepFreeze({
  octave: { at: 0, seconds: 1.5 }, fifth: { at: 12, seconds: 8 }, twelfth: { at: 12, seconds: 8 }, sub: { at: 24, seconds: 10 }, double: { at: 40, seconds: 12 },
});

/** Length of the linear slot-gain crossfade when the register changes, seconds. */
export const VOICING_CROSSFADE_SECONDS = 6;

/** Pad low-pass bounds, Hz. */
export const PAD_LP_HZ = Object.freeze([1000, 1800]);

/** Pad low-pass cutoff per hertz of carrier before clamping to PAD_LP_HZ. */
const PAD_LP_RATIO = 6;

/** Slots the canon voices replace: their summed gain is shared by the two voices. */
const CANON_SLOTS = Object.freeze(['fifth', 'twelfth', 'double']);

/** Register id for a carrier: 'low' below 150 Hz, 'lowMid' below 240, 'mid' below 360, else 'high'. */
export function registerOf(hz) {
  return (REGISTERS.find((r) => hz < r.maxHz) ?? REGISTERS.at(-1)).id;
}

/** Pad low-pass cutoff, clamp(6 hz, 1000, 1800): 110 -> 1000, 198 -> 1188, 264 -> 1584, 300 and up -> 1800. */
export function padLowpassHz(hz) {
  return Math.min(PAD_LP_HZ[1], Math.max(PAD_LP_HZ[0], PAD_LP_RATIO * hz));
}

/** Drone voicing for a carrier: { register, lpHz, gains: { sub, fifth, octave, twelfth, double } } (gains a fresh copy). */
export function voicingFor(hz) {
  const register = registerOf(hz);
  return { register, lpHz: padLowpassHz(hz), gains: { ...PAD_VOICINGS[register] } };
}

/** Canon voicing: sub and octave as the drone voicing, the fifth, twelfth and double silent, and voiceGain = half their drone sum for each canon voice. */
export function canonVoicingFor(hz) {
  const { register, lpHz, gains } = voicingFor(hz);
  const shared = CANON_SLOTS.reduce((sum, name) => sum + gains[name], 0);
  for (const name of CANON_SLOTS) gains[name] = 0;
  return { register, lpHz, gains, voiceGain: shared / 2 };
}

/** Sum of the register's slot gains: the pad's coherent peak relative to one slot at gain 1, the same in drone and canon. */
export function padGainSum(hz) {
  return Object.values(PAD_VOICINGS[registerOf(hz)]).reduce((sum, gain) => sum + gain, 0);
}
