import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const defaultModel = 'gemini-3.8-flash';

function encryptionKey() {
  const secret = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY || '', 'base64');
  return secret.length === 32 ? secret : null;
}

export function geminiSettings(state) {
  const saved = state.settings?.gemini;
  return {
    model: saved?.model || process.env.GEMINI_MODEL || defaultModel,
    keySource: saved?.encryptedKey ? 'admin' : process.env.GEMINI_API_KEY ? 'environment' : 'none',
    canStoreKey: Boolean(encryptionKey()),
  };
}

export function saveGeminiKey(key) {
  const secret = encryptionKey();
  if (!secret) throw new Error('Configure SETTINGS_ENCRYPTION_KEY on the server before saving a key.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret, iv);
  const payload = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), payload].map(value => value.toString('base64')).join('.');
}

export function geminiCredentials(state) {
  const encrypted = state.settings?.gemini?.encryptedKey;
  const { model } = geminiSettings(state);
  if (!encrypted) return { model, key: process.env.GEMINI_API_KEY };
  try {
    const [iv, tag, payload] = encrypted.split('.').map(part => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const key = Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
    return { model, key };
  } catch {
    throw new Error('Gemini key could not be opened. Replace it in Admin settings.');
  }
}
