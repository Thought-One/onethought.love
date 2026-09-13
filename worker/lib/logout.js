import { clearSessionCookie } from './auth.js';
import { json } from './http.js';

export async function onRequestPost() {
  return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
}
