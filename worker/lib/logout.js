import { clearSessionCookie } from './auth.js';
import { json } from './http.js';

export async function onRequestPost() {
  // 同时清除可能存在的旧 Cookie 会话
  return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
}
