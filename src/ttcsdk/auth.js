/** ttcsdk/auth.js — 凭据策略层（SDK 模式：调用方只管 getValidTtcJwt，不关心来源）。
 *
 * 策略 1（当前）：用户粘贴 ottin JWT（v2，~60 天）→ AES-GCM 入 ttc_tokens。
 * 策略 2（预留）：浏览器扩展自动同步 localStorage。
 * 策略 3（预留）：partner/exchange 服务端换票（union_id 代签）。
 * 切换策略只改本文件，company/job/user 三个 API 类零改动。
 *
 * 安全纪律：JWT 只在内存与 AES-GCM 密文两种形态存在（加解密复用 feishu.js 同一
 * 权威与同一 .secret 密钥）；永不进日志/响应/异常消息。注意 TTC JWT 内嵌用户
 * 飞书 user_access_token，属高价值密钥，泄漏面 = 该用户飞书身份能力。
 */
import { now } from '../db.js';
import { enc, dec } from '../feishu.js';
import { REAUTH_SOON_MS } from './config.js';

/** 解析 JWT payload（不验签——验签是 TTC 服务端的事，我们只取 exp/身份回显）。 */
export const decodeJwt = (jwt) => {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
};

/** 托管校验：格式 + 未过期。返回 { expiresAt, userName, personId } 或抛错（消息不含 JWT）。 */
export function validateJwt(jwt) {
  const p = decodeJwt(jwt);
  if (!p) throw new Error('格式不对：需要三段式 JWT（ottin-jwt-token-v2）');
  if (!p.exp) throw new Error('JWT 缺 exp 字段');
  const expiresAt = new Date(p.exp * 1000);
  if (expiresAt.getTime() <= Date.now()) throw new Error('该 JWT 已过期，请回 TTC 系统重新登录后再复制');
  return { expiresAt: expiresAt.toISOString(),
           userName: p.CustomData?.nick_name || p.name || '',
           personId: p.personId || '' };
}

/** 托管/更新某顾问的 TTC 凭据（本人调用，server 层强制）。 */
export function saveTtcToken(db, consultant_id, jwt, meta) {
  db.prepare(`INSERT INTO ttc_tokens (consultant_id, jwt_enc, ttc_user_name, person_id, expires_at, needs_reauth, updated_at)
    VALUES (?,?,?,?,?,0,?)
    ON CONFLICT(consultant_id) DO UPDATE SET jwt_enc=excluded.jwt_enc,
      ttc_user_name=excluded.ttc_user_name, person_id=excluded.person_id,
      expires_at=excluded.expires_at, needs_reauth=0, updated_at=excluded.updated_at`)
    .run(consultant_id, enc(jwt), meta.userName, meta.personId, meta.expiresAt, now());
}

/** 取有效 JWT：过期/标记重登 → null。 */
export function getValidTtcJwt(db, consultant_id) {
  const r = db.prepare('SELECT * FROM ttc_tokens WHERE consultant_id=?').get(consultant_id);
  if (!r || r.needs_reauth) return null;
  if (Date.parse(r.expires_at) <= Date.now()) return null;
  try { return dec(r.jwt_enc); } catch { return null; }
}

/** 凭据失效标记（读取通道 401 时调用）→ 前端胶囊提示重连。 */
export const markTtcReauth = (db, consultant_id) =>
  db.prepare('UPDATE ttc_tokens SET needs_reauth=1, updated_at=? WHERE consultant_id=?').run(now(), consultant_id);

/** 前端状态（安全视图：绝不出 JWT 本体）。 */
export function ttcAuthStatus(db, consultant_id) {
  const r = db.prepare('SELECT ttc_user_name, expires_at, needs_reauth, updated_at FROM ttc_tokens WHERE consultant_id=?').get(consultant_id);
  if (!r) return { connected: false };
  const expired = Date.parse(r.expires_at) <= Date.now();
  const expiringSoon = !expired && (Date.parse(r.expires_at) - Date.now()) < REAUTH_SOON_MS;
  return { connected: !expired && !r.needs_reauth,
           ttc_user_name: r.ttc_user_name, expires_at: r.expires_at,
           needs_reauth: !!r.needs_reauth || expired, expiring_soon: expiringSoon || expired };
}
