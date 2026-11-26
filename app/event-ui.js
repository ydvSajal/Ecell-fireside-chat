'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { answerReasons, customSlots, isInitiativeQuestion, optionKey, questionFormat, rankCount, REASON_LIMIT, REASON_MAX_LENGTH } from '../lib/responses';

const eventTitle = 'Corporate Innovation Action Lab';
const insightsTitle = 'Corporate Innovation Insights';
const avatarColors = [
  ['#d8e4ff', '#3659ab'], ['#f8dfbd', '#9b4c21'], ['#d7ebda', '#276447'], ['#f3dbe7', '#923d69'],
  ['#e4ddf8', '#644aa2'], ['#f5e8ac', '#78601c'], ['#d4ebec', '#29646c'], ['#f6d8cb', '#a94c38'],
  ['#e1ecd2', '#4d693b'], ['#f4dfe6', '#a13f62'],
];

function Avatar({ index = 0, initials = '–', waiting = false }) {
  const [background, color] = avatarColors[index % avatarColors.length];
  return <span aria-hidden="true" className={waiting ? 'avatar waiting' : 'avatar'}
    style={{ '--avatar-bg': background, '--avatar-ink': color }}>{initials}</span>;
}

function useEvent(view) {
  const [data, setData] = useState(null);
  const [connection, setConnection] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++seq.current;
    try {
      const response = await fetch('/api/event?view=' + view, { cache: 'no-store', signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error();
      const payload = await response.json();
      if (version === seq.current) {
        setData(payload);
        setConnection('');
      }
    } catch {
      if (version === seq.current) setConnection('Connection interrupted. Reconnecting…');
    }
  }, [view]);

  useEffect(() => {
    let active = true;
    let polling = false;
    let timer;
    async function poll() {
      if (polling) return;
      clearTimeout(timer);
      polling = true;
      await refresh();
      polling = false;
      if (active) timer = setTimeout(poll, document.hidden ? 3000 : 1000);
    }
    const onVisible = () => { if (!document.hidden) poll(); };
    poll();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', poll);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', poll);
      seq.current++;
    };
  }, [refresh]);

  const send = useCallback(async (action, values = {}, background = false) => {
    if (!background) setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/event', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...values, action }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Try again.');
      await refresh();
      return payload;
    } catch (failure) {
      setError(failure.message || 'Could not save. Try again.');
      return false;
    } finally {
      if (!background) setBusy(false);
    }
  }, [refresh]);

  return { data, connection, error, busy, send };
}

function Brand() {
  return <div className="brand">
    <img src="/bennett-university.png" alt="Bennett University, The Times Group" width="2284" height="745" />
    <span>Corporate Innovation Action Lab</span>
  </div>;
}

function RoundtableBanner() {
  return <header className="roundtable-banner">
    <div className="roundtable-banner-brand">
      <img className="roundtable-banner-logo" src="/bennett-university.png" width="2284" height="745"
        alt="Bennett University, The Times Group" />
      <div className="roundtable-banner-title">
        <p>Centre for Corporate Innovation</p>
        <p>High-Powered Industry–Academia Roundtable</p>
      </div>
      <div className="roundtable-banner-accreditation">
        <img src="/roundtable-banner.png" width="1193" height="285" alt="NAAC Grade A+ Accredited University" />
      </div>
    </div>
    <p className="roundtable-banner-topic"><strong>Seeding Corporate Innovation in India:</strong> Challenges &amp; Opportunities</p>
  </header>;
}

function Feedback({ event }) {
  return <>{event.connection && <p className="notice" role="status">{event.connection}</p>}
    {event.error && <p className="notice error" role="alert">{event.error}</p>}</>;
}

function values(event) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget));
}

export function Guest() {
  const event = useEvent('guest');
  const { data, busy, send } = event;
  return <main className="guest-page">
    <RoundtableBanner />
    <div className="shell guest-shell">
      {data?.guest && <div className="guest-actions">
        <button type="button" className="quiet" onClick={() => send('guest-logout')}>Sign out</button>
      </div>}
      <Feedback event={event} />
      {!data ? <p role="status">Connecting to the Action Lab…</p> : data.guest
        ? <GuestRound key={data.guest.id + '/' + (data.round?.id || 'lobby')} data={data} event={event} />
        : <section className="entry">
          <h1>Join the Action Lab</h1>
          <p>Choose your name and enter the password from your moderator.</p>
          <form onSubmit={e => send('guest-login', values(e))}>
            <label>Your name<select name="id" defaultValue="" required disabled={!data.roster.length}>
              <option value="" disabled>{data.roster.length ? 'Select your name' : 'Waiting for the guest list'}</option>
              {data.roster.map(guest => <option key={guest.id} value={guest.id}>{guest.name}</option>)}
            </select></label>
            <label>Password<input name="password" type="password" maxLength={128} autoComplete="current-password" required /></label>
            <button disabled={busy || !data.roster.length}>Join the session</button>
          </form>
        </section>}
    </div>
  </main>;
}

function GuestRound({ data, event }) {
  const { guest, round, answer } = data;
  const [draft, setDraft] = useState(null);
  const [useCustomAnswer, setUseCustomAnswer] = useState(null);
  const [customDraft, setCustomDraft] = useState(null);
  const [saved, setSaved] = useState(false);
  const options = round?.question.options || [];
  const format = round ? questionFormat(round.question) : 'written';
  const [rankingDraft, setRankingDraft] = useState(null);
  const [selectionDraft, setSelectionDraft] = useState(null);
  const [customRows, setCustomRows] = useState(null);
  const [pointsDraft, setPointsDraft] = useState(null);
  const [initiativeDraft, setInitiativeDraft] = useState(null);
  const ranking = rankingDraft ?? data.ranking ?? [];
  const selections = selectionDraft ?? data.selections ?? [];
  const rows = customRows ?? (format === 'ranking' ? data.ranking : data.selections)?.filter(item => !options.includes(item)) ?? [];
  const slots = round ? customSlots(round.question) : 0;
  const uniqueChoices = new Map(options.map(item => [optionKey(item), item]));
  for (const row of rows) {
    const item = row.trim();
    const key = optionKey(item);
    if (key && !uniqueChoices.has(key)) uniqueChoices.set(key, item);
  }
  const choices = [...uniqueChoices.values()];
  const ranks = round ? rankCount(round.question) : 0;
  const initiativeQuestion = round && isInitiativeQuestion(round.question);
  const initiative = initiativeDraft ?? data.initiative ?? '';
  const steps = pointsDraft ?? data.steps ?? [];
  const reasons = format === 'reasons';
  const pointFormat = reasons || format === 'points';
  const savedPoints = reasons ? answerReasons(data.points, answer) : data.points;
  const points = pointsDraft ?? (savedPoints?.length ? savedPoints : ['']);
  const previousCustom = Boolean(options.length && answer && !options.includes(answer));
  const customSelected = useCustomAnswer ?? previousCustom;
  const current = customSelected ? customDraft ?? (previousCustom ? answer : '') : draft ?? answer;
  const ready = format === 'ranking' ? ranking.length === ranks : format === 'multi' ? selections.length > 0
    : initiativeQuestion ? Boolean(initiative.trim()) && steps.some(step => step.trim())
      : pointFormat ? points.some(point => point.trim()) : Boolean(current.trim());
  const unchanged = format === 'ranking' ? !rankingDraft : format === 'multi' ? !selectionDraft
    : pointFormat ? !pointsDraft && initiativeDraft === null : current === answer;
  function editCustom(index, value) {
    const previous = rows[index]?.trim();
    const updated = Array.from({ length: slots }, (_, i) => i === index ? value : rows[i] || '');
    setCustomRows(updated);
    if (previous && previous !== value.trim()) {
      if (format === 'ranking') setRankingDraft(ranking.filter(item => item !== previous));
      else setSelectionDraft(selections.filter(item => item !== previous));
    }
    setSaved(false);
  }
  return <section className="entry">
    <div className="person"><Avatar index={guest.avatar} initials={guest.initials} />{guest.name}</div>
    {round ? <>
      {round.question.lab && <p className="context">{round.question.lab}</p>}
      <h1>{round.question.text}</h1>
      {round.status === 'revealed' ? <div className="entry-status">
        <p>Responses are closed. Look at the projector for the results.</p>
        {answer && <div className="saved-answer"><strong>Your answer</strong>
          <AnswerContent answer={{ text: answer, initiative: data.initiative, steps: data.steps, points: data.points, ranking: data.ranking, selections: data.selections }} />
        </div>}
      </div> : <form onSubmit={async e => {
        e.preventDefault();
        setSaved(false);
        const payload = format === 'ranking' ? { ranking } : format === 'multi' ? { selections }
          : initiativeQuestion ? { initiative, steps } : pointFormat ? { points } : { text: current };
        if (await event.send('answer', { roundId: round.id, ...payload })) setSaved(true);
      }}>
        {format === 'ranking' ? <RankingEditor options={choices} ranking={ranking} limit={ranks} onChange={items => {
          setRankingDraft(items);
          setSaved(false);
        }} /> : format === 'multi' ? <fieldset>
          <legend>Select all that apply</legend>
          {choices.map(option => <label className="option" key={option}>
            <input type="checkbox" checked={selections.includes(option)} onChange={e => {
              setSelectionDraft(e.target.checked ? [...selections, option] : selections.filter(item => item !== option));
              setSaved(false);
            }} />{option}</label>)}
        </fieldset> : initiativeQuestion ? <InitiativeEditor initiative={initiative} steps={steps} onInitiative={value => {
          setInitiativeDraft(value);
          setSaved(false);
        }} onSteps={items => {
          setPointsDraft(items);
          setSaved(false);
        }} /> : pointFormat ? <PointsEditor points={points} reasons={reasons} help={round.question.help} onChange={items => {
          setPointsDraft(items);
          setSaved(false);
        }} /> : options.length ? <fieldset>
          <legend>Choose one answer</legend>
          {options.map(option => <label className="option" key={option}>
            <input type="radio" name="choice" required checked={!customSelected && current === option} onChange={() => {
              setUseCustomAnswer(false);
              setDraft(option);
              setSaved(false);
            }} />
            {option}</label>)}
          <label className="option">
            <input type="radio" name="choice" required checked={customSelected} onChange={() => {
              setUseCustomAnswer(true);
              setSaved(false);
            }} />
            Other (write your own)
          </label>
          {customSelected && <label>Your own answer
            <textarea rows={3} maxLength={2500} value={current} onChange={e => {
              setCustomDraft(e.target.value);
              setSaved(false);
            }} required />
          </label>}
        </fieldset> : <label>Your answer
          {round.question.help && <span className="help">{round.question.help}</span>}
          <textarea rows={5} maxLength={2500} value={current} onChange={e => { setDraft(e.target.value); setSaved(false); }} required />
        </label>}
        {slots > 0 && <details className="custom-rows">
          <summary>Add your own options</summary>
          <p className="help">{format === 'ranking' ? 'Write an option here, then tap it in the list above to rank it.' : 'Write an option here, then select it in the list above.'}</p>
          {Array.from({ length: slots }, (_, index) => <label key={index}>Custom option {index + 1}
            <input value={rows[index] || ''} maxLength={240} onChange={e => editCustom(index, e.target.value)} />
          </label>)}
        </details>}
        <button disabled={event.busy || !ready}>{answer ? 'Update answer' : 'Submit answer'}</button>
        {(saved || (answer && unchanged)) && <p role="status" className="saved">Answer saved. You can edit it until the round closes.</p>}
      </form>}
    </> : <><h1>You’re in.</h1><p>The moderator’s question will appear here when the round begins.</p></>}
  </section>;
}

function RankingEditor({ options, ranking, limit, onChange }) {
  function move(index, offset) {
    const updated = [...ranking];
    [updated[index], updated[index + offset]] = [updated[index + offset], updated[index]];
    onChange(updated);
  }
  return <fieldset>
    <legend>Rank {limit === options.length ? 'all ' : 'your top '}{limit} options</legend>
    <p className="help">Tap choices in order of preference. Tap a ranked choice again to remove it.</p>
    <p className="help" role="status">{ranking.length} / {limit} ranked</p>
    {options.map(option => {
      const position = ranking.indexOf(option);
      const ranked = position >= 0;
      return <button key={option} type="button" className="rank-option" aria-pressed={ranked}
        disabled={!ranked && ranking.length >= limit}
        onClick={() => onChange(ranked ? ranking.filter(item => item !== option) : [...ranking, option])}>
        <span className="rank-marker" aria-hidden="true">{ranked ? position + 1 : '+'}</span>{option}
      </button>;
    })}
    {ranking.length > 0 && <ol className="rank-list" aria-label="Your ranking">
      {ranking.map((option, index) => <li key={option}>
        <span>{option}</span>
        <div className="actions">
          <button type="button" className="quiet arrow" aria-label={`Move ${option} up`} disabled={!index} onClick={() => move(index, -1)}>↑</button>
          <button type="button" className="quiet arrow" aria-label={`Move ${option} down`} disabled={index === ranking.length - 1} onClick={() => move(index, 1)}>↓</button>
        </div>
      </li>)}
    </ol>}

  </fieldset>;
}

function InitiativeEditor({ initiative, steps, onInitiative, onSteps }) {
  const fields = steps.length ? steps : [''];
  return <>
    <div>
      <label htmlFor="innovation-initiative">Innovation initiative</label>
      <textarea id="innovation-initiative" rows={2} maxLength={500} value={initiative} onChange={e => onInitiative(e.target.value)} required />
    </div>
    <fieldset>
      <legend>Steps</legend>
      <p className="help">Steps you would take to roll out the initiative.</p>
      {fields.map((step, index) => <div key={index}>
        <label htmlFor={`initiative-step-${index + 1}`}>Step {index + 1}</label>
        <textarea id={`initiative-step-${index + 1}`} rows={2} maxLength={500} value={step}
          onChange={e => onSteps(fields.map((item, i) => i === index ? e.target.value : item))} />
      </div>)}
      {fields.length < 5 && <button type="button" className="quiet add-point" onClick={() => onSteps([...fields, ''])}>
        <span aria-hidden="true">+ </span>Add step
      </button>}
    </fieldset>
  </>;
}

function PointsEditor({ points, reasons, help, onChange }) {
  const fields = reasons ? Array.from({ length: REASON_LIMIT }, (_, index) => points[index] || '') : points;
  return <fieldset>
    <legend>{reasons ? 'Your reasons' : 'Your commitment'}</legend>
    {(reasons || help) && <p className="help">{reasons ? 'Write one reason per box. You can give up to three.' : help}</p>}
    {fields.map((point, index) => <label key={index}>{reasons ? 'Reason' : 'Point'} {index + 1}
      <textarea rows={2} maxLength={reasons ? REASON_MAX_LENGTH : 500} value={point}
        onChange={e => onChange(fields.map((item, i) => i === index ? e.target.value : item))} />
    </label>)}
    {!reasons && points.length < 5 && <button type="button" className="quiet add-point" onClick={() => onChange([...points, ''])}>Add another point</button>}
  </fieldset>;
}

function JoinCode() {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true;
    const url = window.location.origin + '/guest';
    import('qrcode').then(QR => QR.default.toDataURL(url, {
      width: 152, margin: 2, color: { dark: '#232722', light: '#f8f7f2' },
    })).then(code => { if (active) setSrc(code); }).catch(() => {});
    return () => { active = false; };
  }, []);
  return src && <figure className="join-code"><img src={src} alt="QR code for the guest sign-in page" width="126" height="126" /><figcaption>Scan to join</figcaption></figure>;
}

function OptionResults({ stats, count, optionCount, multi, showCaption = true }) {
  const ranked = Boolean(optionCount);
  const selected = stats.filter(item => (ranked ? item.score : item.count) > 0);
  const skipped = stats.filter(item => (ranked ? item.score : item.count) === 0);
  const max = ranked ? count * optionCount : count;
  return <>
    {showCaption && multi && <p className="stage-caption">Share of respondents who selected each option</p>}
    {selected.length > 0 && <div className="tally" aria-label="Voted options">
      {selected.map(({ label, count: votes, score, first, custom }) => {
        const value = ranked ? score : votes;
        const share = max ? Math.round(value / max * 100) : 0;
        const detail = ranked ? `${score} points · ${votes} ranked · ${first} first-place` : `${votes} ${votes === 1 ? 'vote' : 'votes'}`;
        return <div key={label} className={custom ? 'vote custom-vote' : 'vote'} style={{ '--vote-share': share + '%' }} title={`${label}, ${detail}`}>
          <span className="vote-label"><span>{label}</span>{ranked && <small>{votes} ranked · {first} first-place</small>}
            {multi && <small>{votes} of {count} respondents</small>}</span>
          <strong className="vote-count" aria-label={detail}>{multi ? `${share}%` : value}</strong>
        </div>;
      })}
    </div>}
    {skipped.length > 0 && <div className="unpicked" aria-label="Options without votes">
      {skipped.map(item => <span key={item.label}>{item.label}<strong>{multi ? '0%' : '0'}</strong></span>)}
    </div>}
  </>;
}

function ResponseBoard({ answers, themes, title, onOpen, mergeExact }) {
  const grouped = new Set(themes.flatMap(group => group.ids));
  const groups = [...themes];
  if (mergeExact) {
    const exact = new Map();
    for (const answer of answers.filter(item => !grouped.has(item.id))) {
      const key = answer.text.trim().toLowerCase();
      if (!exact.has(key)) exact.set(key, { label: answer.text, ids: [] });
      exact.get(key).ids.push(answer.id);
    }
    for (const { label, ids } of exact.values()) {
      if (ids.length < 2) continue;
      groups.push({ label, ids, count: ids.length });
      ids.forEach(id => grouped.add(id));
    }
  }
  const unmatched = answers.filter(answer => !grouped.has(answer.id));
  if (!answers.length) return null;
  return <section className="response-board">
    {title && <h2>{title}</h2>}
    <div className="stage-replies">
      {groups.map(({ label, ids, count }, index) => <button type="button" className="response-card group-card"
        key={index} onClick={() => onOpen(ids)}><span>{label}</span><strong>{count}</strong></button>)}
      {unmatched.map(answer => answer.initiative
        ? <button type="button" className="response-card initiative-card" key={answer.id} onClick={() => onOpen([answer.id])}>
          <span>{answer.initiative}<small>View steps</small></span>
        </button>
        : <button type="button" className="response-card" key={answer.id} onClick={() => onOpen([answer.id])}>
        <Avatar index={answer.avatar} initials={answer.initials} />
        <span>{answer.points?.[0] ?? answer.text}{answer.points?.length > 1 && <small>{answer.points.length} points</small>}</span>
      </button>)}
    </div>
  </section>;
}

function AnswerContent({ answer }) {
  if (answer.initiative) return <div className="initiative-detail">
    <strong>{answer.initiative}</strong>
    {answer.steps?.length > 0
      ? <ol className="answer-points">{answer.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
      : <p>No steps were provided.</p>}
  </div>;
  if (answer.selections?.length) return <ul className="answer-points">
    {answer.selections.map(text => <li key={text}>{text}</li>)}
  </ul>;
  const entries = answer.points?.length ? answer.points : answer.ranking;
  return entries?.length
    ? <ol className="answer-points">{entries.map((text, index) => <li key={index}>{text}</li>)}</ol>
    : <p>{answer.text}</p>;
}

export function Projector() {
  const { data, connection } = useEvent('projector');
  const round = data?.round;
  const [selected, setSelected] = useState([]);
  const [insightsRound, setInsightsRound] = useState(null);
  const insightsButton = useRef(null);
  useEffect(() => { setSelected([]); }, [round?.id, round?.spotlight]);
  const shown = round && (round.live || round.status === 'revealed');
  const projected = round?.answers.find(item => item.id === round.spotlight);
  const focused = projected ? [projected] : (round?.answers.filter(answer => selected.includes(answer.id)) || []);
  const format = round ? questionFormat(round.question) : 'written';
  const options = round?.question.options || [];
  const written = round?.answers.filter(answer => format !== 'ranking' && format !== 'multi' && (format !== 'choice' || !options.includes(answer.text))) || [];
  const themes = round?.analysis?.themes || [];
  const optionCount = format === 'ranking' ? rankCount(round.question) : 0;
  const stats = round?.stats || [];
  const presetStats = stats.filter(item => !item.custom);
  const customStats = stats.filter(item => item.custom);
  const total = data?.guestCount || 0;
  const joined = data?.ready.length ?? 0;
  const answered = data?.answeredCount ?? 0;
  const showResults = Boolean(shown && (options.length || round.count));
  const insightsOpen = showResults && insightsRound === round.id;
  function closeInsights() {
    setInsightsRound(null);
    insightsButton.current?.focus();
  }
  return <main className="projection">
    <RoundtableBanner />
    <div className="stage-screen">
      {connection && <p className="stage-notice" role="status">{connection}</p>}
      {!data ? <p className="stage-loading" role="status">Connecting to the Action Lab…</p> : !round
        ? <section className="lobby">
          <h1>Take your seat.</h1>
          <p className="stage-sub">Scan to join the Corporate Innovation Action Lab.</p>
          <div className="avatar-board">
            {data.ready.map(guest => <Avatar key={guest.id} index={guest.avatar} initials={guest.initials} />)}
            {data.waiting?.map(guest => <Avatar key={guest.id} index={guest.avatar} initials={guest.initials} waiting />)}
          </div>
          <p className="ready" aria-live="polite">{total ? `${data.ready.length} of ${total} guests ready` : 'Waiting for guests'}</p>
          <JoinCode />
        </section>
        : <section className={'stage-round' + (showResults ? '' : ' stage-waiting')}>
          <div className="stage-question">
            {round.question.lab && <p className="stage-context">{round.question.lab}</p>}
            <h1 className={format === 'reasons' || round.question.text.length > 105 ? 'long-question' : undefined}>{round.question.text}</h1>
          </div>
          <div className="stage-tools">
            <p className="stage-count" role="status" aria-label={`${answered} answered out of ${joined} guests who joined`}>{answered} / {joined}</p>
            {showResults && <button type="button" className="insights-toggle" ref={insightsButton}
              aria-expanded={insightsOpen} aria-controls={insightsOpen ? 'corporate-innovation-insights' : undefined}
              onClick={() => insightsOpen ? closeInsights() : setInsightsRound(round.id)}>
              {insightsTitle} <span aria-hidden="true">{insightsOpen ? '−' : '+'}</span>
            </button>}
          </div>
          {showResults && <div className={insightsOpen ? 'projection-results has-insights' : 'projection-results'}>
            {format === 'reasons' ? <ReasonResults key={round.id} round={round} /> : <div className="results">
              {options.length > 0 ? <>
                <section className="option-section" aria-label="Preset options">
                  <OptionResults stats={presetStats} count={round.count} optionCount={optionCount} multi={format === 'multi'} />
                </section>
                <section className="option-section custom-section" aria-label="Custom answers">
                  {customStats.length > 0 ? <OptionResults stats={customStats} count={round.count}
                    optionCount={optionCount} multi={format === 'multi'} showCaption={false} />
                    : written.length > 0 ? <ResponseBoard answers={written} themes={themes} onOpen={setSelected} mergeExact />
                      : <p className="stage-caption">No custom answers yet.</p>}
                </section>
              </> : <ResponseBoard answers={written} themes={format === 'points' ? [] : themes} onOpen={setSelected}
                title={format === 'points' ? 'Action board' : themes.length ? 'Emerging themes and responses' : null} />}
            </div>}
            {insightsOpen && <ProjectorAnalysis round={round} onClose={closeInsights} />}
          </div>}
          {!shown && <p className="stage-sub">{round.status === 'open' ? 'Send your answer from your phone.' : ''}</p>}
          {focused.length > 0 && <div className="spotlight" role="dialog" aria-modal="false" aria-label="Spotlighted response">
            {focused.map(answer => <div className="spotlight-answer" key={answer.id}>
              {!answer.initiative && <Avatar index={answer.avatar} initials={answer.initials} />}
              <AnswerContent answer={answer} />
            </div>)}
            {!projected && <button type="button" className="quiet" onClick={() => setSelected([])}>Back to responses</button>}
          </div>}
        </section>}
    </div>
  </main>;
}

function ReasonResults({ round }) {
  const [selected, setSelected] = useState(null);
  const reasons = round.answers.flatMap(answer => answerReasons(answer.points, answer.text)
    .map((text, index) => ({ id: `${answer.id}:${index}`, text })));
  const active = reasons.find(reason => reason.id === selected);
  const columns = Math.min(5, Math.max(2, Math.ceil(reasons.length / 9)));
  return <>
    <section aria-label="Submitted reasons">
      <h2>{reasons.length} {reasons.length === 1 ? 'reason' : 'reasons'}</h2>
      <div className="reason-grid" style={{ '--reason-columns': columns }}>
        {reasons.map(reason => <button type="button" className="response-card reason-card" key={reason.id}
          onClick={() => setSelected(reason.id)}><span>{reason.text}</span></button>)}
      </div>
    </section>
    {active && !round.spotlight && <div className="spotlight" role="dialog" aria-label="Full reason">
      <p>{active.text}</p>
      <button type="button" className="quiet" onClick={() => setSelected(null)}>Back to reasons</button>
    </div>}
  </>;
}

function AnalysisContent({ analysis }) {
  return <>
    {analysis.takeaway && <p className="analysis-takeaway">{analysis.takeaway}</p>}
    {analysis.themes?.length > 0 && <div className="analysis-themes">
      <h3>Recurring themes</h3>
      <ul>{analysis.themes.map(theme => <li key={theme.ids[0]}><span>{theme.label}</span>
        <strong>{theme.count} guests</strong></li>)}</ul>
    </div>}
    {analysis.observations?.length > 0 && <div className="analysis-observations">
      <h3>What the results suggest</h3>
      <ul>{analysis.observations.map(observation => <li key={observation}>{observation}</li>)}</ul>
    </div>}
    {analysis.nextStep && <div><h3>For discussion</h3><p>{analysis.nextStep}</p></div>}
  </>;
}

function ProjectorAnalysis({ round: { analysis, analysisStatus, status, count }, onClose }) {
  const closeButton = useRef(null);
  useEffect(() => { closeButton.current?.focus(); }, []);
  return <aside className="projector-analysis analysis-content" id="corporate-innovation-insights" aria-labelledby="corporate-innovation-insights-title"
    onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    <div className="insights-heading">
      <h2 id="corporate-innovation-insights-title">{insightsTitle}</h2>
      <button type="button" className="quiet" ref={closeButton} onClick={onClose}>Close</button>
    </div>
    <div className="insights-body" tabIndex={0} aria-label="Insight details">
      <div role="status">
        {analysisStatus === 'running' ? <p>Reviewing the responses…</p>
          : analysisStatus === 'failed' ? <p>Analysis unavailable. The moderator can retry.</p>
            : !analysis && <p>{status === 'open' ? 'Analysis starts when the round closes.'
              : count ? 'The moderator can generate analysis.' : 'No responses to analyse.'}</p>}
      </div>
      {analysis && <AnalysisContent analysis={analysis} />}
    </div>
  </aside>;
}

function Editor({ question, event, onClose }) {
  const [text, setText] = useState(question?.text || '');
  const [format, setFormat] = useState(question?.format === 'written' ? 'standard' : question?.format || 'standard');
  const [dictation, setDictation] = useState('');
  const recognition = useRef(null);
  useEffect(() => () => recognition.current?.abort(), []);
  function speak() {
    if (recognition.current) { recognition.current.stop(); return; }
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) { setDictation('Dictation is unavailable in this browser. Type the question below.'); return; }
    const active = new Speech();
    recognition.current = active;
    active.lang = 'en-IN';
    active.onresult = e => setText(old => [old, e.results[0][0].transcript].filter(Boolean).join(' ').slice(0, 600));
    active.onerror = () => setDictation('Could not capture speech. Type the question or try again.');
    active.onend = () => { recognition.current = null; setDictation(old => old === 'Listening…' ? '' : old); };
    try { active.start(); setDictation('Listening…'); } catch { recognition.current = null; setDictation('Could not start dictation.'); }
  }
  return <form className="editor" onSubmit={async e => {
    const fields = values(e);
    if (await event.send('question-save', {
      id: question?.id, text: fields.text, lab: fields.lab, format, options: (fields.options || '').split(/\r?\n/),
    })) onClose();
  }}>
    <label>Question<textarea name="text" rows={3} maxLength={600} value={text} onChange={e => setText(e.target.value)} required /></label>
    <div className="actions"><button type="button" className="quiet" onClick={speak}>{dictation === 'Listening…' ? 'Stop dictation' : 'Dictate question'}</button>
      {dictation && <span role="status">{dictation}</span>}</div>
    <label>Lab name<input name="lab" defaultValue={question?.lab || ''} maxLength={140} /></label>
    <label>Answer format<select value={format} onChange={e => setFormat(e.target.value)}>
      <option value="standard">Multiple choice or written</option>
      <option value="ranking">Ranking</option>
      <option value="multi">Select multiple</option>
      <option value="reasons">Written · up to three reasons</option>
      <option value="points">Action board · up to five points</option>
    </select></label>
    {format !== 'points' && format !== 'reasons' && <label>Choices <span className="help">{format === 'ranking' ? 'Enter the choices to rank, one per line.' : 'One per line. Leave blank for a written answer.'}</span>
      <textarea name="options" rows={4} defaultValue={question?.options.join('\n') || ''} />
    </label>}
    <div className="actions"><button disabled={event.busy}>Save question</button><button type="button" className="quiet" onClick={onClose}>Cancel</button></div>
  </form>;
}

function GuestEditor({ guest, event, onClose }) {
  return <form className="editor" onSubmit={async e => {
    if (await event.send('guest-save', { ...values(e), id: guest?.id })) onClose();
  }}>
    <label>Guest name<input name="name" maxLength={80} defaultValue={guest?.name || ''} required /></label>
    <label>{guest ? 'New password (optional)' : 'Guest password'}<input name="password" type="password" maxLength={128} autoComplete="new-password" required={!guest} /></label>
    <div className="actions"><button disabled={event.busy}>{guest ? 'Save guest' : 'Add guest'}</button>
      <button type="button" className="quiet" onClick={onClose}>Cancel</button></div>
  </form>;
}

function GeminiEditor({ settings, event }) {
  const [message, setMessage] = useState('');
  const source = {
    admin: 'Using the key saved here.',
    environment: 'Using the key configured on the server.',
    none: 'No API key configured.',
  }[settings.keySource];
  return <section className="panel">
    <h2>Gemini settings</h2>
      <p>{source} Gemini analyses votes, rankings and written answers after a round closes.</p>
    {!settings.canStoreKey && <p className="help">Set SETTINGS_ENCRYPTION_KEY on the server to save a key here.</p>}
    <form className="editor" key={settings.model + '/' + settings.keySource} onSubmit={async e => {
      const form = e.currentTarget;
      const fields = values(e);
      setMessage('');
      if (await event.send('gemini-save', fields)) {
        form.elements.namedItem('key').value = '';
        setMessage('Gemini settings saved.');
      }
    }}>
      <label>Model ID<input name="model" defaultValue={settings.model} maxLength={100} autoComplete="off" /></label>
      <label>New API key <span className="help">Leave blank to use the saved key. The test uses the key and model in this form.</span>
        <input name="key" type="password" maxLength={2048} autoComplete="new-password" />
      </label>
      <div className="actions">
        <button disabled={event.busy}>Save Gemini settings</button>
        <button type="button" className="quiet" disabled={event.busy} onClick={async e => {
          const fields = Object.fromEntries(new FormData(e.currentTarget.form));
          setMessage('Testing connection…');
          const result = await event.send('gemini-test', fields);
          setMessage(result ? 'Connection successful. Gemini responded using this model.' : '');
        }}>Test connection</button>
        {settings.keySource === 'admin' && <button type="button" className="quiet danger" disabled={event.busy} onClick={async () => {
          if (!window.confirm('Remove the key saved in Admin?')) return;
          setMessage('');
          if (await event.send('gemini-remove-key')) setMessage('Saved key removed.');
        }}>Remove saved key</button>}
      </div>
    </form>
    {message && <p className="saved" role="status">{message}</p>}
  </section>;
}

export function Admin() {
  const event = useEvent('admin');
  const { data, send, busy } = event;
  const [tab, setTab] = useState('round');
  const [question, setQuestion] = useState(null);
  const [guest, setGuest] = useState(null);
  const [chosen, setChosen] = useState('');
  const [live, setLive] = useState(null);
  const round = data?.round;
  const guests = data?.guests?.filter(item => item.enabled) || [];
  const questions = data?.questions || [];
  const activeIndex = questions.findIndex(item => item.id === round?.question.id);
  const currentQuestion = questions[activeIndex];
  const currentId = currentQuestion?.id;
  const currentMatches = currentQuestion && round &&
    ['text', 'lab', 'format', 'rankLimit', 'maxOptions', 'help'].every(field => currentQuestion[field] === round.question[field]) &&
    JSON.stringify(currentQuestion.options) === JSON.stringify(round.question.options);
  const selection = questions.find(item => item.id === chosen)?.id || currentId || questions[0]?.id || '';
  const showLive = live ?? round?.live ?? false;
  const manage = (action, settings = {}) => send(action, { ...settings, roundId: round?.id ?? null });
  async function publish(id) {
    if (await manage('publish', { id, live: showLive })) {
      setChosen('');
      setLive(null);
    }
  }
  return <main className="shell">
    <header className="app-header"><Brand />{data?.authenticated && <div className="actions">
      <a href="/projector" target="_blank" rel="noreferrer">Open projector ↗</a>
      <button type="button" className="quiet" onClick={() => send('admin-logout')}>Sign out</button>
    </div>}</header>
    <Feedback event={event} />
    {!data ? <p role="status">Connecting to the Action Lab…</p> : !data.authenticated
      ? <section className="entry"><h1>Moderator sign-in</h1><p>{eventTitle}</p>
        <form onSubmit={e => send('admin-login', values(e))}>
          <label>Username<input autoComplete="username" name="username" required /></label>
          <label>Password<input autoComplete="current-password" name="password" type="password" required /></label>
          <button disabled={busy}>Sign in</button>
        </form>
      </section>
      : <>
        <h1 className="console-title">Moderator console</h1>
        <nav className="admin-tabs" aria-label="Moderator sections">
          {[['round', 'Live session'], ['questions', `Questions (${data.questions.length})`], ['guests', `Guests (${guests.length})`], ['stats', 'Results'], ['settings', 'Settings']].map(([key, name]) =>
            <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} className="quiet" onClick={() => setTab(key)}>{name}</button>)}
        </nav>
        {tab === 'round' && <div className="console-grid">
          <section className="panel">
            <h2>{round?.status === 'open' ? 'Question on screen' : 'Publish a question'}</h2>
            {round && <div className={'current' + (round.status === 'open' ? ' open-round' : '')}>
              <p className="context">{round.status === 'open' ? 'Collecting responses' : 'Round closed'}</p>
              <h3>{round.question.text}</h3>
              <p className="metric">{round.count} of {Math.max(round.count, guests.length)} responded</p>
              <div className="actions">
                {round.status === 'open' ? <button disabled={busy} onClick={() => manage('reveal')}>Close and reveal</button>
                  : <><button className="quiet" disabled={busy} onClick={() => manage('lobby')}>Return to lobby</button>
                    {data.gemini.keySource !== 'none' && <AnalysisButton round={round} busy={busy} send={send} />}</>}
              </div>
              {round.canAnalyse && data.gemini.keySource === 'none' && <p className="help">Add a Gemini key in Settings to analyse responses.</p>}
              {round.analysisStatus === 'failed' && <p className="help" role="status">Gemini analysis was unavailable.</p>}
            </div>}
            <form className={round ? 'question-controls' : undefined} onSubmit={e => { e.preventDefault(); publish(selection); }}>
              {round && <div className="actions">
                <button type="button" className="quiet" disabled={busy || activeIndex <= 0}
                  onClick={() => publish(questions[activeIndex - 1].id)}>Previous question</button>
                <button type="button" className="quiet" disabled={busy || activeIndex < 0 || activeIndex >= questions.length - 1}
                  onClick={() => publish(questions[activeIndex + 1].id)}>Next question</button>
              </div>}
              <label>{round ? 'Jump to question' : 'Question'}<select value={selection} onChange={e => setChosen(e.target.value)} required>
                {!questions.length && <option value="">Add a question first</option>}
                {questions.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.text}</option>)}
              </select></label>
              <label className="check"><input type="checkbox" checked={showLive} onChange={e => setLive(e.target.checked)} /> Show responses live when publishing</label>
              <button disabled={busy || !selection || (selection === currentId && currentMatches)}>{round ? 'Switch to selected question' : 'Publish question'}</button>
            </form>
          </section>
          <ResponseFeed key={round?.id || 'lobby'} round={round} guests={guests} busy={busy} manage={manage} />
        </div>}
        {tab === 'questions' && <section className="panel">
          <div className="section-head"><h2>Question order</h2><button onClick={() => setQuestion({})}>Add question</button></div>
          {question && <Editor key={question.id || 'new'} question={question.id ? question : null} event={event} onClose={() => setQuestion(null)} />}
          {data.questions.map((item, index) => <div className="list-row question-row" key={item.id}>
            <span className="ordinal">{index + 1}</span>
            <div className="row-copy"><strong>{item.text}</strong><p>{[item.lab, item.format === 'reasons' ? 'Three reasons' : item.format === 'points' ? 'Action board' : item.format === 'ranking' ? 'Ranking' : item.format === 'multi' ? 'Select multiple' : item.options.length ? `Poll · ${item.options.length} choices` : 'Written response'].filter(Boolean).join(' · ')}</p></div>
            <div className="actions">
              <button className="quiet arrow" aria-label={`Move question ${index + 1} up`} disabled={busy || index === 0} onClick={() => send('question-move', { id: item.id, direction: 'up' })}>↑</button>
              <button className="quiet arrow" aria-label={`Move question ${index + 1} down`} disabled={busy || index + 1 === data.questions.length} onClick={() => send('question-move', { id: item.id, direction: 'down' })}>↓</button>
              <button className="quiet" onClick={() => { setQuestion(item); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>
              <button className="quiet danger" disabled={busy} onClick={async () => {
                if (window.confirm('Remove this question from the question list?') && await send('question-remove', { id: item.id })) {
                  if (chosen === item.id) setChosen('');
                  if (question?.id === item.id) setQuestion(null);
                }
              }}>Remove</button>
            </div>
          </div>)}
        </section>}
        {tab === 'guests' && <section className="panel">
          <div className="section-head"><h2>Guest access</h2><button onClick={() => setGuest({})}>Add guest</button></div>
          {guest && <GuestEditor key={guest.id || 'new'} guest={guest.id ? guest : null} event={event} onClose={() => setGuest(null)} />}
          {!guests.length && !guest && <p>Add each guest’s name and password. Their names will appear in the sign-in list.</p>}
          {guests.map(item => <div className="list-row" key={item.id}>
            <span className="person"><Avatar index={item.avatar} initials={item.initials} />{item.name}</span>
            <span className="state">{item.joined ? 'Ready' : 'Not joined'}</span>
            <div className="actions"><button className="quiet" onClick={() => setGuest(item)}>Edit</button>
              <button className="quiet danger" disabled={busy} onClick={async () => {
                if (window.confirm(`Remove access for ${item.name}?`) && await send('guest-remove', { id: item.id }) && guest?.id === item.id) setGuest(null);
              }}>Remove</button></div>
          </div>)}
        </section>}
        {tab === 'settings' && <div className="console-grid">
          <SharedGuestPassword event={event} count={guests.length} />
          <GeminiEditor settings={data.gemini} event={event} />
        </div>}
        {tab === 'stats' && <section className="panel">
          <div className="section-head">
            <h2>Round results</h2>
            <div className="actions">
              {Boolean(data.archivedCount) && <button className="quiet" disabled={busy} onClick={() => manage('results-restore')}>Restore cleared results</button>}
              {(round || data.history.length > 0) && <button className="quiet danger" disabled={busy} onClick={() => {
                if (window.confirm('Clear the results and return the projector to the lobby? You can restore the results afterward.')) manage('results-clear');
              }}>Clear results</button>}
            </div>
          </div>
          {[...(round ? [{ ...round, text: round.question.text }] : []), ...data.history].map(item =>
            <Result key={item.id} round={item} busy={busy} send={send} hasKey={data.gemini.keySource !== 'none'} />)}
          {!round && !data.history.length && <p>Published rounds will appear here with response totals.</p>}
        </section>}
      </>}
  </main>;
}

function ResponseFeed({ round, guests, busy, manage }) {
  const [filter, setFilter] = useState('');
  const answers = round?.answers || [];
  const stats = round?.stats || [];
  const format = round ? questionFormat(round.question) : null;
  const names = new Map(guests.map(guest => [guest.id, guest.name]));
  const getName = id => names.get(id) || 'Former guest';
  const filtered = filter ? answers.filter(answer => answer.id === filter) : answers;
  const selectedIndex = answers.findIndex(answer => answer.id === round?.spotlight);
  const canSpotlight = round && (round.live || round.status === 'revealed');
  const showAnswer = id => manage('spotlight', { id });
  return <section className="panel">
    <h2>{round ? 'Live response feed' : 'Guest readiness'}</h2>
    {!round ? <>
      {!guests.length && <p>Add guests in the Guests tab.</p>}
      {guests.map(guest => <div className="list-row" key={guest.id}>
        <span className="person"><Avatar index={guest.avatar} initials={guest.initials} />{guest.name}</span>
        <span className="state">{guest.joined ? 'Ready' : 'Not joined'}</span>
      </div>)}
    </> : <>
      <p className="metric">{round.count} answered · {guests.filter(guest => guest.joined).length} joined</p>
      {stats.length > 0 && <details className="response-stats" open>
        <summary>Question stats</summary>
        {stats.map(stat => <div className="stat-line" key={stat.label}>
          <span>{stat.label}</span><strong>{stat.score === undefined ? format === 'multi' ? `${round.count ? Math.round(stat.count / round.count * 100) : 0}% · ${stat.count}` : stat.count : `${stat.score} pts · ${stat.count} ranked · ${stat.first} first`}</strong>
        </div>)}
        {questionFormat(round.question) === 'choice' && <div className="stat-line">
          <span>Custom responses</span><strong>{answers.length - stats.reduce((sum, stat) => sum + stat.count, 0)}</strong>
        </div>}
      </details>}
      {round.analysis && <details className="response-stats analysis-content" open>
        <summary>Gemini analysis</summary>
        <AnalysisContent analysis={round.analysis} />
      </details>}
      {answers.length > 0 ? <>
        <label>Filter by guest<select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">All guests</option>
          {answers.map(answer => <option key={answer.id} value={answer.id}>{getName(answer.id)}</option>)}
        </select></label>
        <div className="actions slideshow-controls">
          <button className="quiet" disabled={busy || !canSpotlight || selectedIndex < 1}
            onClick={() => showAnswer(answers[selectedIndex - 1].id)}>Previous answer</button>
          <button className="quiet" disabled={busy || !canSpotlight || selectedIndex >= answers.length - 1}
            onClick={() => showAnswer(answers[selectedIndex + 1].id)}>{selectedIndex < 0 ? 'Start slideshow' : 'Next answer'}</button>
          {selectedIndex >= 0 && <><button className="quiet" disabled={busy} onClick={() => showAnswer(null)}>End slideshow</button>
            <span className="state" role="status">{selectedIndex + 1} / {answers.length} on screen</span></>}
        </div>
        {!canSpotlight && <p className="help">Reveal this round or publish with live responses to show answers on the projector.</p>}
        {filtered.map(answer => <div className="list-row" key={answer.id}>
          <div className="row-copy">
            <div className="person"><Avatar index={answer.avatar} initials={answer.initials} />{getName(answer.id)}</div>
            <div className="row-answer"><AnswerContent answer={answer} /></div>
          </div>
          <button className="quiet" disabled={busy || !canSpotlight} onClick={() => showAnswer(round.spotlight === answer.id ? null : answer.id)}>
            {round.spotlight === answer.id ? 'Clear spotlight' : 'Show on projector'}
          </button>
        </div>)}
      </> : <p>No answers yet.</p>}
    </>}
  </section>;
}

function SharedGuestPassword({ event, count }) {
  const [message, setMessage] = useState('');
  return <section className="panel">
    <h2>Shared guest password</h2>
    <p>Updates the password for everyone currently on the guest list. Signed-in guests will need to sign in again.</p>
    <form className="editor" onSubmit={async e => {
      const form = e.currentTarget;
      const fields = values(e);
      setMessage('');
      const result = await event.send('guest-password-all', fields);
      if (result) {
        form.reset();
        setMessage(`Updated the password for ${result.updated} guests.`);
      }
    }}>
      <label>New guest password<input name="password" type="password" maxLength={128} autoComplete="new-password" required /></label>
      <button disabled={event.busy || !count}>Update all guest passwords</button>
    </form>
    {message && <p className="saved" role="status">{message}</p>}
  </section>;
}

function AnalysisButton({ round, busy, send }) {
  if (!round.canAnalyse) return null;
  const running = round.analysisStatus === 'running';
  return <button type="button" className="quiet" disabled={busy || running} onClick={() => send('analyse', { roundId: round.id })}>
    {running ? 'Analysing responses…' : round.analysisStatus === 'failed' ? 'Retry analysis' : round.analysis ? 'Refresh analysis' : 'Generate analysis'}
  </button>;
}

function Result({ round, busy, send, hasKey }) {
  const { text, count, analysis } = round;
  return <article className="list-row">
    <div className="row-copy"><strong>{text}</strong>
      {analysis && <details className="analysis-content"><summary>Gemini analysis</summary><AnalysisContent analysis={analysis} /></details>}
    </div>
    <div className="actions">
      <span className="state">{count} {count === 1 ? 'response' : 'responses'}</span>
      {hasKey && <AnalysisButton round={round} busy={busy} send={send} />}
    </div>
  </article>;
}
