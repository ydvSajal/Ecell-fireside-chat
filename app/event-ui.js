'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { questionFormat } from '../lib/responses';

const eventTitle = 'Corporate Innovation Action Lab';
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
  return <div className="brand"><span className="mark" aria-hidden="true" />Ecell BU</div>;
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
  return <main className="shell guest-shell">
    <header className="app-header"><Brand />
      {data?.guest && <button type="button" className="quiet" onClick={() => send('guest-logout')}>Sign out</button>}
    </header>
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
  const [pointsDraft, setPointsDraft] = useState(null);
  const ranking = rankingDraft ?? data.ranking ?? [];
  const points = pointsDraft ?? (data.points?.length ? data.points : ['']);
  const previousCustom = Boolean(options.length && answer && !options.includes(answer));
  const customSelected = useCustomAnswer ?? previousCustom;
  const current = customSelected ? customDraft ?? (previousCustom ? answer : '') : draft ?? answer;
  const ready = format === 'ranking' ? ranking.length === options.length : format === 'points'
    ? points.some(point => point.trim()) : Boolean(current.trim());
  const unchanged = format === 'ranking' ? !rankingDraft : format === 'points' ? !pointsDraft : current === answer;
  return <section className="entry">
    <div className="person"><Avatar index={guest.avatar} initials={guest.initials} />{guest.name}</div>
    {round ? <>
      {round.question.lab && <p className="context">{round.question.lab}</p>}
      <h1>{round.question.text}</h1>
      {round.status === 'revealed' ? <div className="entry-status">
        <p>Responses are closed. Look at the projector for the results.</p>
        {answer && <div className="saved-answer"><strong>Your answer</strong>
          <AnswerContent answer={{ text: answer, points: data.points, ranking: data.ranking }} />
        </div>}
      </div> : <form onSubmit={async e => {
        e.preventDefault();
        setSaved(false);
        const payload = format === 'ranking' ? { ranking } : format === 'points' ? { points } : { text: current };
        if (await event.send('answer', { roundId: round.id, ...payload })) setSaved(true);
      }}>
        {format === 'ranking' ? <RankingEditor options={options} ranking={ranking} onChange={items => {
          setRankingDraft(items);
          setSaved(false);
        }} /> : format === 'points' ? <PointsEditor points={points} help={round.question.help} onChange={items => {
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
        <button disabled={event.busy || !ready}>{answer ? 'Update answer' : 'Submit answer'}</button>
        {(saved || (answer && unchanged)) && <p role="status" className="saved">Answer saved. You can edit it until the round closes.</p>}
      </form>}
    </> : <><h1>You’re in.</h1><p>The moderator’s question will appear here when the round begins.</p></>}
  </section>;
}

function RankingEditor({ options, ranking, onChange }) {
  function move(index, offset) {
    const updated = [...ranking];
    [updated[index], updated[index + offset]] = [updated[index + offset], updated[index]];
    onChange(updated);
  }
  const remaining = options.filter(option => !ranking.includes(option));
  return <fieldset>
    <legend>Rank all {options.length} interventions</legend>
    <p className="help">Pick your top intervention first, then add the rest in order of preference.</p>
    {ranking.length > 0 && <ol className="rank-list">
      {ranking.map((option, index) => <li key={option}>
        <span>{option}</span>
        <div className="actions">
          <button type="button" className="quiet arrow" aria-label={`Move ${option} up`} disabled={!index} onClick={() => move(index, -1)}>↑</button>
          <button type="button" className="quiet arrow" aria-label={`Move ${option} down`} disabled={index === ranking.length - 1} onClick={() => move(index, 1)}>↓</button>
          <button type="button" className="quiet" aria-label={`Remove ${option} from ranking`} onClick={() => onChange(ranking.filter(item => item !== option))}>Remove</button>
        </div>
      </li>)}
    </ol>}
    {remaining.length > 0 && <label>Add rank {ranking.length + 1}
      <select value="" onChange={e => onChange([...ranking, e.target.value])}>
        <option value="" disabled>Choose an intervention</option>
        {remaining.map(option => <option key={option}>{option}</option>)}
      </select>
    </label>}
  </fieldset>;
}

function PointsEditor({ points, help, onChange }) {
  return <fieldset>
    <legend>Your commitment</legend>
    {help && <p className="help">{help}</p>}
    {points.map((point, index) => <label key={index}>Point {index + 1}
      <textarea rows={2} maxLength={500} value={point} onChange={e => onChange(points.map((item, i) => i === index ? e.target.value : item))} />
    </label>)}
    {points.length < 5 && <button type="button" className="quiet add-point" onClick={() => onChange([...points, ''])}>Add another point</button>}
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

function OptionResults({ stats, count, optionCount }) {
  const ranked = Boolean(optionCount);
  const selected = stats.filter(item => (ranked ? item.score : item.count) > 0);
  const skipped = stats.filter(item => (ranked ? item.score : item.count) === 0);
  const max = ranked ? count * optionCount : count;
  return <>
    {ranked && <p className="stage-caption">Ranked results · {optionCount} points for first, 1 for last</p>}
    {selected.length > 0 && <div className="tally" aria-label="Voted options">
      {selected.map(({ label, count: votes, score, first }) => {
        const value = ranked ? score : votes;
        const share = max ? Math.round(value / max * 100) : 0;
        const detail = ranked ? `${score} points · ${first} first-place` : `${votes} ${votes === 1 ? 'vote' : 'votes'}`;
        return <div key={label} className="vote" style={{ '--vote-share': share + '%' }} title={`${label}, ${detail}`}>
          <span className="vote-label">{label}{ranked && <small>{first} first-place</small>}</span>
          <strong className="vote-count" aria-label={detail}>{value}</strong>
        </div>;
      })}
    </div>}
    {skipped.length > 0 && <div className="unpicked" aria-label="Options without votes">
      {skipped.map(item => <span key={item.label}>{item.label}<strong>0</strong></span>)}
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
      {unmatched.map(answer => <button type="button" className="response-card" key={answer.id} onClick={() => onOpen([answer.id])}>
        <Avatar index={answer.avatar} initials={answer.initials} />
        <span>{answer.points?.[0] ?? answer.text}{answer.points?.length > 1 && <small>{answer.points.length} points</small>}</span>
      </button>)}
    </div>
  </section>;
}

function AnswerContent({ answer }) {
  const entries = answer.points?.length ? answer.points : answer.ranking;
  return entries?.length
    ? <ol className="answer-points">{entries.map((text, index) => <li key={index}>{text}</li>)}</ol>
    : <p>{answer.text}</p>;
}

export function Projector() {
  const { data, connection } = useEvent('projector');
  const round = data?.round;
  const [selected, setSelected] = useState([]);
  useEffect(() => { setSelected([]); }, [round?.id, round?.spotlight]);
  const shown = round && (round.live || round.status === 'revealed');
  const projected = round?.answers.find(item => item.id === round.spotlight);
  const focused = projected ? [projected] : (round?.answers.filter(answer => selected.includes(answer.id)) || []);
  const format = round ? questionFormat(round.question) : 'written';
  const options = round?.question.options || [];
  const written = round?.answers.filter(answer => format !== 'ranking' && (format !== 'choice' || !options.includes(answer.text))) || [];
  const themes = round?.analysis?.themes || [];
  const total = data?.guestCount || 0;
  const joined = data?.ready.length ?? 0;
  const answered = data?.answeredCount ?? 0;
  const showResults = Boolean(shown && (options.length || round.count));
  return <main className="projection">
    <div className="square">
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
          {round.question.lab && <p className="stage-context">{round.question.lab}</p>}
          <h1 className={round.question.text.length > 105 ? 'long-question' : undefined}>{round.question.text}</h1>
          <p className="stage-count" role="status" aria-label={`${answered} answered out of ${joined} guests who joined`}>{answered} / {joined}</p>
          {showResults && <div className="results">
            <ResponseBoard answers={written} themes={themes} onOpen={setSelected} mergeExact={format === 'choice'}
              title={format === 'choice' ? 'Guest suggestions' : format === 'points' ? 'Action board' : themes.length ? 'Emerging themes and responses' : null} />
            {options.length > 0 && <OptionResults stats={round.stats || []} count={round.count}
              optionCount={format === 'ranking' ? options.length : 0} />}
            {round.analysisStatus === 'running' && <p className="stage-caption" role="status">Grouping similar responses…</p>}
            {round.analysis?.takeaway && <p className="stage-caption">{round.analysis.takeaway}</p>}
          </div>}
          {!shown && <p className="stage-sub">{round.status === 'open' ? 'Send your answer from your phone.' : ''}</p>}
          {focused.length > 0 && <div className="spotlight" role="dialog" aria-modal="false" aria-label="Spotlighted response">
            {focused.map(answer => <div className="spotlight-answer" key={answer.id}>
              <Avatar index={answer.avatar} initials={answer.initials} /><AnswerContent answer={answer} />
            </div>)}
            {!projected && <button type="button" className="quiet" onClick={() => setSelected([])}>Back to responses</button>}
          </div>}
        </section>}
    </div>
  </main>;
}

function Editor({ question, event, onClose }) {
  const [text, setText] = useState(question?.text || '');
  const [format, setFormat] = useState(question?.format || 'standard');
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
      <option value="points">Action board · up to five points</option>
    </select></label>
    {format !== 'points' && <label>Choices <span className="help">{format === 'ranking' ? 'Enter the choices to rank, one per line.' : 'One per line. Leave blank for a written answer.'}</span>
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
    <p>{source} Gemini groups written answers after a round closes.</p>
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
      <label>New API key <span className="help">Leave blank to keep the current key. Saved keys cannot be viewed.</span>
        <input name="key" type="password" maxLength={512} autoComplete="new-password" disabled={!settings.canStoreKey} />
      </label>
      <div className="actions">
        <button disabled={event.busy}>Save Gemini settings</button>
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
  const currentId = questions[activeIndex]?.id;
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
                    {round.canAnalyse && data.gemini.keySource !== 'none' &&
                    <button className="quiet" disabled={busy || round.analysisStatus === 'running'} onClick={() => manage('analyse')}>
                      {round.analysisStatus === 'running' ? 'Grouping responses…' : round.analysisStatus === 'failed' ? 'Retry grouping' : round.analysis ? 'Refresh themes' : 'Generate themes'}
                    </button>}</>}
              </div>
              {round.canAnalyse && data.gemini.keySource === 'none' && <p className="help">Add a Gemini key in Settings to group similar responses.</p>}
              {round.analysisStatus === 'failed' && <p className="help" role="status">Grouping was unavailable. The original responses are still visible.</p>}
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
              <button disabled={busy || !selection || selection === currentId}>{round ? 'Switch to selected question' : 'Publish question'}</button>
            </form>
          </section>
          <ResponseFeed key={round?.id || 'lobby'} round={round} guests={guests} busy={busy} manage={manage} />
        </div>}
        {tab === 'questions' && <section className="panel">
          <div className="section-head"><h2>Question order</h2><button onClick={() => setQuestion({})}>Add question</button></div>
          {question && <Editor key={question.id || 'new'} question={question.id ? question : null} event={event} onClose={() => setQuestion(null)} />}
          {data.questions.map((item, index) => <div className="list-row question-row" key={item.id}>
            <span className="ordinal">{index + 1}</span>
            <div className="row-copy"><strong>{item.text}</strong><p>{[item.lab, item.format === 'points' ? 'Action board' : item.format === 'ranking' ? 'Ranking' : item.options.length ? `Poll · ${item.options.length} choices` : 'Written response'].filter(Boolean).join(' · ')}</p></div>
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
          {round && <Result text={round.question.text} count={round.count} takeaway={round.analysis?.takeaway} nextStep={round.analysis?.nextStep} />}
          {data.history.map(item => <Result key={item.id} {...item} />)}
          {!round && !data.history.length && <p>Published rounds will appear here with response totals.</p>}
        </section>}
      </>}
  </main>;
}

function ResponseFeed({ round, guests, busy, manage }) {
  const [filter, setFilter] = useState('');
  const answers = round?.answers || [];
  const stats = round?.stats || [];
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
          <span>{stat.label}</span><strong>{stat.score === undefined ? stat.count : `${stat.score} pts · ${stat.first} first`}</strong>
        </div>)}
        {questionFormat(round.question) === 'choice' && <div className="stat-line">
          <span>Custom responses</span><strong>{answers.length - stats.reduce((sum, stat) => sum + stat.count, 0)}</strong>
        </div>}
      </details>}
      {round.analysis?.themes?.length > 0 && <details className="response-stats">
        <summary>Gemini themes</summary>
        {round.analysis.themes.map((theme, index) => <div className="stat-line" key={index}><span>{theme.label}</span><strong>{theme.count}</strong></div>)}
      </details>}
      {round.analysis?.takeaway && <p className="help">{round.analysis.takeaway}</p>}
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

function Result({ text, count, takeaway, nextStep }) {
  return <article className="list-row">
    <div className="row-copy"><strong>{text}</strong>{takeaway && <p>{takeaway}</p>}{nextStep && <p><b>Next step</b> {nextStep}</p>}</div>
    <span className="state">{count} {count === 1 ? 'response' : 'responses'}</span>
  </article>;
}
