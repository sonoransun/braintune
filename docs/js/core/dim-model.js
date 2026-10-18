// Night dim stages (v0.4 spec §5.1.8): after a minute without input the screen dims ('night'), after five it settles
// further ('deep'). Pure: the caller measures how long it has been still.

/** Stillness in ms before each stage. */
export const DIM_STAGES = Object.freeze({ night: 60e3, deep: 300e3 });

/** The stage for idleMs of stillness: 'none' below stages.night, 'night' below stages.deep, else 'deep'. */
export function dimStage(idleMs, stages = DIM_STAGES) {
  if (!(idleMs >= stages.night)) return 'none';
  return idleMs >= stages.deep ? 'deep' : 'night';
}

/** Further stillness in ms until the next stage begins, or null once the deep stage has. */
export function nextDimInMs(idleMs, stages = DIM_STAGES) {
  const idle = Number.isFinite(idleMs) ? Math.max(0, idleMs) : 0;
  if (idle < stages.night) return stages.night - idle;
  return idle < stages.deep ? stages.deep - idle : null;
}
