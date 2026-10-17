// Lookahead planning helpers for the audio scheduler. Pure: times are context seconds passed in.

/** Next planning range [from, to], or null when planning already covers nowT + lookahead. */
export function horizonWindow(nowT, plannedUpTo, lookahead) {
  const to = nowT + lookahead;
  if (plannedUpTo >= to) return null;
  const from = plannedUpTo > nowT ? plannedUpTo : nowT;
  return [from, to];
}

/** Keeps only the events whose time has not passed yet. */
export function pruneStale(events, nowT) {
  return events.filter((event) => event.at >= nowT);
}
