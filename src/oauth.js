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

// 网页授权只申请租户白名单内的最小集（2026-08-10 实证：--recommend 全量包被管理员
// 驳回，这 9 项在 Mia 2026-07-09 授权里已存在=必然白名单内）。不传 scope 会默认申请
// 应用全部已启用 scope，其中含非白名单项 → felix/york 授权页直接失败。
// offline_access 必须显式要：没有它飞书不发 refresh_token，按人桥接无从谈起。
export const OAUTH_SCOPES = process.env.BRAINX_FEISHU_SCOPES || [
  'offline_access',
  'auth:user.id:read',
  'contact:user.base:readonly',
  'im:message:readonly',
  'im:chat:read',
  'im:chat.members:read',
  'base:app:read',
  'base:table:read',
  'base:record:read',
].join(' ');

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
  u.searchParams.set('scope', OAUTH_SCOPES);
  return u.toString();
}

/** app_id+secret → app_access_token（refresh 流程也要用它做 Bearer）。 */
export async function appAccessToken(fetchImpl = fetch) {
  const r = await fetchImpl('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: APP_SECRET() }),
    signal: AbortSignal.timeout(45000),
  });
  const d = await r.json();
  if (d.code !== 0) throw new Error(`app_access_token 失败: ${d.msg || d.code}`);
  return d.app_access_token;
}

/** code → 飞书身份 + 用户令牌对。fetchImpl 可注入（测试用）。
 * 返回 { open_id, name, en_name, avatar, tokens }；tokens 含 refresh_token 时
 * 调用方应 saveUserTokens 入库（按人桥接的凭据）。 */
export async function exchangeCode(code, fetchImpl = fetch) {
  const appToken = await appAccessToken(fetchImpl);
  const r2 = await fetchImpl('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${appToken}` },
    body: JSON.stringify({ grant_type: 'authorization_code', code }),
    signal: AbortSignal.timeout(45000),
  });
  const d2 = await r2.json();
  if (d2.code !== 0) throw new Error(`oidc/access_token 失败: ${d2.msg || d2.code}`);
  // 实测（2026-08-07）：oidc token 响应只含 token 族字段，无身份 → 必须再拉 user_info
  const userToken = d2.data?.access_token;
  if (!userToken) throw new Error('oidc/access_token 未返回 access_token');
  const r3 = await fetchImpl('https://open.feishu.cn/open-apis/authen/v1/user_info', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const d3 = await r3.json();
  if (d3.code !== 0) throw new Error(`user_info 失败: ${d3.msg || d3.code}`);
  const u = d3.data || {};
  // 排障日志：只打 open_id 前 10 位，绝不打完整身份信息/令牌
  console.error(`[oauth] user_info open_id 前缀: ${String(u.open_id || 'MISSING').slice(0, 10)}`);
  const t = d2.data || {};
  return {
    open_id: u.open_id, name: u.name, en_name: u.en_name, avatar: u.avatar_url,
    tokens: {
      access_token: t.access_token, refresh_token: t.refresh_token,
      expires_in: t.expires_in, refresh_expires_in: t.refresh_expires_in, scope: t.scope,
    },
  };
}
