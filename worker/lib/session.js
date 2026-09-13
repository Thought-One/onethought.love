import { isAuthenticated } from './auth.js';
import { json } from './http.js';
import { b2Configured } from './b2.js';

// B2_REGION 可省略（会从 B2_ENDPOINT 推导），故不列入必需项
const REQUIRED = [
  'ADMIN_PASSWORD',
  'SESSION_SECRET',
  'B2_ENDPOINT',
  'B2_BUCKET',
  'B2_KEY_ID',
  'B2_APP_KEY',
];

export async function onRequestGet({ request, env }) {
  const authenticated = await isAuthenticated(request, env);
  const missing = REQUIRED.filter((name) => !String(env[name] || '').trim());
  return json({
    authenticated,
    configured: b2Configured(env),
    missing,
  });
}
