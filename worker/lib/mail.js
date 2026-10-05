// 邮件发送：优先使用 Resend（免费额度、无需绑卡）。
// 三种模式：
//   resend  已配置 RESEND_API_KEY，真实发信
//   dev     未配置邮件服务但设置了 USER_DEV_MODE=1，不真正发信，验证码直接回传（仅本地/测试用）
//   off     未配置邮件服务：拒绝发码，避免验证码被任意人获取（更安全）
// 环境变量：
//   RESEND_API_KEY   Resend API Key（配置后即启用真实发信）
//   MAIL_FROM        发件人，如 "一思数据 <noreply@onethought.dpdns.org>"
//                    未设置时回退到 "onethought <onboarding@resend.dev>"
//   USER_DEV_MODE    设为 1 时开启开发模式（无需邮件服务即可测试验证码流程）

export function mailMode(env) {
  if (env.RESEND_API_KEY) return 'resend';
  if (String(env.USER_DEV_MODE || '').trim() === '1') return 'dev';
  return 'off';
}

export async function sendCodeMail(env, to, code) {
  if (!env.RESEND_API_KEY) return false; // 开发模式：未真正发送

  const from = env.MAIL_FROM || 'onethought <onboarding@resend.dev>';
  const subject = '【一思数据】邮箱验证码';
  const text = `你的验证码是 ${code}，10 分钟内有效。请勿将验证码告诉他人。若非本人操作，请忽略本邮件。`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      html: `<div style="font-family:sans-serif;font-size:15px;color:#006064;line-height:1.7">
        <p>你的验证码是：</p>
        <p style="font-size:26px;font-weight:700;letter-spacing:4px;color:#0097a7">${code}</p>
        <p>10 分钟内有效。请勿将验证码告诉他人。若非本人操作，请忽略本邮件。</p>
      </div>`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`邮件发送失败 (${res.status}) ${detail.slice(0, 200)}`);
  }
  return true;
}
