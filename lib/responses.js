export function questionFormat(question) {
  return question.format || (question.options.length ? 'choice' : 'written');
}

export function responseStats(question, answers) {
  const format = questionFormat(question);
  if (format === 'ranking') {
    const entries = question.options.map(label => ({ label, score: 0, first: 0 }));
    const stats = new Map(entries.map(entry => [entry.label, entry]));
    for (const { ranking = [] } of answers) {
      ranking.forEach((label, position) => {
        const entry = stats.get(label);
        if (entry) {
          entry.score += question.options.length - position;
          if (position === 0) entry.first++;
        }
      });
    }
    return entries.sort((a, b) => b.score - a.score || b.first - a.first);
  }
  if (format === 'choice') {
    return question.options.map(label => ({
      label, count: answers.filter(answer => answer.text === label).length,
    }));
  }
  return [];
}

export function themeCandidates(round) {
  const format = questionFormat(round.question);
  if (format !== 'choice' && format !== 'written') return [];
  return Object.entries(round.answers)
    .filter(([, text]) => format === 'written' || !round.question.options.includes(text))
    .map(([id, text]) => ({ id, text }));
}
