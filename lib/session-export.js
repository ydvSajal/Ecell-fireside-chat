import writeExcelFile from 'write-excel-file/node';

function sheet(name, columns, rows) {
  const headings = columns.map(([value]) => ({
    value, fontWeight: 'bold', textColor: '#ffffff', backgroundColor: '#123d68',
  }));
  const cells = rows.map(row => row.map(value => value == null ? null : {
    value, type: typeof value === 'number' ? Number : String, alignVertical: 'top', wrap: true,
  }));
  return { sheet: name, columns: columns.map(([, width]) => ({ width })), stickyRowsCount: 1, data: [headings, ...cells] };
}

export function exportSession(rounds) {
  const numbered = rounds.map((round, index) => ({ ...round, number: index + 1 }));

  const summary = sheet('Rounds', [
    ['Round', 9], ['Pulse', 11], ['Question', 53], ['Responses', 13], ['Opened (UTC)', 25],
    ['Closed (UTC)', 25], ['Status', 13], ['Analysis status', 17], ['Takeaway', 55],
    ['Observations', 55], ['Discussion prompt', 47],
  ], numbered.map(round => [
    round.number, round.question.lab, round.question.text, round.count, round.openedAt,
    round.closedAt, round.status === 'open' ? 'Open' : 'Closed', round.analysisStatus || (round.analysis ? 'ready' : ''),
    round.analysis?.takeaway, round.analysis?.observations?.join('\n'), round.analysis?.nextStep,
  ]));

  const responses = sheet('Guest responses', [
    ['Round', 9], ['Pulse', 11], ['Guest', 30], ['Response', 70], ['Initiative', 52], ['Steps', 60],
  ], numbered.flatMap(round => round.answers.map(answer => [
    round.number, round.question.lab, answer.name, answer.text, answer.initiative,
    answer.steps?.map((step, index) => `${index + 1}. ${step}`).join('\n'),
  ])));

  const themes = sheet('Insight themes', [
    ['Round', 9], ['Pulse', 11], ['Theme', 60], ['Guests', 12],
  ], numbered.flatMap(round => (round.analysis?.themes || []).map(theme => [
    round.number, round.question.lab, theme.label, theme.count,
  ])));

  return writeExcelFile([summary, responses, themes]).toBuffer();
}
