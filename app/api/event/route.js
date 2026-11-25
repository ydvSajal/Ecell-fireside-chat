import { randomUUID } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { changeState, readState } from '../../../lib/store';
import { cookieFor, passwordHash, sameSecret, sessionFor, signIn, tokenKey, validPassword } from '../../../lib/auth';
import { analyse } from '../../../lib/analysis';
import { questionFormat, responseStats, themeCandidates } from '../../../lib/responses';
import { geminiCredentials, geminiSettings, saveGeminiKey } from '../../../lib/settings';

export const runtime = 'nodejs';
export const maxDuration = 90;

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const check = (condition, message, status) => {
  if (!condition) throw new RequestError(message, status);
};

const json = (value, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const active = state => state.rounds.find(round => round.id === state.current);
const entered = (value, max) => typeof value === 'string' ? value.trim().slice(0, max + 1) : '';
function initialsFor(name) {
  const words = name.replace(/^(?:(?:prof|dr|mr|mrs|ms)\.?\s+|\((?:prof|dr|mr|mrs|ms)\.?\)\s*)+/iu, '')
    .match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) || [];
  return [words[0], words.length > 1 ? words.at(-1) : null]
    .filter(Boolean).map(word => Array.from(word)[0]).join('').toUpperCase() || '–';
}

const badge = ({ id, name, avatar }) => ({ id, avatar, initials: initialsFor(name) });
const viewGuest = guest => ({ ...badge(guest), name: guest.name, joined: guest.joined, enabled: guest.enabled });

function roundView(round, show, guests = []) {
  if (!round) return null;
  const entries = Object.entries(round.answers);
  const initials = show ? new Map(guests.map(guest => [guest.id, initialsFor(guest.name)])) : null;
  const answers = show ? entries.map(([id, text]) => ({
    id, text, avatar: round.avatars[id] ?? 0, initials: initials.get(id),
    ranking: round.rankings?.[id], points: round.points?.[id],
  })) : [];
  return {
    id: round.id, question: round.question, status: round.status, live: round.live, count: entries.length,
    answers, stats: show ? responseStats(round.question, answers) : [],
    canAnalyse: show && round.status === 'revealed' && themeCandidates(round).length >= 2,
    analysis: show ? round.analysis : null,
    analysisStatus: show ? analysisStatus(round) : null,
    spotlight: show ? round.spotlight : null,
  };
}

function handleError(error) {
  if (error instanceof RequestError) return json({ error: error.message }, error.status);
  console.error(error);
  return json({ error: 'The event service is unavailable. Try again.' }, 500);
}

export async function GET(req) {
  try {
    const state = await readState();
    const round = active(state);
    const mode = req.nextUrl.searchParams.get('view');
    const guests = state.guests.filter(guest => guest.enabled);
    if (mode === 'admin') {
      if (!sessionFor(state, req, 'admin')) return json({ authenticated: false });
      return json({ authenticated: true, questions: state.questions, guests: state.guests.map(viewGuest), round: roundView(round, true, state.guests),
        gemini: geminiSettings(state),
        archivedCount: state.rounds.filter(item => item.archived).length,
        history: state.rounds.filter(item => !item.archived && item.id !== state.current).map(item => ({
          id: item.id, text: item.question.text, count: Object.keys(item.answers).length,
          takeaway: item.analysis?.takeaway, nextStep: item.analysis?.nextStep,
        })).reverse(),
      });
    }
    if (mode === 'guest') {
      const session = sessionFor(state, req, 'guest');
      const guest = guests.find(item => item.id === session?.guestId);
      return json({
        guest: guest ? viewGuest(guest) : null,
        roster: guests.map(({ id, name }) => ({ id, name })),
        round: guest ? roundView(round, false) : null,
        answer: guest && round ? round.answers[guest.id] || '' : '',
        ranking: guest && round ? round.rankings?.[guest.id] || [] : [],
        points: guest && round ? round.points?.[guest.id] || [] : [],
      });
    }
    const joined = guests.filter(guest => guest.joined);
    return json({
      guestCount: guests.length,
      ready: joined.map(badge),
      answeredCount: round ? joined.filter(guest => Object.hasOwn(round.answers, guest.id)).length : 0,
      waiting: guests.filter(guest => !guest.joined).map(badge),
      round: roundView(round, round?.live || round?.status === 'revealed', state.guests),
    });
  } catch (error) {
    return handleError(error);
  }
}

function login(state, req, body) {
  const role = body.action === 'admin-login' ? 'admin' : 'guest';
  const password = typeof body.password === 'string' ? body.password : '';
  const username = process.env.ADMIN_USERNAME || 'sajal';
  const guest = state.guests.find(item => item.enabled && item.id === body.id);
  const address = req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'local';
  const rateKey = tokenKey(role + ':' + address.slice(0, 128));
  const now = Date.now();
  for (const [key, value] of Object.entries(state.attempts)) {
    if (value.until <= now) delete state.attempts[key];
  }
  const attempts = state.attempts[rateKey] ??= { misses: 0, until: now + 120000 };
  if (attempts.misses >= (role === 'admin' ? 8 : 40)) return { error: 'Too many attempts. Try again in two minutes.', status: 429 };
  const configured = process.env.ADMIN_PASSWORD;
  const valid = password.length > 0 && password.length <= 128 && (role === 'admin'
    ? configured && sameSecret(entered(body.username, 100), username) && sameSecret(password, configured)
    : guest && validPassword(password, guest.password));
  if (!valid) {
    attempts.misses++;
    return { error: 'Check your name and password.', status: 401 };
  }
  if (guest && role === 'guest') guest.joined = true;
  return { role, token: signIn(state, role, role === 'guest' ? guest.id : undefined) };
}

function analysisStatus(round) {
  const job = round.analysisRun;
  if (job?.status === 'running' && Date.now() - job.startedAt > 90000) return 'failed';
  return job?.status;
}

function queueAnalysis(round) {
  if (analysisStatus(round) === 'running') return null;
  const id = randomUUID();
  round.analysisRun = { id, status: 'running', startedAt: Date.now() };
  return { id, roundId: round.id };
}

function startAnalysis(job) {
  if (!job) return;
  after(async () => {
    let analysis;
    try {
      const state = await readState();
      const round = state.rounds.find(item => item.id === job.roundId);
      if (!round || round.analysisRun?.id !== job.id) return;
      analysis = await analyse(round, geminiCredentials(state));
    } catch {
      // Failed or timed-out grouping leaves the original answers visible.
    }
    await changeState(state => {
      const round = state.rounds.find(item => item.id === job.roundId);
      if (!round || round.analysisRun?.id !== job.id) return;
      round.analysisRun.status = analysis ? 'ready' : 'failed';
      if (analysis) round.analysis = analysis;
    });
  });
}

function questionFields(body) {
  const text = entered(body.text, 600);
  const lab = entered(body.lab, 140);
  const format = ['ranking', 'points'].includes(body.format) ? body.format : undefined;
  const options = format !== 'points' && Array.isArray(body.options) ? [...new Set(body.options.map(option => entered(option, 240)).filter(Boolean))] : [];
  check(text && text.length <= 600 && lab.length <= 140, 'Enter a question of up to 600 characters.');
  check(options.length !== 1 && options.length <= 10 && options.every(option => option.length <= 240), 'Use two to ten distinct choices, or leave choices blank.');
  check(format !== 'ranking' || options.length >= 2, 'A ranking question needs at least two choices.');
  return { text, lab, options, format };
}

function revokeGuestSessions(state, guestIds) {
  for (const [key, session] of Object.entries(state.sessions)) {
    if (guestIds.has(session.guestId)) delete state.sessions[key];
  }
}

function adminChange(state, body) {
  const { action, id } = body;
  const round = active(state);
  if (action === 'gemini-save') {
    const model = entered(body.model, 100);
    const key = entered(body.key, 512);
    check(!model || /^gemini-[a-z0-9][a-z0-9.-]{0,92}$/.test(model), 'Enter a valid Gemini model ID, or leave it blank for the default.');
    check(!key || /^[A-Za-z0-9_-]{8,512}$/.test(key), 'Enter a valid Gemini API key.');
    const settings = state.settings ??= {};
    const previous = settings.gemini ?? {};
    check(!key || geminiSettings(state).canStoreKey, 'Configure SETTINGS_ENCRYPTION_KEY on the server before saving a key.', 503);
    settings.gemini = { model, encryptedKey: key ? saveGeminiKey(key) : previous.encryptedKey };
  } else if (action === 'gemini-remove-key') {
    if (state.settings?.gemini) delete state.settings.gemini.encryptedKey;
  } else if (action === 'guest-password-all') {
    const password = typeof body.password === 'string' ? body.password : '';
    check(password.trim() && password.length <= 128, 'Enter a guest password of up to 128 characters.');
    const guests = state.guests.filter(guest => guest.enabled);
    check(guests.length, 'Add a guest first.');
    for (const guest of guests) guest.password = passwordHash(password);
    revokeGuestSessions(state, new Set(guests.map(guest => guest.id)));
    return { ok: true, updated: guests.length };
  } else if (action === 'guest-save') {
    const guest = state.guests.find(item => item.id === id && item.enabled);
    check(!id || guest, 'Guest not found.', 404);
    const name = entered(body.name, 80);
    const password = typeof body.password === 'string' ? body.password : '';
    check(name && name.length <= 80 && password.length <= 128 && (guest || password), 'Enter a name and password.');
    check(!state.guests.some(item => item.id !== id && item.enabled && item.name.toLowerCase() === name.toLowerCase()), 'A guest already uses that name.');
    if (guest) {
      guest.name = name;
      if (password) {
        guest.password = passwordHash(password);
        revokeGuestSessions(state, new Set([guest.id]));
      }
    } else {
      state.guests.push({ id: randomUUID(), name, password: passwordHash(password), enabled: true, joined: false, avatar: state.guests.length % 10 });
    }
  } else if (action === 'guest-remove') {
    const guest = state.guests.find(item => item.id === id && item.enabled);
    check(guest, 'Guest not found.', 404);
    guest.enabled = false;
    revokeGuestSessions(state, new Set([id]));
  } else if (action === 'question-save') {
    const fields = questionFields(body);
    const question = state.questions.find(item => item.id === id);
    if (question) Object.assign(question, fields);
    else state.questions.push({ id: randomUUID(), help: '', ...fields });
  } else if (action === 'question-move' || action === 'question-remove') {
    const index = state.questions.findIndex(item => item.id === id);
    check(index >= 0, 'Question not found.', 404);
    if (action === 'question-remove') state.questions.splice(index, 1);
    else {
      const target = index + (body.direction === 'up' ? -1 : 1);
      if (target >= 0 && target < state.questions.length) {
        [state.questions[index], state.questions[target]] = [state.questions[target], state.questions[index]];
      }
    }
  } else if (action === 'publish') {
    check(body.roundId === undefined ? round?.status !== 'open' : state.current === body.roundId,
      'The active round has changed. Try again with the current question.', 409);
    const question = state.questions.find(item => item.id === id);
    check(question, 'Question not found.', 404);
    if (round?.status === 'open') round.status = 'revealed';
    state.current = randomUUID();
    state.rounds.push({
      id: state.current, question: { ...question }, live: body.live === true, status: 'open', answers: {}, avatars: {},
      analysis: null, spotlight: null,
    });
  } else if (action === 'results-clear') {
    check(state.current === (body.roundId ?? null), 'The active round has changed. Check it before clearing results.', 409);
    for (const item of state.rounds) {
      item.archived = true;
      if (item.status === 'open') item.status = 'revealed';
    }
    state.current = null;
  } else if (action === 'results-restore') {
    for (const item of state.rounds) delete item.archived;
  } else if (action === 'reveal' || action === 'lobby' || action === 'spotlight') {
    check(round && round.id === body.roundId, 'The active round has changed.', 409);
    if (action === 'reveal') {
      check(round.status === 'open', 'This round is already closed.', 409);
      round.status = 'revealed';
      const job = geminiSettings(state).keySource !== 'none' && themeCandidates(round).length >= 2 ? queueAnalysis(round) : null;
      return { ok: true, job };
    }
    else if (action === 'lobby') {
      check(round.status !== 'open', 'Close the round before returning to the lobby.', 409);
      state.current = null;
    } else {
      check(round.status === 'revealed' || round.live, 'Reveal responses before spotlighting one.', 409);
      check(!id || Object.hasOwn(round.answers, id), 'Response not found.', 404);
      round.spotlight = id || null;
    }
  } else throw new RequestError('Unknown action.');
  return { ok: true };
}

export async function POST(req) {
  try {
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');
    const forwardedHost = req.headers.get('x-forwarded-host');
    check(origin && [host, forwardedHost].includes(new URL(origin).host), 'Open the event site to continue.', 403);
    const raw = await req.text();
    check(raw.length <= 16000, 'This request is too large.', 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new RequestError('Invalid request.'); }
    check(body && typeof body.action === 'string', 'Missing action.');

    if (body.action === 'admin-login' || body.action === 'guest-login') {
      const result = await changeState(state => login(state, req, body));
      if (result.error) return json({ error: result.error }, result.status);
      const response = json({ ok: true });
      response.cookies.set(cookieFor(result.role), result.token, {
        httpOnly: true, sameSite: 'lax', secure: Boolean(process.env.RENDER || process.env.VERCEL) || req.nextUrl.protocol === 'https:',
        path: '/', maxAge: 12 * 60 * 60,
      });
      return response;
    }

    if (body.action === 'analyse') {
      const job = await changeState(state => {
        check(sessionFor(state, req, 'admin'), 'Sign in as admin.', 401);
        const round = active(state);
        check(round && round.id === body.roundId && round.status === 'revealed', 'Close and reveal the round first.', 409);
        check(themeCandidates(round).length >= 2, 'At least two written or custom responses are needed.');
        check(geminiSettings(state).keySource !== 'none', 'Add a Gemini API key in Settings first.');
        return queueAnalysis(round);
      });
      startAnalysis(job);
      return json({ ok: true });
    }

    const role = ['answer', 'guest-logout'].includes(body.action) ? 'guest' : 'admin';
    const result = await changeState(state => {
      const session = sessionFor(state, req, role);
      check(session, 'Sign in to continue.', 401);
      if (body.action === role + '-logout') {
        delete state.sessions[tokenKey(req.cookies.get(cookieFor(role)).value)];
        return { logout: true };
      }
      if (body.action === 'answer') {
        const round = active(state);
        const guest = state.guests.find(item => item.id === session.guestId && item.enabled);
        check(guest, 'Guest access has been removed.', 403);
        check(round && round.id === body.roundId && round.status === 'open', 'This round has closed or changed.', 409);
        const format = questionFormat(round.question);
        let text;
        if (format === 'ranking') {
          const { ranking } = body;
          const options = round.question.options;
          check(Array.isArray(ranking) && ranking.length === options.length &&
            new Set(ranking).size === options.length && ranking.every(option => options.includes(option)),
          'Rank each choice once.');
          (round.rankings ??= {})[guest.id] = ranking;
          text = ranking.map((option, index) => `${index + 1}. ${option}`).join('\n');
        } else if (format === 'points') {
          const points = Array.isArray(body.points) ? body.points.map(point => entered(point, 500)).filter(Boolean) : [];
          check(points.length >= 1 && points.length <= 5 && points.every(point => point.length <= 500),
            'Enter one to five points of up to 500 characters each.');
          (round.points ??= {})[guest.id] = points;
          text = points.join('\n');
        } else {
          text = entered(body.text, 2500);
          check(text && text.length <= 2500, 'Enter an answer of up to 2,500 characters.');
        }
        round.answers[guest.id] = text;
        round.avatars[guest.id] = guest.avatar;
        return { ok: true };
      }
      return adminChange(state, body);
    });
    const { job, ...payload } = result;
    startAnalysis(job);
    const response = json(payload.logout ? { ok: true } : payload);
    if (result.logout) response.cookies.delete(cookieFor(role));
    return response;
  } catch (error) {
    return handleError(error);
  }
}
