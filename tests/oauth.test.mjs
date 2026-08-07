/** oauth.test.mjs — 飞书 OAuth 登录链路：state/花名册/回调/dev 门禁。 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDb } from '../src/db.js';
import { signState, verifyState, buildAuthorizeUrl } from '../src/oauth.js';
import { seedRoster, findByOpenId, listConsultants, upsertMembers } from '../src/roster.js';
import { signSession, verifySession, sessionSecret } from '../src/session.js';
import { createServer } from '../src/server.js';

let db;
before(() => {
  process.env.BRAINX_DB = ':memory:';
  db = openDb(':memory:');
});

test('花名册：种子幂等 + open_id 匹配 + 在线 upsert 不丢画像', () => {
  const n = seedRoster(db);
  assert.equal(n, 3); // felix/mia/york（FLX 群实拉种子）
  seedRoster(db);     // 再播一次不报错
  const all = listConsultants(db);
  assert.equal(all.length, 3);
  const felix = findByOpenId(db, 'ou_718417b9cb0db1e061fe8eae5c9ac95f');
  assert.equal(felix.consultant_id, 'felix');
  assert.ok(felix.profile_keywords.includes('增长')); // 画像合并进来了
  // 在线刷新同一 open_id → 不重复、不覆盖画像
  upsertMembers(db, [{ name: 'Felix 黄鑫', member_id: 'ou_718417b9cb0db1e061fe8eae5c9ac95f' }]);
  assert.equal(listConsultants(db).length, 3);
  assert.ok(findByOpenId(db, 'ou_718417b9cb0db1e061fe8eae5c9ac95f').profile_keywords.includes('增长'));
  assert.equal(findByOpenId(db, 'ou_unknown'), null);
});

test('oauth state：签发/校验/篡改/过期', () => {
  const s = signState();
  assert.ok(verifyState(s));
  assert.ok(!verifyState(s.slice(0, -2) + 'aa'));          // 篡改签名
  assert.ok(!verifyState('garbage'));                       // 畸形
  const [nonce] = s.split('.');
  const oldTs = String(Date.now() - 11 * 60 * 1000);
  // 用旧时间戳重签一个"合法但过期"的 state
  const sig = createHmac('sha256', sessionSecret()).update(`oauth.${nonce}.${oldTs}`).digest('hex');
  assert.ok(!verifyState(`${nonce}.${oldTs}.${sig}`));      // 过期
});

test('session：open_id 绑定 + 篡改拒绝', () => {
  const t = signSession('felix', 'ou_718417b9cb0db1e061fe8eae5c9ac95f');
  const v = verifySession(t);
  assert.equal(v.consultant_id, 'felix');
  assert.equal(v.open_id, 'ou_718417b9cb0db1e061fe8eae5c9ac95f');
  assert.equal(verifySession(t.replace('felix', 'miaxx')), null); // 改身份 → 签名不符
  assert.equal(verifySession('felix..12345.deadbeef'), null);
});

test('OAuth HTTP 流：authorize 302 + 回调换身份 + 花名册 fail-closed + dev 门禁', async () => {
  process.env.BRAINX_FEISHU_APP_SECRET = 'test-secret'; // 测试用假 secret，仅触发 configured
  delete process.env.BRAINX_DEV_AUTH;
  const stubIdentity = { open_id: 'ou_1947320b06c2381f46ef8072e578be7a', name: 'Mia 钟笑咪' };
  const server = createServer(db, { exchangeCode: async () => stubIdentity });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // 1. authorize → 302 到飞书，带 state
  const r1 = await fetch(`${base}/api/v1/oauth/authorize`, { redirect: 'manual' });
  assert.equal(r1.status, 302);
  const loc = new URL(r1.headers.get('location'));
  assert.ok(loc.href.startsWith('https://accounts.feishu.cn/'));
  const state = loc.searchParams.get('state');
  assert.ok(verifyState(state));
  assert.equal(loc.searchParams.get('app_id'), 'cli_aac5c592feb89cd0');

  // 2. 回调：合法 state + code → 匹配 mia → Set-Cookie + 302 /
  const r2 = await fetch(`${base}/api/v1/oauth/callback?code=abc&state=${encodeURIComponent(state)}`,
    { redirect: 'manual' });
  assert.equal(r2.status, 302);
  assert.equal(r2.headers.get('location'), '/');
  const cookie = r2.headers.get('set-cookie');
  assert.match(cookie, /brainx_session=/);
  const token = /brainx_session=([^;]+)/.exec(cookie)[1];
  assert.equal(verifySession(decodeURIComponent(token)).consultant_id, 'mia');

  // 3. 带合法 cookie 访问 workbench → 200
  const r3 = await fetch(`${base}/api/v1/workbench`, { headers: { Cookie: `brainx_session=${token}` } });
  assert.equal(r3.status, 200);

  // 4. 坏 state → /login?error=bad_state
  const r4 = await fetch(`${base}/api/v1/oauth/callback?code=abc&state=bad`, { redirect: 'manual' });
  assert.match(r4.headers.get('location'), /error=bad_state/);

  // 5. dev 门禁：未开 BRAINX_DEV_AUTH → POST session 403
  const r5 = await fetch(`${base}/api/v1/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consultant_id: 'felix' }) });
  assert.equal(r5.status, 403);

  server.closeAllConnections?.(); server.close();
  delete process.env.BRAINX_FEISHU_APP_SECRET;
});

test('OAuth 回调：不在花名册的飞书账号 → not_in_roster', async () => {
  process.env.BRAINX_FEISHU_APP_SECRET = 'test-secret';
  const server = createServer(db, { exchangeCode: async () => ({ open_id: 'ou_outsider', name: '外人' }) });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const state = signState();
  const r = await fetch(`${base}/api/v1/oauth/callback?code=abc&state=${encodeURIComponent(state)}`,
    { redirect: 'manual' });
  assert.match(r.headers.get('location'), /error=not_in_roster/);
  assert.equal(r.headers.get('set-cookie'), null); // 不发 cookie
  server.closeAllConnections?.(); server.close();
  delete process.env.BRAINX_FEISHU_APP_SECRET;
});
