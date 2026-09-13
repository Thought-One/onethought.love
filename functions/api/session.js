import { isAuthenticated } from '../_utils/auth.js';
import { json } from '../_utils/http.js';

export async function onRequestGet({ request, env }) {
  const authenticated = await isAuthenticated(request, env);
  return json({ authenticated, configured: Boolean(env.DOWNLOADS) });
}
