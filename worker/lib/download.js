import { b2Configured, b2Get } from './b2.js';

export async function serveDownload(request, env, key) {
  if (!key || key.startsWith('_')) return new Response('Not Found', { status: 404 });
  if (!b2Configured(env)) return new Response('Storage not configured', { status: 500 });

  const rangeHeader = request.headers.get('Range');
  const upstream = await b2Get(env, key, rangeHeader);

  if (upstream.status === 404) return new Response('Not Found', { status: 404 });
  if (!upstream.ok && upstream.status !== 206) {
    return new Response('Upstream error', { status: 502 });
  }

  const headers = new Headers();
  const passthrough = ['content-type', 'content-length', 'content-range', 'etag', 'last-modified'];
  for (const name of passthrough) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=3600');

  const filename = key.split('/').pop();
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

  return new Response(upstream.body, { status: upstream.status, headers });
}
