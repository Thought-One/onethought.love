import { isAuthenticated } from '../_utils/auth.js';
import { json } from '../_utils/http.js';
import { b2Configured } from '../_utils/b2.js';

export async function onRequestGet({ request, env }) {
  const authenticated = await isAuthenticated(request, env);
  return json({ authenticated, configured: b2Configured(env) });
}
