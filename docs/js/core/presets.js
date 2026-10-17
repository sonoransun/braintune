// The preset table (§6.5 of the plan), its validation and its resolution to
// engine parameters for a listening setup. Pure: no browser globals.

import { BANDS, BEAT_RANGE, CARRIER_RANGE, bandOf, recommendCarrier, recommendMode } from './entrainment.js';
import { gateParams } from './gate.js';
import { TIMBRES } from './timbres.js';

/** Timer lengths offered, minutes. */
/** Timer choices in display order, in minutes: ∞ (0) first, then the long sessions, then the short ones. */
export const TIMER_OPTIONS = Object.freeze([0, 720, 360, 120, 10, 15, 20, 30, 45, 60, 90]);

/** Preset selected on first run. */
export const DEFAULT_PRESET_ID = 'sleep';

/** Intensities a preset carries for a layer it leaves off (the global defaults), so raising that slider sounds like the default. */
const DEFAULT_RAIN_INTENSITY = 0.45;
const DEFAULT_OCEAN_INTENSITY = 0.35;

const MAX_NAME_LENGTH = 14;
const END_FADE_RANGE = [20, 90];
const CHIMES = ['none', 'soft'];
const CAT_MOODS = ['sleepy', 'calm', 'alert'];
const LAYERS = ['tone', 'rain', 'ocean', 'purr'];

/** The eight presets in display order; carriers are headphones and speakers values. Every preset purrs and plays until stopped (timer ∞). */
export const PRESETS = deepFreeze([
  {
    id: 'sleep', name: 'Sleep', band: 'delta', beatHz: 2, glide: { fromHz: 6, minutes: 12 },
    carrierHz: { headphones: 200, speakers: 420 }, timbre: 'velvet', pad: true,
    mix: { tone: 0.5, rain: 0.6, ocean: 0.55, purr: 0.55 },
    rainIntensity: 0.35, oceanIntensity: 0.35,
    timerMinutes: 0, endFadeSeconds: 90, chime: 'none',
  },
  {
    id: 'rest', name: 'Rest', band: 'delta', beatHz: 3.5,
    carrierHz: { headphones: 210, speakers: 420 }, timbre: 'velvet', pad: true,
    mix: { tone: 0.55, rain: 0.65, ocean: 0.6, purr: 0.5 },
    rainIntensity: 0.35, oceanIntensity: 0.3,
    timerMinutes: 0, endFadeSeconds: 60, chime: 'none',
  },
  {
    id: 'meditate', name: 'Meditate', band: 'theta', beatHz: 6,
    carrierHz: { headphones: 256, speakers: 420 }, timbre: 'glass', pad: true,
    mix: { tone: 0.55, rain: 0.6, ocean: 0.7, purr: 0.45 },
    rainIntensity: DEFAULT_RAIN_INTENSITY, oceanIntensity: 0.4,
    timerMinutes: 0, endFadeSeconds: 30, chime: 'soft',
  },
  {
    id: 'catnap', name: 'Cat nap', band: 'theta', beatHz: 5.5,
    carrierHz: { headphones: 220, speakers: 420 }, timbre: 'velvet', pad: true,
    mix: { tone: 0.45, rain: 0.6, ocean: 0, purr: 0.7 },
    rainIntensity: 0.4, oceanIntensity: DEFAULT_OCEAN_INTENSITY,
    timerMinutes: 0, endFadeSeconds: 60, chime: 'none', catMood: 'sleepy',
  },
  {
    id: 'calm', name: 'Calm', band: 'alpha', beatHz: 10,
    carrierHz: { headphones: 256, speakers: 420 }, timbre: 'velvet', pad: true,
    mix: { tone: 0.55, rain: 0.75, ocean: 0.5, purr: 0.45 },
    rainIntensity: 0.45, oceanIntensity: 0.35,
    timerMinutes: 0, endFadeSeconds: 30, chime: 'none',
  },
  {
    id: 'focus', name: 'Focus', band: 'beta', beatHz: 15,
    carrierHz: { headphones: 320, speakers: 520 }, timbre: 'glass', pad: false,
    mix: { tone: 0.55, rain: 0.75, ocean: 0, purr: 0.4 },
    rainIntensity: 0.5, oceanIntensity: DEFAULT_OCEAN_INTENSITY,
    timerMinutes: 0, endFadeSeconds: 30, chime: 'soft',
  },
  {
    id: 'energise', name: 'Energise', band: 'beta', beatHz: 20,
    carrierHz: { headphones: 400, speakers: 640 }, timbre: 'warm', pad: false,
    mix: { tone: 0.6, rain: 0.6, ocean: 0.65, purr: 0.4 },
    rainIntensity: 0.55, oceanIntensity: 0.6,
    timerMinutes: 0, endFadeSeconds: 20, chime: 'soft',
  },
  {
    id: 'clarity', name: 'Clarity', band: 'gamma', beatHz: 40,
    carrierHz: { headphones: 400, speakers: 520 }, timbre: 'warm', pad: false,
    mix: { tone: 0.55, rain: 0.7, ocean: 0, purr: 0.4 },
    rainIntensity: 0.45, oceanIntensity: DEFAULT_OCEAN_INTENSITY,
    timerMinutes: 0, endFadeSeconds: 30, chime: 'soft', forceMode: 'isochronic',
  },
]);

/** The preset with this id, or undefined. */
export function getPreset(id) {
  return PRESETS.find((p) => p.id === id);
}

/** Checks a preset against the schema and ranges; returns { ok, errors } with one message per failed rule. */
export function validatePreset(p) {
  if (!p || typeof p !== 'object') return { ok: false, errors: ['preset must be an object'] };
  const errors = [];
  const need = (ok, message) => { if (!ok) errors.push(message); };

  need(typeof p.id === 'string' && p.id.length > 0, 'id must be a non-empty string');
  need(typeof p.name === 'string' && p.name.length > 0 && p.name.length <= MAX_NAME_LENGTH, `name must be 1-${MAX_NAME_LENGTH} characters`);
  need(p.band in BANDS, `band ${p.band} is not one of ${Object.keys(BANDS).join(', ')}`);
  need(Number.isFinite(p.beatHz) && bandOf(p.beatHz) === p.band, `beatHz ${p.beatHz} is not inside band ${p.band}`);
  need(inRange(p.carrierHz?.headphones, CARRIER_RANGE.binaural), `carrierHz.headphones ${p.carrierHz?.headphones} is outside the binaural range`);
  need(inRange(p.carrierHz?.speakers, CARRIER_RANGE.isochronic), `carrierHz.speakers ${p.carrierHz?.speakers} is outside the isochronic range`);
  need(p.timbre in TIMBRES, `timbre ${p.timbre} is unknown`);
  need(typeof p.pad === 'boolean', 'pad must be a boolean');
  for (const layer of LAYERS) need(inRange(p.mix?.[layer], [0, 1]), `mix.${layer} must be within 0..1`);
  need(inRange(p.rainIntensity, [0, 1]), 'rainIntensity must be within 0..1');
  need(inRange(p.oceanIntensity, [0, 1]), 'oceanIntensity must be within 0..1');
  need(TIMER_OPTIONS.includes(p.timerMinutes), `timerMinutes must be one of ${TIMER_OPTIONS.join(', ')}`);
  need(inRange(p.endFadeSeconds, END_FADE_RANGE), `endFadeSeconds must be within ${END_FADE_RANGE.join('..')}`);
  need(CHIMES.includes(p.chime), `chime must be one of ${CHIMES.join(', ')}`);
  need(p.forceMode == null || p.forceMode in BEAT_RANGE, `forceMode ${p.forceMode} is unknown`);
  need(p.glide == null || (p.glide.fromHz > 0 && p.glide.minutes > 0), 'glide needs fromHz > 0 and minutes > 0');
  need(p.catMood == null || CAT_MOODS.includes(p.catMood), `catMood must be one of ${CAT_MOODS.join(', ')}`);

  return { ok: errors.length === 0, errors };
}

/** Engine parameters for a preset in a listening setup: mode = forceMode ?? recommendMode(...), carrier = the preset's headphones value when listening on headphones and its speakers value otherwise (plan §6.5), through recommendCarrier. */
export function resolvePreset(p, { listening, device, override = 'auto' } = {}) {
  const mode = p.forceMode ?? recommendMode({ listening, beatHz: p.beatHz, override });
  const presetCarrierHz = listening === 'headphones' ? p.carrierHz.headphones : p.carrierHz.speakers;
  const carrierHz = recommendCarrier({ presetCarrierHz, mode, device, listening });
  return {
    id: p.id,
    mode,
    carrierHz,
    beatHz: p.beatHz,
    gate: gateParams(p.beatHz),
    timbre: p.timbre,
    pad: p.pad,
    mix: { ...p.mix },
    rainIntensity: p.rainIntensity,
    oceanIntensity: p.oceanIntensity,
    timerMinutes: p.timerMinutes,
    endFadeSeconds: p.endFadeSeconds,
    chime: p.chime,
    glide: p.glide ? { ...p.glide } : null,
    catMood: p.catMood ?? null,
  };
}

function inRange(value, [lo, hi]) {
  return Number.isFinite(value) && value >= lo && value <= hi;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}
