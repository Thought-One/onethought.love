import { clearSessionCookie } from '../_utils/auth.js';
import { json } from '../_utils/http.js';

export async function onRequestPost() {
  return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
}
