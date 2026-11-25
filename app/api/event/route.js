import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { changeState, readState } from '../../../lib/store';
import { cookieFor, passwordHash, sameSecret, sessionFor, signIn, tokenKey, validPassword } from '../../../lib/auth';
import { analyse } from '../../../lib/analysis';
import { geminiCredentials, geminiSettings, saveGeminiKey } from '../../../lib/settings';

export const runtime = 'nodejs';

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
const viewGuest = ({ id, name, joined, avatar, enabled }) => ({ id, name, joined, avatar, enabled });

function roundView(round, show) {
  if (!round) return null;
  const entries = Object.entries(round.answers);
  return {
    id: round.id, question: round.question, status: round.status, live: round.live, count: entries.length,
    answers: show ? entries.map(([id, text]) => ({ id, text, avatar: round.avatars[id] ?? 0 })) : [],
    analysis: show ? round.analysis : null,
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
      return json({ authenticated: true, questions: state.questions, guests: state.guests.map(viewGuest), round: roundView(round, true),
        gemini: geminiSettings(state),
        history: state.rounds.filter(item => item.id !== state.current).map(item => ({
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
      });
    }
    return json({
      guestCount: guests.length,
      ready: guests.filter(guest => guest.joined).map(({ id, avatar }) => ({ id, avatar })),
      round: roundView(round, round?.live || round?.status === 'revealed'),
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

function questionFields(body) {
  const text = entered(body.text, 600);
  const lab = entered(body.lab, 140);
  const options = Array.isArray(body.options) ? [...new Set(body.options.map(option => entered(option, 240)).filter(Boolean))] : [];
  check(text && text.length <= 600 && lab.length <= 140, 'Enter a question of up to 600 characters.');
  check(options.length !== 1 && options.length <= 10 && options.every(option => option.length <= 240), 'Use two to ten distinct choices, or leave choices blank.');
  return { text, lab, options };
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
        for (const [key, session] of Object.entries(state.sessions)) {
          if (session.guestId === guest.id) delete state.sessions[key];
        }
      }
    } else {
      state.guests.push({ id: randomUUID(), name, password: passwordHash(password), enabled: true, joined: false, avatar: state.guests.length % 10 });
    }
  } else if (action === 'guest-remove') {
    const guest = state.guests.find(item => item.id === id && item.enabled);
    check(guest, 'Guest not found.', 404);
    guest.enabled = false;
    for (const [key, session] of Object.entries(state.sessions)) {
      if (session.guestId === id) delete state.sessions[key];
    }
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
    check(!round || round.status !== 'open', 'Close the current round before publishing another.', 409);
    const question = state.questions.find(item => item.id === id);
    check(question, 'Question not found.', 404);
    state.current = randomUUID();
    state.rounds.push({
      id: state.current, question: { ...question }, live: body.live === true, status: 'open', answers: {}, avatars: {},
      analysis: null, spotlight: null,
    });
  } else if (action === 'reveal' || action === 'lobby' || action === 'spotlight') {
    check(round && round.id === body.roundId, 'The active round has changed.', 409);
    if (action === 'reveal') {
      check(round.status === 'open', 'This round is already closed.', 409);
      round.status = 'revealed';
      return { ok: true, shouldAnalyse: geminiSettings(state).keySource !== 'none' && !round.question.options.length && Object.keys(round.answers).length >= 2 };
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
        httpOnly: true, sameSite: 'lax', secure: Boolean(process.env.RENDER) || req.nextUrl.protocol === 'https:',
        path: '/', maxAge: 12 * 60 * 60,
      });
      return response;
    }

    if (body.action === 'analyse') {
      const state = await readState();
      check(sessionFor(state, req, 'admin'), 'Sign in as admin.', 401);
      const round = active(state);
      check(round && round.id === body.roundId && round.status === 'revealed', 'Close and reveal the round first.', 409);
      check(!round.question.options.length && Object.keys(round.answers).length >= 2, 'At least two written responses are needed.');
      let analysis;
      try { analysis = await analyse(round, geminiCredentials(state)); }
      catch (error) { throw new RequestError(error.message.startsWith('Gemini') ? error.message : 'Gemini analysis failed. Try again.', 502); }
      await changeState(current => {
        const completed = current.rounds.find(item => item.id === round.id);
        completed.analysis = analysis;
      });
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
        const text = entered(body.text, 2500);
        check(text && text.length <= 2500, 'Enter an answer of up to 2,500 characters.');
        check(!round.question.options.length || round.question.options.includes(text), 'Choose one of the listed options.');
        round.answers[guest.id] = text;
        round.avatars[guest.id] = guest.avatar;
        return { ok: true };
      }
      return adminChange(state, body);
    });
    const response = json(result.logout ? { ok: true } : result);
    if (result.logout) response.cookies.delete(cookieFor(role));
    return response;
  } catch (error) {
    return handleError(error);
  }
}
