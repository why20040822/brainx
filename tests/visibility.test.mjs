/** visibility.test.mjs — 可见性闸门：跨人读职位/同步/回放一律 404，事件结果按人过滤，
 * SSE 定向投递，OAuth 回调落令牌。 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { runSync } from '../src/sync.js';
import { recommend } from '../src/recommend.js';
import { engage } from '../src/engagement.js';
import { recordOutcome } from '../src/replay.js';
import { jobVisibleTo } from '../src/visibility.js';
import { createServer } from '../src/server.js';
import { signSession } from '../src/session.js';
import { signState } from '../src/oauth.js';
import { tokenStatus } from '../src/feishu.js';
import http from 'node:http';

let db;
before(() => {
  db = openDb(':memory:');
  runSync(db, { source: 'fixture', consultant_id: 'felix' }); // 60 职位 + felix 策展关系
});

const PID = 'P-FIX-E5FC611B'; // fixture 中 felix PRIMARY_PM 的职位

const serve = async () => {
  const server = createServer(db);
  await new Promise((r) => server.listen(0, r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
};
const cookie = (cid) => `brainx_session=${encodeURIComponent(signSession(cid, `ou_${cid}`))}`;

test('jobVisibleTo：有关系/被推荐/操作过可见；陌生人不可见', () => {
  assert.equal(jobVisibleTo(db, 'felix', PID), true);   // 策展关系
  assert.equal(jobVisibleTo(db, 'mia', PID), false);    // 无任何关系
  assert.equal(jobVisibleTo(db, 'mia', 'P-NOPE'), false);
  // mia 操作过（VIEW）→ 可见
  engage(db, 'mia', PID, 'VIEW', { idempotency_key: 'vis:mia:view' });
  assert.equal(jobVisibleTo(db, 'mia', PID), true);
});

test('HTTP 闸门：陌生人读职位 404；主人 200 且事件/结果只含自己的', async () => {
  // felix 与 mia 都操作过同一职位（mia 在上面 VIEW 过）
  engage(db, 'felix', PID, 'WATCH', { idempotency_key: 'vis:felix:watch' });
  recordOutcome(db, 'felix', { project_id: PID, stage: '面试', value: { rating: 4 }, idempotency_key: 'vis:o:f' });
  recordOutcome(db, 'mia', { project_id: PID, stage: '关闭', value: { rating: 2 }, idempotency_key: 'vis:o:m' });

  const { server, base } = await serve();
  // york（陌生人）→ 404，职位事实不出库
  const r404 = await fetch(`${base}/api/v1/opportunities/${PID}`, { headers: { Cookie: cookie('york') } });
  assert.equal(r404.status, 404);

  // felix → 200，事件只有自己的，结果只有自己的
  const r200 = await fetch(`${base}/api/v1/opportunities/${PID}`, { headers: { Cookie: cookie('felix') } });
  assert.equal(r200.status, 200);
  const d = await r200.json();
  assert.equal(d.job.project_id, PID);
  assert.ok(d.events.length >= 1);
  assert.ok(d.events.every((e) => e.actor === 'felix'), '事件不得含他人 actor');
  assert.ok(d.outcomes.every((o) => o.stage !== '关闭'), '结果不得含他人的');

  server.closeAllConnections?.(); server.close();
});

test('HTTP 闸门：sync-runs 与 replay 只能看自己的', async () => {
  const s = runSync(db, { source: 'bridge', consultant_id: 'mia',
    payload: { as_of: '2026-08-10T00:00:00Z', jobs: [] } });
  const rec = recommend(db, 'felix', { top: 10 });
  const decisionId = rec.items[0].decision_id;

  const { server, base } = await serve();
  // mia 的 sync 批次，felix 读 → 404；本人读 → 200
  const r1 = await fetch(`${base}/api/v1/sync-runs/${s.sync_id}`, { headers: { Cookie: cookie('felix') } });
  assert.equal(r1.status, 404);
  const r2 = await fetch(`${base}/api/v1/sync-runs/${s.sync_id}`, { headers: { Cookie: cookie('mia') } });
  assert.equal(r2.status, 200);
  // felix 的推荐回放，mia 读 → 404；本人读 → 200
  const r3 = await fetch(`${base}/api/v1/decisions/${decisionId}/replay`, { headers: { Cookie: cookie('mia') } });
  assert.equal(r3.status, 404);
  const r4 = await fetch(`${base}/api/v1/decisions/${decisionId}/replay`, { headers: { Cookie: cookie('felix') } });
  assert.equal(r4.status, 200);
  server.closeAllConnections?.(); server.close();
});

test('SSE 定向：带 consultant_id 的事件只发本人；无标识的广播所有人', async () => {
  const { server, base } = await serve();
  const listen = (cid, got) => new Promise((resolve, reject) => {
    http.get(`${base}/api/v1/events`, { headers: { Cookie: cookie(cid) }, }, (res) => {
      res.on('data', (c) => {
        for (const line of c.toString().split('\n')) {
          if (line.startsWith('data: ')) {
            const m = JSON.parse(line.slice(6));
            if (m.type !== 'hello') got.push(m);
          }
        }
      });
      resolve(res);
    }).on('error', reject);
  });
  const gotMia = [], gotFelix = [];
  const rm = await listen('mia', gotMia);
  const rf = await listen('felix', gotFelix);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(server.bus.clientCount(), 2);

  server.bus.emit({ type: 'sync', consultant_id: 'mia', new_messages: 3 });
  server.bus.emit({ type: 'recommend', at: 't' }); // 广播
  await new Promise((r) => setTimeout(r, 100));

  assert.ok(gotMia.some((m) => m.type === 'sync' && m.new_messages === 3), 'mia 应收到自己的 sync');
  assert.ok(!gotFelix.some((m) => m.type === 'sync'), 'felix 不得收到 mia 的 sync');
  assert.ok(gotMia.some((m) => m.type === 'recommend') && gotFelix.some((m) => m.type === 'recommend'),
    '广播两人都应收到');

  rm.destroy(); rf.destroy();
  server.closeAllConnections?.(); server.close();
});

test('OAuth 回调：带令牌对的身份 → 加密入库，可立即用于按人桥接', async () => {
  process.env.BRAINX_FEISHU_APP_SECRET = 'test-secret';
  const dbx = openDb(':memory:');
  const stubIdentity = {
    open_id: 'ou_1947320b06c2381f46ef8072e578be7a', name: 'Mia 钟笑咪',
    tokens: { access_token: 'at_cb', refresh_token: 'rt_cb', expires_in: 7200,
              refresh_expires_in: 30 * 86400, scope: 'offline_access' },
  };
  const server = createServer(dbx, { exchangeCode: async () => stubIdentity });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(`${base}/api/v1/oauth/callback?code=abc&state=${encodeURIComponent(signState())}`,
    { redirect: 'manual' });
  assert.equal(r.status, 302);
  const st = tokenStatus(dbx, 'mia');
  assert.equal(st.authorized, true);
  const { getValidAccessToken } = await import('../src/feishu.js');
  assert.equal(await getValidAccessToken(dbx, 'mia', async () => { throw new Error('不应发请求'); }), 'at_cb');
  server.closeAllConnections?.(); server.close();
  delete process.env.BRAINX_FEISHU_APP_SECRET;
});

test('OAuth 回调：无令牌对的旧桩身份 → 登录不崩，无令牌行', async () => {
  process.env.BRAINX_FEISHU_APP_SECRET = 'test-secret';
  const dbx = openDb(':memory:');
  const server = createServer(dbx, { exchangeCode: async () => ({ open_id: 'ou_1947320b06c2381f46ef8072e578be7a', name: 'Mia' }) });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(`${base}/api/v1/oauth/callback?code=abc&state=${encodeURIComponent(signState())}`,
    { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/');
  assert.equal(tokenStatus(dbx, 'mia').authorized, false);
  server.closeAllConnections?.(); server.close();
  delete process.env.BRAINX_FEISHU_APP_SECRET;
});
