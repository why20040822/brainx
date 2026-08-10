/** bridge.test.mjs — 桥接器：游标增量/消息去重/公司匹配/关系不动/SSE/按人隔离。 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { runSync, loadFixture } from '../src/sync.js';
import { deriveProjectId, fetchBitablePayload, ingestMessages, matchJob,
         bridgeOnce, BRIDGE_CHATS } from '../src/bridge.js';
import { saveUserTokens } from '../src/feishu.js';
import { createServer } from '../src/server.js';
import { signSession } from '../src/session.js';
import http from 'node:http';

let db;
before(() => { db = openDb(':memory:'); });

const MSG = (id, text, ts = '2026-08-07 12:00') => ({
  message_id: id, chat_id: 'oc_x', msg_type: 'text', content: text,
  create_time: ts, deleted: false, sender: { name: 'Felix 黄鑫' },
});

/** 原生 API 形状的桩：按 URL 路由到 群列表/消息/Bitable。 */
const RAW_MSG = (id, text, ms) => ({
  message_id: id, chat_id: BRIDGE_CHATS[2].chat_id, msg_type: 'text',
  body: { content: JSON.stringify({ text }) },
  create_time: String(ms), deleted: false, sender: { id: 'ou_felix' },
});
const FLX = BRIDGE_CHATS[2].chat_id; // oc_667758eb…（FLX-职位优先级群）

const apiStub = ({ chats = [FLX], messages = [], bitableItems = [] } = {}) => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const j = () => {
      if (url.includes('/im/v1/chats')) {
        return { code: 0, data: { items: chats.map((c) => ({ chat_id: c, name: '群' })), has_more: false } };
      }
      if (url.includes('/im/v1/messages')) {
        return { code: 0, data: { items: messages, has_more: false } };
      }
      if (url.includes('/bitable/')) {
        return { code: 0, data: { items: bitableItems, has_more: false } };
      }
      return { code: 999, msg: `unstubbed ${url}` };
    };
    return { json: async () => j() };
  };
  return { api: { fetchImpl }, calls };
};

const bitableA = { record_id: 'rec_x', fields: {
  '公司': [{ text: '测试客户A' }], '职位': [{ text: '增长' }], '还做吗': [{ text: '有，正常招' }] } };

const seedTokens = (dbx, cid) => saveUserTokens(dbx, cid, `ou_${cid}`, {
  access_token: `at_${cid}`, refresh_token: `rt_${cid}`,
  expires_in: 7200, refresh_expires_in: 30 * 86400, scope: 'offline_access',
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

test('bridgeOnce（直连通道）：按人令牌全链 + 二次运行 changed=false（幂等）', async () => {
  const db2 = openDb(':memory:');
  seedTokens(db2, 'felix');
  const { api } = apiStub({
    bitableItems: [bitableA],
    messages: [RAW_MSG('om_b1', '测试客户A 的 JD 更新了', Date.parse('2026-08-07T13:00:00+08:00'))],
  });

  const out1 = await bridgeOnce(db2, { consultant_ids: ['felix'], api });
  assert.equal(out1.changed, true);
  assert.equal(out1.new_messages, 1);
  assert.equal(out1.matched, 1); // 消息命中刚入库的 测试客户A
  assert.equal(out1.syncs[0].complete, true);
  assert.equal(out1.skipped.length, 0);
  const job = db2.prepare(`SELECT * FROM job_facts WHERE company='测试客户A'`).get();
  assert.equal(job.project_id, deriveProjectId('测试客户A', '增长'));
  // 可见性归属到 felix；游标按人推进
  const vis = db2.prepare(`SELECT consultant_id FROM job_message_visibility WHERE message_id='om_b1'`).get();
  assert.equal(vis.consultant_id, 'felix');
  const cur = db2.prepare(`SELECT checkpoint FROM bridge_cursor WHERE source='chat:${FLX}@felix'`).get();
  assert.equal(cur.checkpoint, '2026-08-07 13:00');

  const out2 = await bridgeOnce(db2, { consultant_ids: ['felix'], api });
  assert.equal(out2.changed, false);  // hash 相同 + 消息已去重
  assert.equal(out2.new_messages, 0);
});

test('bridgeOnce 按人隔离：无令牌者 skipped，消息可见性只归持令牌且实际在群的人', async () => {
  const db3 = openDb(':memory:');
  seedTokens(db3, 'mia'); // felix 无令牌
  const { api } = apiStub({
    bitableItems: [bitableA],
    messages: [RAW_MSG('om_iso1', '测试客户A 加急', Date.parse('2026-08-08T09:00:00+08:00'))],
  });
  const out = await bridgeOnce(db3, { consultant_ids: ['mia', 'felix'], api });
  assert.deepEqual(out.skipped, ['felix']);
  assert.equal(out.new_messages, 1);
  // 同一消息行全局一条；可见性只有 mia
  const msgCount = db3.prepare(`SELECT COUNT(*) c FROM job_messages WHERE message_id='om_iso1'`).get();
  assert.equal(msgCount.c, 1);
  const visAll = db3.prepare(`SELECT consultant_id FROM job_message_visibility WHERE message_id='om_iso1'`).all();
  assert.deepEqual(visAll.map((v) => v.consultant_id), ['mia']);
  // 但 Bitable 团队池两人都落了 sync_runs（共享池不因个人令牌缺失而断）
  assert.equal(out.syncs.length, 2);
});

test('bridgeOnce 非成员不读：群不在其 im/v1/chats 结果里 → 一条不拉', async () => {
  const db4 = openDb(':memory:');
  seedTokens(db4, 'york');
  const { api, calls } = apiStub({
    chats: ['oc_some_other_group'], // york 不在 FLX 群
    bitableItems: [bitableA],
    messages: [RAW_MSG('om_never', '测试客户A', Date.parse('2026-08-08T09:00:00+08:00'))],
  });
  const out = await bridgeOnce(db4, { consultant_ids: ['york'], api });
  assert.equal(out.new_messages, 0);
  assert.equal(calls.filter((u) => u.includes('/im/v1/messages')).length, 0); // 根本没发起消息拉取
});

test('bridgeOnce 兼容模式：api=null 时走 lark-cli 拉 Bitable，不碰消息', async () => {
  const db5 = openDb(':memory:');
  const bitableResp = {
    data: { fields: ['公司', '职位', '地点', '主做', '还做吗', '文本', '公司类型'],
      data: [[['测试客户A'], ['增长'], ['上海'], null, ['有，正常招'], null, ['AI 2C']]],
      record_id_list: ['rec_x'] },
  };
  const execImpl = () => bitableResp;
  const out = await bridgeOnce(db5, { consultant_ids: ['felix'], execImpl, api: null });
  assert.equal(out.changed, true);
  assert.equal(out.new_messages, 0);
  assert.equal(out.syncs[0].rows, 1);
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
