// Backblaze B2 的 S3 兼容接口封装（AWS Signature V4），基于 Web Crypto 实现。
// 需要的环境变量：
//   B2_ENDPOINT  形如 s3.us-west-004.backblazeb2.com
//   B2_REGION    形如 us-west-004（可省略，从 ENDPOINT 自动推导）
//   B2_BUCKET    存储桶名称
//   B2_KEY_ID    Application Key 的 keyID
//   B2_APP_KEY   Application Key 的 applicationKey

const encoder = new TextEncoder();

function toHex(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

async function sha256Hex(data) {
  const buf = typeof data === 'string' ? encoder.encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', buf));
}

async function hmacSha256(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = typeof data === 'string' ? encoder.encode(data) : data;
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, buf));
}

async function deriveSigningKey(secret, dateStamp, region, service) {
  const kDate = await hmacSha256(encoder.encode('AWS4' + secret), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function encodeKey(key) {
  return String(key || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function b2Configured(env) {
  return Boolean(
    env.B2_ENDPOINT && env.B2_BUCKET && env.B2_KEY_ID && env.B2_APP_KEY,
  );
}

function regionOf(env) {
  if (env.B2_REGION) return env.B2_REGION;
  const parts = String(env.B2_ENDPOINT || '').split('.');
  return parts.length >= 2 ? parts[1] : 'us-west-004';
}

async function signedRequest(env, method, key, options = {}) {
  const { body = null, contentType = '', query = null, extraHeaders = null } = options;
  const host = env.B2_ENDPOINT;
  const region = regionOf(env);
  const service = 's3';
  const bucket = env.B2_BUCKET;

  const canonicalUri = `/${bucket}${key ? '/' + encodeKey(key) : ''}`;
  const canonicalQuery = query
    ? Object.keys(query)
        .sort()
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
        .join('&')
    : '';

  const url = new URL(`https://${host}${canonicalUri}`);
  if (canonicalQuery) url.search = canonicalQuery;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = await sha256Hex(body === null ? '' : body);

  const amzHeaders = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) amzHeaders['content-type'] = contentType;
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      amzHeaders[name.toLowerCase()] = value;
    }
  }

  const signedHeaderNames = Object.keys(amzHeaders).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${String(amzHeaders[name]).trim()}\n`)
    .join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await deriveSigningKey(env.B2_APP_KEY, dateStamp, region, service);
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  const headers = new Headers();
  for (const name of signedHeaderNames) {
    if (name === 'host') continue;
    headers.set(name, amzHeaders[name]);
  }
  headers.set(
    'Authorization',
    `AWS4-HMAC-SHA256 Credential=${env.B2_KEY_ID}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );

  return fetch(url.toString(), {
    method,
    headers,
    body: body === null ? undefined : body,
  });
}

export async function b2Put(env, key, body, contentType) {
  return signedRequest(env, 'PUT', key, {
    body,
    contentType: contentType || 'application/octet-stream',
  });
}

export async function b2Delete(env, key) {
  return signedRequest(env, 'DELETE', key);
}

export async function b2Get(env, key, rangeHeader) {
  const extraHeaders = rangeHeader ? { range: rangeHeader } : null;
  return signedRequest(env, 'GET', key, { extraHeaders });
}

export async function b2GetJson(env, key) {
  const res = await b2Get(env, key);
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch (err) {
    return null;
  }
}

export async function b2PutJson(env, key, data) {
  return b2Put(env, key, JSON.stringify(data), 'application/json; charset=utf-8');
}

export async function b2ListAll(env) {
  const objects = [];
  let token = null;
  do {
    const query = { 'list-type': '2', 'max-keys': '1000' };
    if (token) query['continuation-token'] = token;
    const res = await signedRequest(env, 'GET', '', { query });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`B2 list failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const xml = await res.text();
    const blockRe = /<Contents>([\s\S]*?)<\/Contents>/g;
    let match;
    while ((match = blockRe.exec(xml))) {
      const block = match[1];
      const key = decodeXml((block.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1] || '');
      const size = Number((block.match(/<Size>([\s\S]*?)<\/Size>/) || [])[1] || 0);
      const lastModified = (block.match(/<LastModified>([\s\S]*?)<\/LastModified>/) || [])[1] || '';
      if (key) objects.push({ key, size, lastModified });
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    token = truncated
      ? decodeXml((xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1] || '')
      : null;
    if (token === '') token = null;
  } while (token);
  return objects;
}
