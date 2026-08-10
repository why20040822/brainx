/** feishu.test.mjs — 令牌加密往返/refresh 轮换与降级/直连 API 助手。绝不打真实网络。 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { saveUserTokens, getValidAccessToken, tokenStatus,
         listUserChats, listChatMessages, msToLocal, checkpointToEpoch } from '../src/feishu.js';

let db;
before(() => { db = openDb(':memory:'); });

const TOK = { access_token: 'at_real', refresh_token: 'rt_real',
              expires_in: 7200, refresh_expires_in: 30 * 86400, scope: 'offline_access im:message:readonly' };

test('令牌入库加密：库里无明文，getValidAccessToken 解密往返', async () => {
  assert.equal(saveUserTokens(db, 'mia', 'ou_mia', TOK), true);
  const row = db.prepare('SELECT * FROM consultant_tokens WHERE consultant_id=?').get('mia');
  assert.ok(!row.access_token_enc.includes('at_real'), '密文不得含明文');
  assert.ok(!row.refresh_token_enc.includes('rt_real'), '密文不得含明文');
  assert.match(row.access_token_enc, /^v1\./);
  const noFetch = async () => { throw new Error('不应发网络请求'); };
  const t = await getValidAccessToken(db, 'mia', noFetch);
  assert.equal(t, 'at_real');
  // 状态接口不泄露令牌
  const st = tokenStatus(db, 'mia');
  assert.equal(st.authorized, true);
  assert.equal(st.needs_reauth, false);
  assert.ok(!JSON.stringify(st).includes('at_real'));
});

test('缺 refresh_token 不存（没勾选 offline_access 的授权直接拒收）', () => {
  assert.equal(saveUserTokens(db, 'nobody', 'ou_n', { access_token: 'a' }), false);
  assert.equal(db.prepare('SELECT 1 FROM consultant_tokens WHERE consultant_id=?').get('nobody'), undefined);
});

test('临期令牌走 refresh：新对整体落库（refresh 轮换），旧的不留', async () => {
  saveUserTokens(db, 'felix', 'ou_felix', TOK);
  db.prepare(`UPDATE consultant_tokens SET access_expires_at=? WHERE consultant_id='felix'`)
    .run(new Date(Date.now() + 60 * 1000).toISOString()); // 1 分钟后到期 < 5 分钟余量
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    if (url.includes('app_access_token/internal')) {
      return { json: async () => ({ code: 0, app_access_token: 'app_t' }) };
    }
    if (url.includes('refresh_access_token')) {
      // 服务端收到的是解密后的旧 refresh_token
      assert.equal(JSON.parse(opts.body).refresh_token, 'rt_real');
      return { json: async () => ({ code: 0, data: {
        access_token: 'at_new', refresh_token: 'rt_new', expires_in: 7200, refresh_expires_in: 30 * 86400 } }) };
    }
    throw new Error(`unstubbed ${url}`);
  };
  const t = await getValidAccessToken(db, 'felix', fetchImpl);
  assert.equal(t, 'at_new');
  assert.equal(calls.length, 2);
  // 第二轮：新令牌未临期 → 零网络
  const t2 = await getValidAccessToken(db, 'felix', async () => { throw new Error('不应发请求'); });
  assert.equal(t2, 'at_new');
  const row = db.prepare('SELECT refresh_token_enc FROM consultant_tokens WHERE consultant_id=?').get('felix');
  assert.ok(!row.refresh_token_enc.includes('rt_new'));
});

test('refresh 被拒 → needs_reauth=1 且不再发网络请求；网络异常不标记（下轮重试）', async () => {
  saveUserTokens(db, 'york', 'ou_york', TOK);
  db.prepare(`UPDATE consultant_tokens SET access_expires_at=? WHERE consultant_id='york'`)
    .run(new Date(Date.now() + 60 * 1000).toISOString());
  const rejectFetch = async (url) => {
    if (url.includes('app_access_token')) return { json: async () => ({ code: 0, app_access_token: 'a' }) };
    return { json: async () => ({ code: 20037, msg: 'invalid refresh token' }) };
  };
  assert.equal(await getValidAccessToken(db, 'york', rejectFetch), null);
  assert.equal(tokenStatus(db, 'york').needs_reauth, true);
  // 已标记 → 不再尝试 refresh
  assert.equal(await getValidAccessToken(db, 'york', async () => { throw new Error('不应发请求'); }), null);

  // 网络异常：不标 needs_reauth
  saveUserTokens(db, 'mia', 'ou_mia', TOK); // 覆盖回有效态
  db.prepare(`UPDATE consultant_tokens SET access_expires_at=? WHERE consultant_id='mia'`)
    .run(new Date(Date.now() + 60 * 1000).toISOString());
  assert.equal(await getValidAccessToken(db, 'mia', async () => { throw new Error('ETIMEDOUT'); }), null);
  assert.equal(tokenStatus(db, 'mia').needs_reauth, false);
});

test('refresh 已过期 → 直接 needs_reauth，不发请求', async () => {
  saveUserTokens(db, 'ghost', 'ou_ghost', TOK);
  db.prepare(`UPDATE consultant_tokens SET access_expires_at=?, refresh_expires_at=? WHERE consultant_id='ghost'`)
    .run(new Date(Date.now() + 60 * 1000).toISOString(), new Date(Date.now() - 1000).toISOString());
  assert.equal(await getValidAccessToken(db, 'ghost', async () => { throw new Error('不应发请求'); }), null);
  assert.equal(tokenStatus(db, 'ghost').needs_reauth, true);
});

test('listUserChats 自动翻页；listChatMessages 归一化 + start_time 换算', async () => {
  let page = 0;
  const chatsFetch = async (url) => {
    page++;
    return { json: async () => (page === 1
      ? { code: 0, data: { items: [{ chat_id: 'oc_a', name: 'A' }], has_more: true, page_token: 'p2' } }
      : { code: 0, data: { items: [{ chat_id: 'oc_b', name: 'B' }], has_more: false } }) };
  };
  const chats = await listUserChats('tok', chatsFetch);
  assert.deepEqual([...chats.keys()], ['oc_a', 'oc_b']);

  const ms = Date.parse('2026-08-07T13:05:00+08:00');
  const seen = [];
  const msgFetch = async (url) => {
    seen.push(url);
    return { json: async () => ({ code: 0, data: { has_more: false, items: [
      { message_id: 'om_1', chat_id: 'oc_a', msg_type: 'text',
        body: { content: '{"text":"Rockflow 新增 HC"}' }, create_time: String(ms),
        deleted: false, sender: { id: 'ou_x' } },
      { message_id: 'om_2', deleted: true }, // 已删除 → 滤掉
    ] } }) };
  };
  const msgs = await listChatMessages('tok', 'oc_a', { order: 'asc', startCheckpoint: '2026-08-07 12:00' }, msgFetch);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].message_id, 'om_1');
  assert.equal(msgs[0].create_time, '2026-08-07 13:05');
  assert.equal(msgs[0].sender.name, 'ou_x');
  assert.match(seen[0], /start_time=/);
  assert.match(seen[0], /ByCreateTimeAsc/);
});

test('时间换算：msToLocal 与 checkpointToEpoch 互逆（+08:00 语义）', () => {
  const ms = Date.parse('2026-08-07T13:05:00+08:00');
  assert.equal(msToLocal(ms), '2026-08-07 13:05');
  assert.equal(checkpointToEpoch('2026-08-07 13:05'), ms / 1000);
});
