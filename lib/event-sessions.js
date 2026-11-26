export function upgradeEventSessions(state) {
  if (state.eventSessions?.length) return state;
  state.eventSessions = [{ number: 1, startedAt: null, endedAt: null }];
  for (const round of state.rounds) round.sessionNumber = 1;
  return state;
}

export const currentEventSession = state => state.eventSessions.at(-1);

export function eventSessionSummaries(state) {
  const counts = new Map();
  for (const round of state.rounds) {
    const totals = counts.get(round.sessionNumber) || { rounds: 0, responses: 0 };
    totals.rounds++;
    totals.responses += Object.keys(round.answers).length;
    counts.set(round.sessionNumber, totals);
  }
  return state.eventSessions.map(session => ({
    rounds: 0, responses: 0, ...counts.get(session.number), ...session,
  })).reverse();
}
