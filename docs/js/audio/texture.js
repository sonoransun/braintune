// The texture planner (v0.4 spec §3.4): one more planner on the engine's scheduler, 4 s ahead. Each
// window sets the pad bus level and pad low-pass at the texture knots (setTargetAtTime only, so a
// re-plan after a resume converges from wherever they are) and plans a snapshot per whole second.

import { planTextureEvents, textureSnapshot } from '../core/texture-model.js';
import { applyEvents } from './automation.js';

/** The planner { plannedUpTo, horizon, plan, apply, reset }: `params` holds the padBus and padFilter AudioParams, `nominal()` → { padBus, padFilterHz } (read per window), `onSnapshot(at, { pad, gust, set })`. */
export function createTexturePlanner({ texture, params, nominal, onSnapshot, horizon = 4 }) {
  const every = texture.recipe.snapshotEvery;
  return {
    plannedUpTo: 0,
    horizon,
    plan(from, to) {
      const items = [{ at: from, events: planTextureEvents(texture, nominal(), from, to) }];
      for (let k = Math.ceil(from / every) * every; k < to; k += every) items.push({ at: k, snapshot: textureSnapshot(texture, k) });
      return items;
    },
    apply(item) {
      if (item.events) applyEvents(params, item.events);
      else onSnapshot(item.at, item.snapshot);
    },
    reset() {},
  };
}
