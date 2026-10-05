// Cloudflare Turnstile 真人验证（免费、无需绑卡）。
// 环境变量：TURNSTILE_SECRET（密钥）、TURNSTILE_SITE_KEY（前端公钥）。
// 未配置 TURNSTILE_SECRET 时跳过校验（便于尚未配置时先跑通流程）。

export function turnstileEnabled(env) {
  return !!env.TURNSTILE_SECRET;
}

export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return { ok: true, skipped: true };
  if (!token) return { ok: false, error: '请先完成真人验证' };

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (data && data.success) return { ok: true };
    return { ok: false, error: '真人验证未通过，请重试' };
  } catch (err) {
    return { ok: false, error: '真人验证服务暂时不可用，请稍后重试' };
  }
}
