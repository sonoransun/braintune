// Entrance plans (v0.4 spec §3.7): a fresh session raises the layer buses one after another by mood
// (sleepy and calm open with the sea, alert leads with the tone). Silent layers drop out and the plan
// shifts to start at once. Pure: no browser globals. Times in seconds.

/** Steps per mood: the layer, when its bus starts rising and over how long (an S-curve). */
export const ENTRANCES = deepFreeze({
  sleepy: [{ layer: 'ocean', atS: 0, seconds: 3 }, { layer: 'purr', atS: 1.2, seconds: 3 }, { layer: 'tone', atS: 2.5, seconds: 4 }, { layer: 'rain', atS: 4, seconds: 4 }],
  calm: [{ layer: 'ocean', atS: 0, seconds: 2.5 }, { layer: 'tone', atS: 1.2, seconds: 3 }, { layer: 'purr', atS: 2.5, seconds: 3 }, { layer: 'rain', atS: 2.5, seconds: 3 }],
  alert: [{ layer: 'tone', atS: 0, seconds: 2 }, { layer: 'ocean', atS: 0.4, seconds: 2 }, { layer: 'rain', atS: 0.4, seconds: 2 }, { layer: 'purr', atS: 1.2, seconds: 2 }],
});

/** The mood's steps for the layers that will sound (mix > 0, not muted), shifted (to the millisecond) so the first starts at 0; an unknown mood plays calm. */
export function entrancePlan(mood, { mix, muted = {} }) {
  const steps = (ENTRANCES[mood] ?? ENTRANCES.calm).filter(({ layer }) => mix[layer] > 0 && !muted[layer]);
  const shift = Math.min(...steps.map((s) => s.atS));
  return steps.map((s) => ({ ...s, atS: Math.round((s.atS - shift) * 1000) / 1000 }));
}

/** When the session has arrived: the end of the tone's step, else of the last step to finish (0 without steps). */
export function entranceEnd(steps) {
  const tone = steps.find((s) => s.layer === 'tone');
  return tone ? tone.atS + tone.seconds : Math.max(0, ...steps.map((s) => s.atS + s.seconds));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}
