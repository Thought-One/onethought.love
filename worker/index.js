import { onRequestPost as login } from './lib/login.js';
import { onRequestPost as logout } from './lib/logout.js';
import { onRequestGet as session } from './lib/session.js';
import { onRequestGet as filesGet, onRequestPost as filesPost, onRequestDelete as filesDelete } from './lib/files.js';
import { onRequestGet as noticeGet, onRequestPut as noticePut } from './lib/notice.js';
import { serveDownload } from './lib/download.js';

const ROUTES = {
  'POST /api/login': login,
  'POST /api/logout': logout,
  'GET /api/session': session,
  'GET /api/files': filesGet,
  'POST /api/files': filesPost,
  'DELETE /api/files': filesDelete,
  'GET /api/notice': noticeGet,
  'PUT /api/notice': noticePut,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      const handler = ROUTES[`${request.method} ${path}`];
      if (!handler) return new Response('Not Found', { status: 404 });
      return handler({ request, env });
    }

    if (path.startsWith('/download/')) {
      let key;
      try {
        key = decodeURIComponent(path.slice('/download/'.length));
      } catch (err) {
        return new Response('Bad Request', { status: 400 });
      }
      return serveDownload(request, env, key);
    }

    if (path === '/onemiss' || path === '/onemiss/') {
      return env.ASSETS.fetch(new URL('/onemiss/index.html', url));
    }

    return env.ASSETS.fetch(request);
  },
};
