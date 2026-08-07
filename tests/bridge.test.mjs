/** bridge.test.mjs — 桥接器：游标增量/消息去重/公司匹配/关系不动/SSE。 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { runSync, loadFixture } from '../src/sync.js';
import { deriveProjectId, fetchBitablePayload, ingestMessages, matchJob,
         bridgeOnce, BRIDGE_CHATS } from '../src/bridge.js';
import { createServer } from '../src/server.js';
import { signSession } from '../src/session.js';
import http from 'node:http';

let db;
before(() => { db = openDb(':memory:'); });

const MSG = (id, text, ts = '2026-08-07 12:00') => ({
  message_id: id, chat_id: 'oc_x', msg_type: 'text', content: text,
  create_time: ts, deleted: false, sender: { name: 'Felix 黄鑫' },
});

test('deriveProjectId 与 fixture 同一推导（同源公司合并）', () => {
  assert.equal(deriveProjectId('Rockflow', '产品、工程、运营增长（多岗）'), 'P-FIX-E5FC611B');
});

test('桥接 payload 同步：relation=null 不动既有关系（Felix 的 PRIMARY_PM 不被冲掉）', () => {
  runSync(db, { source: 'fixture', consultant_id: 'felix' }); // 种子（含策展关系）
  const before = db.prepare(`SELECT relation FROM job_memberships
    WHERE consultant_id='felix' AND project_id='P-FIX-E5FC611B' AND valid_to IS NULL`).get();
  assert.equal(before.relation, 'PRIMARY_PM');

  const { as_of, jobs } = loadFixture();
  const payload = { as_of, jobs: jobs.map((j) => ({ ...j, relation: null,
    city: j.project_id === 'P-FIX-E5FC611B' ? '北京·望京' : j.city })) };
  const out = runSync(db, { source: 'bridge', consultant_id: 'felix', payload });
  assert.equal(out.complete, true);

  const rel = db.prepare(`SELECT relation FROM job_memberships
    WHERE consultant_id='felix' AND project_id='P-FIX-E5FC611B' AND valid_to IS NULL`).get();
  assert.equal(rel.relation, 'PRIMARY_PM'); // 关系没动
  const job = db.prepare(`SELECT city FROM job_facts WHERE project_id='P-FIX-E5FC611B'`).get();
  assert.equal(job.city, '北京·望京');      // 事实刷新了
});

test('消息入库：message_id 去重 + 公司词典命中 + 游标推进', () => {
  const m1 = [MSG('om_1', 'Rockflow 昨天新增 2 个 HC，JD 已更新', '2026-08-07 12:01'),
              MSG('om_2', '今天天气不错', '2026-08-07 12:02')];
  const r1 = ingestMessages(db, 'oc_x', m1);
  assert.equal(r1.inserted, 2);
  assert.equal(r1.matched, 1); // om_1 命中 Rockflow
  const hit = db.prepare(`SELECT matched_project_id FROM job_messages WHERE message_id='om_1'`).get();
  assert.equal(hit.matched_project_id, 'P-FIX-E5FC611B');
  // 重复拉取同一批 → 0 新增（幂等）
  const r2 = ingestMessages(db, 'oc_x', m1);
  assert.equal(r2.inserted, 0);
  // 游标推进到最大 sent_at
  const cur = db.prepare(`SELECT checkpoint FROM bridge_cursor WHERE source='chat:oc_x'`).get();
  assert.equal(cur.checkpoint, '2026-08-07 12:02');
  // matchJob 直接验证：未知文本 → null
  assert.equal(matchJob(db, '完全无关的内容'), null);
});

test('bridgeOnce：execImpl 桩全链 + 二次运行 changed=false（幂等）', () => {
  const db2 = openDb(':memory:');
  const fixture = loadFixture();
  const bitableResp = {
    data: { fields: ['公司', '职位', '地点', '主做', '还做吗', '文本', '公司类型'],
      data: [[['测试客户A'], ['增长'], ['上海'], null, ['有，正常招'], null, ['AI 2C']]],
      record_id_list: ['rec_x'] },
  };
  const msgsResp = { data: { messages: [MSG('om_b1', '测试客户A 的 JD 更新了', '2026-08-07 13:00')] } };
  const execImpl = (args) => (args[0] === 'base' ? bitableResp : msgsResp);

  const out1 = bridgeOnce(db2, { consultant_ids: ['felix'], execImpl });
  assert.equal(out1.changed, true);
  assert.equal(out1.new_messages, 1);
  assert.equal(out1.matched, 1); // 消息命中刚入库的 测试客户A
  assert.equal(out1.syncs[0].complete, true);
  const job = db2.prepare(`SELECT * FROM job_facts WHERE company='测试客户A'`).get();
  assert.equal(job.project_id, deriveProjectId('测试客户A', '增长'));

  const out2 = bridgeOnce(db2, { consultant_ids: ['felix'], execImpl });
  assert.equal(out2.changed, false);  // hash 相同 + 消息已去重
  assert.equal(out2.new_messages, 0);
});

test('SSE：连接收 hello，bus.emit 送达，未登录 401', async () => {
  const server = createServer(db);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = `brainx_session=${encodeURIComponent(signSession('felix', 'ou_x'))}`;

  // 未登录 → 401
  const r401 = await fetch(`${base}/api/v1/events`);
  assert.equal(r401.status, 401);

  // 登录连接 → hello + 广播
  const res = await new Promise((resolve, reject) => {
    http.get(`${base}/api/v1/events`, { headers: { Cookie: cookie } }, resolve).on('error', reject);
  });
  assert.equal(res.headers['content-type'].includes('text/event-stream'), true);
  let buf = '';
  const got = [];
  res.on('data', (c) => {
    buf += c;
    for (const line of buf.split('\n')) {
      if (line.startsWith('data: ')) got.push(JSON.parse(line.slice(6)));
    }
  });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(got.some((m) => m.type === 'hello' && m.consultant_id === 'felix'));
  assert.equal(server.bus.clientCount(), 1);
  server.bus.emit({ type: 'sync', new_messages: 2 });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(got.some((m) => m.type === 'sync' && m.new_messages === 2));
  res.destroy();
  server.closeAllConnections?.(); server.close();
});
