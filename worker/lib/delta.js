// 三角洲行动 · 每日密码代理。
// 上游接口需要登录 Cookie（openid/access_token 等），因此由 Worker 读取环境变量
// DF_COOKIE 后请求，避免把凭据暴露到前端，也顺带绕开跨域限制。
//
// 相关环境变量（除 DF_COOKIE 外均可选，使用默认值）：
//   DF_COOKIE      完整 Cookie 字符串（必需，未配置时返回未配置状态）
//   DF_SECRET_URL  直接覆盖完整请求地址（最高优先级）
//   DF_ICHART_ID / DF_SIDE_TOKEN / DF_METHOD / DF_SOURCE

import { json, error } from './http.js';

const UPSTREAM = 'https://comm.ams.game.qq.com/ide/';

// 未配置 Cookie 时用于占位展示的地图列表（密码为空）
const KNOWN_MAPS = [
  { mapID: 1, mapName: '零号大坝' },
  { mapID: 2, mapName: '长弓溪谷' },
  { mapID: 3, mapName: '巴克什' },
  { mapID: 4, mapName: '航天基地' },
  { mapID: 5, mapName: '潮汐监狱' },
];

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function buildUrl(env) {
  const custom = clean(env.DF_SECRET_URL);
  if (custom) return custom;

  const iChartId = clean(env.DF_ICHART_ID) || '384918';
  const sIdeToken = clean(env.DF_SIDE_TOKEN) || 'mbq5GZ';
  const method = clean(env.DF_METHOD) || 'dfm/center.day.secret';
  const source = clean(env.DF_SOURCE) || '2';

  const params = new URLSearchParams({
    iChartId,
    iSubChartId: iChartId,
    sIdeToken,
    method,
    source,
    param: '{}',
  });
  return `${UPSTREAM}?${params.toString()}`;
}

// 上游返回结构层级较深且可能变动，这里递归查找第一个「地图列表」数组
function findList(node, depth) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    const looksLikeMaps = node.length > 0 && node.every(
      (item) => item && typeof item === 'object' && ('mapName' in item || 'secret' in item),
    );
    return looksLikeMaps ? node : null;
  }
  if (typeof node !== 'object') return null;
  for (const key of Object.keys(node)) {
    const found = findList(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeList(list) {
  return list
    .filter((item) => item && (item.mapName || item.secret))
    .map((item) => ({
      mapID: Number(item.mapID) || 0,
      mapName: String(item.mapName || ('地图 ' + (item.mapID || ''))).trim(),
      secret: clean(item.secret),
    }));
}

export async function onRequestGet({ env }) {
  const cookie = clean(env.DF_COOKIE);
  if (!cookie) {
    return json({
      configured: false,
      source: 'unconfigured',
      maps: KNOWN_MAPS.map((m) => ({ ...m, secret: '' })),
    });
  }

  let upstream;
  try {
    upstream = await fetch(buildUrl(env), {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Referer: 'https://www.wegame.com.cn/',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '',
    });
  } catch (err) {
    return error('无法连接密码接口，请稍后重试', 502);
  }

  let payload = null;
  try {
    payload = await upstream.json();
  } catch (err) {
    return error('密码接口返回异常', 502);
  }

  const rawList = findList(payload, 0);
  if (!rawList) {
    const message = clean(payload && payload.sMsg) || '暂未获取到密码（Cookie 可能已过期）';
    return error(message, 502);
  }

  return json({
    configured: true,
    source: 'live',
    updatedAt: new Date().toISOString(),
    maps: normalizeList(rawList),
  });
}
