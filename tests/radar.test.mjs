/** radar.test.mjs — 职位雷达/客户洞察读取层：候选池可见性、关系标注、驾驶舱合并、事实不补造。 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { runSync } from '../src/sync.js';
import { radarRows, clientRows } from '../src/radar.js';

let db;
before(() => {
  db = openDb(':memory:');
  runSync(db, { source: 'fixture', consultant_id: 'felix' }); // 60 职位 + felix 策展关系
});

const poolCount = (consultantId) => {
  const total = db.prepare('SELECT COUNT(*) n FROM job_facts').get().n;
  // 显式 NOT_JOINED/UNKNOWN 活跃 membership（规则 1 优先级最高）不在该顾问候选池内
  const excluded = db.prepare(`SELECT COUNT(*) n FROM job_memberships
    WHERE valid_to IS NULL AND relation IN ('NOT_JOINED','UNKNOWN') AND consultant_id=?`).get(consultantId).n;
  return total - excluded;
};

test('雷达：属主看到整个候选池，自己的策展关系被正确标注', () => {
  const rows = radarRows(db, 'felix');
  assert.equal(rows.length, poolCount('felix'));
  assert.ok(rows.every((r) => r.project_id && r.company && r.role));
  assert.ok(rows.every((r) => typeof r.engagement_state === 'string'));
  assert.ok(rows.some((r) => r.relation === 'PRIMARY_PM' || r.relation === 'MY_JOB'));
  // 事实字段：HC 为 null 时原样为 null，绝不写成 0
  assert.ok(rows.every((r) => r.hc === null || r.hc >= 0));
});

test('雷达：无策展关系的顾问按团队池默认看到候选池（他人策展标注 OTHER_CONSULTANT）', () => {
  const rows = radarRows(db, 'mia');
  assert.equal(rows.length, poolCount('mia'));
  assert.ok(rows.every((r) => ['TEAM_SHARED', 'OTHER_CONSULTANT'].includes(r.relation)));
  assert.ok(rows.every((r) => r.relation !== 'MY_JOB' && r.relation !== 'PRIMARY_PM'));
});

test('雷达：驾驶舱事实按 project_id 合并（外键保证存在）', () => {
  const pid = db.prepare('SELECT project_id FROM job_facts LIMIT 1').get().project_id;
  db.prepare(`INSERT INTO cockpit_facts (project_id, membership_status, current_stage, cockpit_as_of, updated_at, raw_json)
    VALUES (?, 'PRIMARY_PM', 'ACTIVE_ADVANCEMENT', '2026-08-12T00:00:00Z', '2026-08-12T00:00:00Z', '{}')`).run(pid);
  const row = radarRows(db, 'felix').find((r) => r.project_id === pid);
  assert.ok(row.cockpit);
  assert.equal(row.cockpit.membership_status, 'PRIMARY_PM');
  assert.equal(row.cockpit.current_stage, 'ACTIVE_ADVANCEMENT');
  assert.equal(row.cockpit.stage_confidence, 0);
});

test('雷达：显式 NOT_JOINED 关系行被跳过（与 hardBlock 同一闸门）', () => {
  const pid = db.prepare('SELECT project_id FROM job_facts LIMIT 1').get().project_id;
  db.prepare(`INSERT INTO job_memberships (consultant_id, project_id, relation, source, valid_from, valid_to)
    VALUES ('felix', ?, 'NOT_JOINED', 'test', '2026-08-01T00:00:00Z', NULL)`).run(pid);
  const rows = radarRows(db, 'felix');
  assert.equal(rows.length, poolCount('felix'));
  assert.ok(!rows.some((r) => r.project_id === pid));
  db.prepare('DELETE FROM job_memberships WHERE consultant_id=? AND project_id=? AND relation=?').run('felix', pid, 'NOT_JOINED');
});

test('客户洞察：按公司聚合候选池职位，只呈现可数事实', () => {
  const rows = clientRows(db, 'felix');
  assert.ok(rows.length > 0);
  const total = rows.reduce((s, c) => s + c.job_count, 0);
  assert.equal(total, poolCount('felix'));
  for (const c of rows) {
    assert.ok(c.company);
    assert.ok(c.job_count >= 1);
    assert.ok(c.active_jobs <= c.job_count);
    assert.ok(Array.isArray(c.relations) && Array.isArray(c.states));
  }
  // 排序：活跃职位多者在前
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].active_jobs >= rows[i].active_jobs || rows[i - 1].job_count >= rows[i].job_count);
  }
});
