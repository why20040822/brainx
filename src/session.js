/** session.js — 本地登录：无密码，HMAC 无状态 Cookie（补全文档 §14）。
 * 目的不是防人，是让每条事件有确定 actor。重启不失效（密钥落盘 data/.secret）。
 */
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET_PATH = join(ROOT, 'data', '.secret');

function secret() {
  if (!existsSync(SECRET_PATH)) {
    mkdirSync(dirname(SECRET_PATH), { recursive: true });
    writeFileSync(SECRET_PATH, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return readFileSync(SECRET_PATH, 'utf8').trim();
}

export function signSession(consultant_id) {
  const exp = Date.now() + 7 * 86400000;
  const payload = `${consultant_id}.${exp}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifySession(token) {
  if (!token) return null;
  const [consultant_id, exp, sig] = String(token).split('.');
  if (!consultant_id || !exp || !sig) return null;
  const expect = createHmac('sha256', secret()).update(`${consultant_id}.${exp}`).digest('hex');
  if (sig !== expect || Date.now() > Number(exp)) return null;
  return consultant_id;
}

export function cookieOf(req) {
  const m = /(?:^|;\s*)brainx_session=([^;]+)/.exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}
