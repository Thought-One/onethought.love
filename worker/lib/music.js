// 网易云音乐解析代理。
// 上游：https://api.s0o1.com/API/wyy_v2/
//   ?action=search&keyword=<关键词>      返回搜索结果列表
//   ?action=song&url=<歌曲链接或ID>       返回单曲详情（含 url 直链、pic 封面、lyric 歌词）
// 由 Worker 代理，避免跨域；只放行白名单 action，避免变成开放代理。

import { json, error } from './http.js';

const SOURCE = 'https://api.s0o1.com/API/wyy_v2/';
const ALLOWED = new Set(['search', 'song']);

export async function onRequestGet({ request }) {
  const params = new URL(request.url).searchParams;
  const action = (params.get('action') || '').trim();
  if (!ALLOWED.has(action)) return error('action 仅支持 search 或 song');

  let target;
  if (action === 'search') {
    const keyword = (params.get('keyword') || '').trim();
    if (!keyword) return error('请输入搜索关键词');
    if (keyword.length > 100) return error('搜索关键词过长');
    target = `${SOURCE}?action=search&keyword=${encodeURIComponent(keyword)}`;
  } else {
    const url = (params.get('url') || '').trim();
    if (!url) return error('缺少歌曲链接或 ID');
    if (url.length > 300) return error('歌曲链接过长');
    target = `${SOURCE}?action=song&url=${encodeURIComponent(url)}`;
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json, text/plain, */*' },
      cf: { cacheTtl: 600, cacheEverything: true },
    });
  } catch (err) {
    return error('无法连接音乐接口，请稍后重试', 502);
  }

  let data;
  try {
    data = await upstream.json();
  } catch (err) {
    return error('音乐接口返回异常', 502);
  }

  return json(data, { status: upstream.ok ? 200 : 502 });
}
