/** session.js — HMAC 无状态 Cookie（补全文档 §14；OAuth 后绑定 open_id）。
 * 目的不是防人，是让每条事件有确定 actor。重启不失效（密钥落盘 data/.secret）。
 * payload = consultant_id.open_id.exp，签名防篡改；open_id 由 OAuth 回调写入。
 */
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET_PATH = join(ROOT, 'data', '.secret');

export function sessionSecret() {
  if (!existsSync(SECRET_PATH)) {
    mkdirSync(dirname(SECRET_PATH), { recursive: true });
    writeFileSync(SECRET_PATH, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return readFileSync(SECRET_PATH, 'utf8').trim();
}

export function signSession(consultant_id, open_id = '') {
  const exp = Date.now() + 7 * 86400000;
  const payload = `${consultant_id}.${open_id}.${exp}`;
  const sig = createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

/** 校验通过返回 { consultant_id, open_id }，失败返回 null。 */
export function verifySession(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 4) return null;
  const [consultant_id, open_id, exp, sig] = parts;
  const expect = createHmac('sha256', sessionSecret())
    .update(`${consultant_id}.${open_id}.${exp}`).digest('hex');
  if (sig !== expect || Date.now() > Number(exp)) return null;
  return { consultant_id, open_id };
}

export function cookieOf(req) {
  const m = /(?:^|;\s*)brainx_session=([^;]+)/.exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}
