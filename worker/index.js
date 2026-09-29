import { onRequestPost as login } from './lib/login.js';
import { onRequestPost as logout } from './lib/logout.js';
import { onRequestGet as session } from './lib/session.js';
import { onRequestGet as filesGet, onRequestPost as filesPost, onRequestPatch as filesPatch, onRequestDelete as filesDelete } from './lib/files.js';
import { onRequestGet as foldersGet, onRequestPost as foldersPost, onRequestPatch as foldersPatch, onRequestDelete as foldersDelete } from './lib/folders.js';
import { onRequestGet as noticeGet, onRequestPut as noticePut } from './lib/notice.js';
import { onRequestGet as deltaGet, refreshDeltaSecrets } from './lib/delta.js';
import { onRequestGet as musicGet } from './lib/music.js';
import { serveDownload } from './lib/download.js';

const ROUTES = {
  'POST /api/login': login,
  'POST /api/logout': logout,
  'GET /api/session': session,
  'GET /api/files': filesGet,
  'POST /api/files': filesPost,
  'PATCH /api/files': filesPatch,
  'DELETE /api/files': filesDelete,
  'GET /api/folders': foldersGet,
  'POST /api/folders': foldersPost,
  'PATCH /api/folders': foldersPatch,
  'DELETE /api/folders': foldersDelete,
  'GET /api/notice': noticeGet,
  'PUT /api/notice': noticePut,
  'GET /api/df-secret': deltaGet,
  'GET /api/wyy': musicGet,
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

    // 干净子分页（无 # 号）：刷新/直链时回退到单页入口
    if (path === '/home' || path === '/data' || path === '/delta' || path === '/music') {
      return env.ASSETS.fetch(new URL('/index.html', url));
    }

    return env.ASSETS.fetch(request);
  },

  // Cloudflare Cron：每小时后端更新每日密码并写入文件
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshDeltaSecrets(env));
  },
};
