/** oauth.js — 飞书网页授权（authorization code flow）。
 *
 * 凭据纪律：app_secret 只走环境变量 BRAINX_FEISHU_APP_SECRET（1Password 导出），
 * 不落盘、不入库、不进日志。app_id 非密（出现在授权 URL 里），可用 env 覆盖。
 *
 * lark-cli 用 Device Flow 且 secret 锁在 keychain，无法复用 → 本模块直连飞书：
 *   1. POST /open-apis/auth/v3/app_access_token/internal      (app_id+secret → app token)
 *   2. POST /open-apis/authen/v1/oidc/access_token            (Bearer app token + code)
 * state 无状态 HMAC（与 session 同密钥），10 分钟有效，防 CSRF。
 */
import { createHmac, randomBytes } from 'node:crypto';
import { sessionSecret } from './session.js';

export const FEISHU_APP_ID = process.env.BRAINX_FEISHU_APP_ID || 'cli_aac5c592feb89cd0';
const APP_SECRET = () => process.env.BRAINX_FEISHU_APP_SECRET || '';
const BASE = () => process.env.BRAINX_BASE_URL || 'http://127.0.0.1:3000';

export const oauthConfigured = () => Boolean(APP_SECRET());
export const redirectUri = () => `${BASE()}/api/v1/oauth/callback`;

export function signState() {
  const nonce = randomBytes(8).toString('hex');
  const ts = Date.now();
  const sig = createHmac('sha256', sessionSecret()).update(`oauth.${nonce}.${ts}`).digest('hex');
  return `${nonce}.${ts}.${sig}`;
}

export function verifyState(state, maxAgeMs = 10 * 60 * 1000) {
  const [nonce, ts, sig] = String(state || '').split('.');
  if (!nonce || !ts || !sig) return false;
  const expect = createHmac('sha256', sessionSecret()).update(`oauth.${nonce}.${ts}`).digest('hex');
  if (sig !== expect) return false;
  return Date.now() - Number(ts) <= maxAgeMs;
}

export function buildAuthorizeUrl(state) {
  const u = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
  u.searchParams.set('app_id', FEISHU_APP_ID);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('state', state);
  return u.toString();
}

/** code → 飞书身份。fetchImpl 可注入（测试用）。 */
export async function exchangeCode(code, fetchImpl = fetch) {
  const r1 = await fetchImpl('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: APP_SECRET() }),
  });
  const d1 = await r1.json();
  if (d1.code !== 0) throw new Error(`app_access_token 失败: ${d1.msg || d1.code}`);
  const r2 = await fetchImpl('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${d1.app_access_token}` },
    body: JSON.stringify({ grant_type: 'authorization_code', code }),
  });
  const d2 = await r2.json();
  if (d2.code !== 0) throw new Error(`oidc/access_token 失败: ${d2.msg || d2.code}`);
  const u = d2.data || {};
  return { open_id: u.open_id, name: u.name, en_name: u.en_name, avatar: u.avatar_url };
}
