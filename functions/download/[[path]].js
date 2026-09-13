export async function onRequestGet({ request, env, params }) {
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const path = segments.join('/');
  if (!path || path.startsWith('_')) return new Response('Not Found', { status: 404 });
  if (!env.DOWNLOADS) return new Response('Storage not configured', { status: 500 });

  const key = decodeURIComponent(path);
  const object = await env.DOWNLOADS.get(key, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (!object) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=3600');

  const filename = key.split('/').pop();
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

  const range = object.range;
  if (range && typeof range.offset === 'number' && typeof range.length === 'number') {
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { headers });
}
