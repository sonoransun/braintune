// Attune sweep: a ping-pong carrier sweep between two frequencies (§5). Pure.

/** Leg index and in-leg phase of a ping-pong sweep with legs of `seconds` → { leg, phase ∈ [0, 1) }. */
export function sweepLeg(elapsedS, seconds) {
  if (!(seconds > 0)) throw new RangeError('sweep leg length must be > 0');
  if (!(elapsedS > 0)) return { leg: 0, phase: 0 };
  const leg = Math.floor(elapsedS / seconds);
  return { leg, phase: (elapsedS - leg * seconds) / seconds };
}

/** Hz at elapsedS: even legs run fromHz → toHz, odd legs back; 'exp' is geometric, 'lin' linear. */
export function sweepValueAt(elapsedS, fromHz, toHz, seconds, kind = 'exp') {
  const { leg, phase } = sweepLeg(elapsedS, seconds);
  const t = leg % 2 === 0 ? phase : 1 - phase;
  if (kind === 'exp') return fromHz * (toHz / fromHz) ** t;
  if (kind === 'lin') return fromHz + (toHz - fromHz) * t;
  throw new RangeError(`Unknown sweep kind: ${kind}`);
}
