export function questionFormat(question) {
  return question.format || (question.options.length ? 'choice' : 'written');
}

export const optionKey = text => text.trim().toLowerCase();
export const rankCount = question => Math.min(question.rankLimit ?? question.options.length, question.options.length);
export const customSlots = question => Math.max(0, (question.maxOptions ?? question.options.length) - question.options.length);

export function responseStats(question, answers) {
  const format = questionFormat(question);
  if (format === 'choice') return question.options.map(label => ({
    label, count: answers.filter(answer => answer.text === label).length,
  }));
  if (format !== 'ranking' && format !== 'multi') return [];

  const ranked = format === 'ranking';
  const makeEntry = (label, custom = false) => ranked
    ? { label, custom, score: 0, first: 0 }
    : { label, custom, count: 0 };
  const stats = new Map(question.options.map(label => [optionKey(label), makeEntry(label)]));
  const limit = rankCount(question);
  for (const answer of answers) {
    const choices = (ranked ? answer.ranking : answer.selections) || [];
    choices.forEach((label, position) => {
      const key = optionKey(label);
      if (!stats.has(key)) stats.set(key, makeEntry(label, true));
      const entry = stats.get(key);
      if (ranked) {
        entry.score += limit - position;
        if (position === 0) entry.first++;
      } else {
        entry.count++;
      }
    });
  }
  const results = [...stats.values()];
  return ranked ? results.sort((a, b) => b.score - a.score || b.first - a.first) : results;
}

export function themeCandidates(round) {
  const format = questionFormat(round.question);
  if (format !== 'choice' && format !== 'written') return [];
  return Object.entries(round.answers)
    .filter(([, text]) => format === 'written' || !round.question.options.includes(text))
    .map(([id, text]) => ({ id, text }));
}
