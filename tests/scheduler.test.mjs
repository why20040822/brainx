/** scheduler.test.mjs — 每日两次定时推送（07:00/19:00 CST）+ 0012 占位清理。 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { runSync } from '../src/sync.js';
import { recommend } from '../src/recommend.js';
import { slotState, pushSlotFor } from '../src/scheduler.js';

let db;
before(() => { db = openDb(':memory:'); });

test('slotState：07:00/19:00 CST 窗口识别，窗口外不触发', () => {
  // 2026-08-14 07:00:30 CST = 2026-08-13T23:00:30Z
  assert.deepEqual(slotState(new Date('2026-08-13T23:00:30Z')), { inWindow: true, slotKey: '2026-08-14#0700' });
  assert.deepEqual(slotState(new Date('2026-08-14T11:01:00Z')), { inWindow: true, slotKey: '2026-08-14#1900' });
  assert.equal(slotState(new Date('2026-08-13T23:31:00Z')).inWindow, false); // 窗口外（07:31 CST）
  assert.equal(slotState(new Date('2026-08-13T22:59:00Z')).inWindow, false); // 差一分
});

test('pushSlotFor：同一时段幂等（push_log 唯一键），无推荐不发', () => {
  // 无推荐 → null
  assert.equal(pushSlotFor(db, 'mia', 'ou_x', '2026-08-14#0700', { send: false }), null);
  // 造一轮推荐
  runSync(db, { source: 'bridge', consultant_id: 'felix', payload: { as_of: '2026-08-14', jobs: [
    { project_id: 'JT1', company: '思谋科技', role: '算法工程师', city: '上海', pipeline: 'Sourcing×1',
      hc: 2, active_state: 'OPEN', relation: null, source_url: 'ttc://job/JT1' },
  ] } });
  recommend(db, 'felix', { top: 10 });
  const r1 = pushSlotFor(db, 'felix', 'ou_felix', '2026-08-14#0700', { send: false });
  assert.equal(r1.status, 'PREVIEW'); // send:false → PREVIEW 记录
  // 同时段重发：push_log 唯一键（felix, DAILY_TOP3, 2026-08-14#0700）→ 幂等跳过
  const r2 = pushSlotFor(db, 'felix', 'ou_felix', '2026-08-14#0700', { send: false });
  assert.equal(r2.status, 'SKIPPED_DUPLICATE');
  // 晚场是新时段 → 可再发
  const r3 = pushSlotFor(db, 'felix', 'ou_felix', '2026-08-14#1900', { send: false });
  assert.equal(r3.status, 'PREVIEW');
  const n = db.prepare(`SELECT COUNT(*) n FROM push_log WHERE consultant_id='felix' AND kind='DAILY_TOP3'`).get().n;
  assert.equal(n, 2);
});

test('0012：零引用占位行删除、有引用行 CLOSED（回放不破）', () => {
  // :memory: 在 openDb 时已跑 0012（空表无效果）；此处模拟存量再手动执行等价 SQL
  runSync(db, { source: 'bridge', consultant_id: 'felix', payload: { as_of: '2026-08-01', jobs: [
    { project_id: 'P-FIX-ORPHAN1', company: '孤儿公司', role: '岗', city: null, pipeline: null,
      hc: null, active_state: 'OPEN', relation: null, source_url: null },
    { project_id: 'P-FIX-LINKED1', company: '有史公司', role: '岗2', city: null, pipeline: null,
      hc: null, active_state: 'OPEN', relation: null, source_url: null },
  ] } });
  // 给 LINKED 造一个事件引用
  db.prepare(`INSERT INTO decision_events (event_id, event_type, actor, project_id, next_state, idempotency_key, occurred_at)
    VALUES ('e1','RECOMMENDED','felix','P-FIX-LINKED1','RECOMMENDED','k1','t')`).run();
  db.exec(`DELETE FROM job_facts WHERE project_id LIKE 'P-FIX-%'
    AND project_id NOT IN (SELECT project_id FROM job_memberships)
    AND project_id NOT IN (SELECT project_id FROM recommendations)
    AND project_id NOT IN (SELECT project_id FROM decision_events)
    AND project_id NOT IN (SELECT project_id FROM job_outcomes)
    AND project_id NOT IN (SELECT matched_project_id FROM job_messages WHERE matched_project_id IS NOT NULL)`);
  db.exec(`UPDATE job_facts SET active_state='CLOSED' WHERE project_id LIKE 'P-FIX-%'`);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM job_facts WHERE project_id='P-FIX-ORPHAN1'`).get().n, 0);
  const linked = db.prepare(`SELECT active_state FROM job_facts WHERE project_id='P-FIX-LINKED1'`).get();
  assert.equal(linked.active_state, 'CLOSED'); // 有引用 → 只关不删
});
