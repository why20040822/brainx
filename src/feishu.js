/** feishu.js — 按顾问飞书用户令牌：加密存储 + 自动刷新 + 直连 OpenAPI。
 *
 * 凭据纪律（与 oauth.js 同级）：
 *   - 令牌一律 AES-256-GCM 加密后落库，密钥 = sha256(data/.secret)。.secret 只在本机
 *     （0600，gitignore，不进 tar 归档）；丢 .secret = 全部令牌不可解 → 各自重新登录即可。
 *   - 任何日志/错误/API 响应不得出现令牌明文或片段（沿用 oauth.js 的尺度）。
 *   - data/brainx.db 含加密令牌，打包分发时必须排除 data/.secret（否则等同明文外发）。
 *
 * 桥接不再依赖 lark-cli 的用户身份（那是服务器上 Mia 一个人的视野）；
 * lark-cli 仅保留两条合法用途：Bitable 无令牌时的回落、--as bot 推卡。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { sessionSecret } from './session.js';
import { now } from './db.js';
import { appAccessToken } from './oauth.js';

const KEY = () => createHash('sha256').update(sessionSecret()).digest(); // 32B

const enc = (plain) => {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1.${iv.toString('hex')}.${c.getAuthTag().toString('hex')}.${ct.toString('hex')}`;
};

const dec = (blob) => {
  const [v, iv, tag, ct] = String(blob || '').split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('bad_token_blob');
  const d = createDecipheriv('aes-256-gcm', KEY(), Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([d.update(Buffer.from(ct, 'hex')), d.final()]).toString('utf8');
};

const isoIn = (seconds, marginSec = 60) =>
  new Date(Date.now() + (Number(seconds) - marginSec) * 1000).toISOString();

/** 登录回调时调用：把飞书发的令牌对加密入库（UPSERT，重复登录覆盖旧的）。 */
export function saveUserTokens(db, consultant_id, open_id, t) {
  if (!t?.access_token || !t?.refresh_token) return false;
  db.prepare(`INSERT INTO consultant_tokens
    (consultant_id, open_id, access_token_enc, refresh_token_enc,
     access_expires_at, refresh_expires_at, scope, needs_reauth, updated_at)
    VALUES (?,?,?,?,?,?,?,0,?)
    ON CONFLICT(consultant_id) DO UPDATE SET
      open_id=excluded.open_id,
      access_token_enc=excluded.access_token_enc,
      refresh_token_enc=excluded.refresh_token_enc,
      access_expires_at=excluded.access_expires_at,
      refresh_expires_at=excluded.refresh_expires_at,
      scope=excluded.scope, needs_reauth=0, updated_at=excluded.updated_at`)
    .run(consultant_id, open_id, enc(t.access_token), enc(t.refresh_token),
         isoIn(t.expires_in ?? 7200), isoIn(t.refresh_expires_in ?? 30 * 86400, 3600),
         t.scope || '', now());
  return true;
}

/** 工作台/桥接用：该顾问授权状态（绝不返回令牌本体）。 */
export function tokenStatus(db, consultant_id) {
  const r = db.prepare(`SELECT access_expires_at, refresh_expires_at, needs_reauth, updated_at
    FROM consultant_tokens WHERE consultant_id=?`).get(consultant_id);
  if (!r) return { authorized: false, needs_reauth: false };
  return { authorized: true, needs_reauth: !!r.needs_reauth,
           access_expires_at: r.access_expires_at, updated_at: r.updated_at };
}

/**
 * 取一个可用的 access_token：未到期直接解密返回；临期走 refresh（refresh_token 轮换，
 * 新对整体落库）；refresh 被拒或已过期 → 标 needs_reauth=1，返回 null（桥接跳过该顾问，
 * 绝不阻断其他人）。fetchImpl 可注入（测试不打真实网络）。
 */
export async function getValidAccessToken(db, consultant_id, fetchImpl = fetch) {
  const r = db.prepare('SELECT * FROM consultant_tokens WHERE consultant_id=?').get(consultant_id);
  if (!r || r.needs_reauth) return null;
  if (Date.now() < Date.parse(r.access_expires_at) - 5 * 60 * 1000) {
    try { return dec(r.access_token_enc); } catch { return null; }
  }
  if (Date.now() > Date.parse(r.refresh_expires_at)) {
    db.prepare('UPDATE consultant_tokens SET needs_reauth=1, updated_at=? WHERE consultant_id=?')
      .run(now(), consultant_id);
    return null;
  }
  let refreshToken;
  try { refreshToken = dec(r.refresh_token_enc); } catch { return null; }
  try {
    const appToken = await appAccessToken(fetchImpl);
    const resp = await fetchImpl('https://open.feishu.cn/open-apis/authen/v1/oidc/refresh_access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${appToken}` },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      signal: AbortSignal.timeout(45000),
    });
    const d = await resp.json();
    if (d.code !== 0 || !d.data?.access_token || !d.data?.refresh_token) {
      // 任何 refresh 失败一律视为需重新授权（保守：不区分错误码，避免泄露令牌细节到日志）
      db.prepare('UPDATE consultant_tokens SET needs_reauth=1, updated_at=? WHERE consultant_id=?')
        .run(now(), consultant_id);
      console.error(`[feishu] refresh 失败 cid=${consultant_id} code=${d.code}（已标 needs_reauth）`);
      return null;
    }
    db.prepare(`UPDATE consultant_tokens SET access_token_enc=?, refresh_token_enc=?,
      access_expires_at=?, refresh_expires_at=?, needs_reauth=0, updated_at=? WHERE consultant_id=?`)
      .run(enc(d.data.access_token), enc(d.data.refresh_token),
           isoIn(d.data.expires_in ?? 7200), isoIn(d.data.refresh_expires_in ?? 30 * 86400, 3600),
           now(), consultant_id);
    return d.data.access_token;
  } catch (e) {
    // 网络/超时错误不标 needs_reauth（下轮重试），只跳过本轮
    console.error(`[feishu] refresh 异常 cid=${consultant_id}：${String(e.message).slice(0, 120)}`);
    return null;
  }
}

/** 直连飞书 OpenAPI（用户身份）。code!=0 → throw（只带错误码，不回显响应体）。 */
export async function feishuGet(path, token, fetchImpl = fetch) {
  const resp = await fetchImpl(`https://open.feishu.cn${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(45000), // 与 bridge.js lark-cli 45s 上限等价
  });
  const d = await resp.json();
  if (d.code !== 0) throw new Error(`feishu_api code=${d.code}`);
  return d.data || {};
}

/** 该用户所在的全部群（自动翻页）。返回 Map(chat_id → name)。 */
export async function listUserChats(token, fetchImpl = fetch) {
  const out = new Map();
  let pageToken = '';
  do {
    const d = await feishuGet(`/open-apis/im/v1/chats?page_size=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`, token, fetchImpl);
    for (const c of d.items || []) if (c.chat_id) out.set(c.chat_id, c.name || '');
    pageToken = d.has_more ? d.page_token : '';
  } while (pageToken);
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
/** 飞书 create_time（毫秒字符串）→ 'YYYY-MM-DD HH:mm'（Asia/Shanghai，与 lark-cli 输出同形）。 */
export const msToLocal = (ms) => {
  const d = new Date(Number(ms) + 8 * 3600 * 1000); // 服务器时区不保证 +08:00，手动偏
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
/** 游标 'YYYY-MM-DD HH:mm'（+08:00 语义）→ epoch 秒（API start_time 参数）。 */
export const checkpointToEpoch = (s) =>
  Math.floor(Date.parse(String(s || '').replace(' ', 'T') + ':00+08:00') / 1000);

/** 拉某群一页消息（用户身份）。order: 'asc'|'desc'；startCheckpoint 仅 asc 增量用。
 * 返回与 lark-cli 同形的消息对象数组（bridge 的 ingestMessages 无需改）。 */
export async function listChatMessages(token, chatId, { order = 'asc', startCheckpoint = '', pageSize = 50 } = {}, fetchImpl = fetch) {
  const sort = order === 'asc' ? 'ByCreateTimeAsc' : 'ByCreateTimeDesc';
  let path = `/open-apis/im/v1/messages?container_id_type=chat&container_id=${encodeURIComponent(chatId)}&sort_type=${sort}&page_size=${pageSize}`;
  if (startCheckpoint) path += `&start_time=${checkpointToEpoch(startCheckpoint)}`;
  const d = await feishuGet(path, token, fetchImpl);
  return (d.items || [])
    .filter((m) => !m.deleted && m.message_id)
    .map((m) => ({
      message_id: m.message_id,
      chat_id: m.chat_id || chatId,
      msg_type: m.msg_type || '',
      content: typeof m.body?.content === 'string' ? m.body.content : JSON.stringify(m.body?.content ?? ''),
      create_time: msToLocal(m.create_time),
      deleted: false,
      sender: { name: m.sender?.id || '' }, // 原生 API 不给姓名（lark-cli 有富化）；只存 id
    }));
}

/** 职位盘点 Bitable（用户身份，自动翻页）。返回原始 record 数组（fields 为列名→值）。 */
export async function listBitableRecords(token, baseToken, tableId, fetchImpl = fetch) {
  const items = [];
  let pageToken = '';
  do {
    const d = await feishuGet(`/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records?page_size=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`, token, fetchImpl);
    items.push(...(d.items || []));
    pageToken = d.has_more ? d.page_token : '';
  } while (pageToken);
  return items;
}
