import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest();
export const tokenKey = token => digest(token).toString('hex');
export const sameSecret = (a, b) => timingSafeEqual(digest(a), digest(b));
export const cookieFor = role => `action_lab_${role}`;

export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

export function validPassword(password, stored) {
  return sameSecret(passwordHash(password, stored.split(':')[0]), stored);
}

export function sessionFor(state, req, role) {
  const token = req.cookies.get(cookieFor(role))?.value;
  const session = token && state.sessions[tokenKey(token)];
  return session?.role === role && session.expires > Date.now() ? session : null;
}

export function signIn(state, role, guestId) {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  for (const [key, session] of Object.entries(state.sessions)) {
    if (session.expires <= now) delete state.sessions[key];
  }
  state.sessions[tokenKey(token)] = { role, guestId, expires: now + 12 * 60 * 60 * 1000 };
  return token;
}
