import { isAuthenticated } from './auth.js';
import { json } from './http.js';
import { b2Configured } from './b2.js';

export async function onRequestGet({ request, env }) {
  const authenticated = await isAuthenticated(request, env);
  return json({ authenticated, configured: b2Configured(env) });
}
