/** autopush.test.mjs — 重大变化检测 + 自动推卡安全门（绝不打真实 lark-cli）。 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, now } from '../src/db.js';
import { detectMaterialChange, makeAutoPush } from '../src/autopush.js';

let db;
before(() => {
  db = openDb(':memory:');
  // job_facts.sync_id → sync_runs 外键：造一条占位 sync
  db.prepare(`INSERT INTO sync_runs (sync_id, consultant_id, source, as_of, rows_expected, rows_read, complete, errors, input_hash, started_at, completed_at)
    VALUES ('s','felix','test','2026-08-07',0,0,1,'[]','h','2026-08-07 09:00','2026-08-07 09:00')`).run();
});
after(() => { delete process.env.BRAINX_PUSH_AUTO; });

/** 直接插两轮 run + recs（绕过 recommend 全链，专注 diff 逻辑）。 */
function twoRuns(db, cid, prevTop3, curTop3) {
  const insJob = db.prepare(`INSERT OR IGNORE INTO job_facts
    (project_id, company, role, city, pipeline, hc, active_state, source_url, captured_at, sync_id, raw_json, updated_at)
    VALUES (?,?,'测试职位','北京',NULL,NULL,'OPEN',NULL,'2026-08-07','s','{}','2026-08-07')`);
  for (const [pid] of [...prevTop3, ...curTop3]) insJob.run(pid, `公司-${pid}`);
  const insRun = db.prepare(`INSERT INTO decision_runs
    (run_id, consultant_id, snapshot_id, policy_version, candidate_count, status, created_at)
    VALUES (?,?,?,?,?, 'COMPLETED', ?)`);
  const insRec = db.prepare(`INSERT INTO recommendations
    (decision_id, run_id, project_id, consultant_id, action, score, confidence_band,
     evidence_coverage, reasons_json, risks_json, evidence_refs_json, breakdown_json,
     policy_version, rank, created_at)
    VALUES (?,?,?,?,?,80,'HIGH',0.8,'["r1","r2"]','["k1"]','[]','[]','baseline-1.0',?,?)`);
  insRun.run(`${cid}-r1`, cid, 'snap', 'baseline-1.0', 3, '2026-08-07 10:00');
  insRun.run(`${cid}-r2`, cid, 'snap', 'baseline-1.0', 3, '2026-08-07 11:00');
  prevTop3.forEach((p, i) => insRec.run(`${cid}-r1-${p[0]}`, `${cid}-r1`, p[0], cid, p[1], i + 1, '2026-08-07 10:00'));
  curTop3.forEach((p, i) => insRec.run(`${cid}-r2-${p[0]}`, `${cid}-r2`, p[0], cid, p[1], i + 1, '2026-08-07 11:00'));
}

// fixture roster 已含 felix（带 open_id）；造无 open_id 的顾问
function addJobless(db, cid) {
  db.prepare(`INSERT INTO consultants (consultant_id, display_name, open_id, profile_json, source, active, created_at)
    VALUES (?,?,NULL,'{}','test',1,?)`).run(cid, cid, now());
}

test('Top1 易主 → TOP1_CHANGED', () => {
  twoRuns(db, 'felix', [['P-A', 'RECOMMEND_ACCEPT'], ['P-B', 'RECOMMEND_WATCH']],
                       [['P-B', 'RECOMMEND_ACCEPT'], ['P-A', 'RECOMMEND_WATCH']]);
  const c = detectMaterialChange(db, 'felix');
  assert.equal(c.kind, 'TOP1_CHANGED');
  assert.equal(c.project_id, 'P-B');
});

test('Top1 不变但 ACCEPT 档新进 Top3 → ACCEPT_ENTERED_TOP3', () => {
  twoRuns(db, 'mia', [['P-A', 'RECOMMEND_WATCH'], ['P-B', 'OBSERVE'], ['P-C', 'OBSERVE']],
                     [['P-A', 'RECOMMEND_WATCH'], ['P-C', 'RECOMMEND_ACCEPT'], ['P-B', 'OBSERVE']]);
  const c = detectMaterialChange(db, 'mia');
  assert.equal(c.kind, 'ACCEPT_ENTERED_TOP3');
  assert.equal(c.project_id, 'P-C');
});

test('两轮完全一致 → null；只有一轮 → null', () => {
  twoRuns(db, 'york', [['P-A', 'RECOMMEND_ACCEPT'], ['P-B', 'RECOMMEND_WATCH']],
                      [['P-A', 'RECOMMEND_ACCEPT'], ['P-B', 'RECOMMEND_WATCH']]);
  assert.equal(detectMaterialChange(db, 'york'), null);
  db.prepare(`INSERT INTO decision_runs (run_id, consultant_id, snapshot_id, policy_version, candidate_count, status, created_at)
    VALUES ('solo-r1','solo','snap','baseline-1.0',1,'COMPLETED','2026-08-07 10:00')`).run();
  assert.equal(detectMaterialChange(db, 'solo'), null);
});

test('自动推卡：默认关闭 → disabled；开启后推本人 open_id（stub 断言不打真 CLI）', () => {
  addJobless(db, 'noop');
  twoRuns(db, 'noop', [['P-X', 'OBSERVE']], [['P-Y', 'RECOMMEND_ACCEPT']]);

  // 关闭门
  delete process.env.BRAINX_PUSH_AUTO;
  let calls = [];
  let r = makeAutoPush(db, { pushImpl: (...a) => calls.push(a) })('noop');
  assert.equal(r.reason, 'disabled');
  assert.equal(calls.length, 0);

  // 开启但无 open_id → 不推
  process.env.BRAINX_PUSH_AUTO = '1';
  r = makeAutoPush(db, { pushImpl: (...a) => calls.push(a) })('noop');
  assert.equal(r.reason, 'no_open_id');
  assert.equal(calls.length, 0);

  // 开启 + 有 open_id（felix 第一轮已 TOP1_CHANGED → P-B）→ 推到本人 open_id
  db.prepare(`INSERT OR IGNORE INTO job_facts (project_id, company, role, city, pipeline, hc, active_state, source_url, captured_at, sync_id, raw_json, updated_at)
    VALUES ('P-B','易主公司','产品总监','北京',NULL,NULL,'OPEN',NULL,'2026-08-07','s','{}','2026-08-07')`).run();
  r = makeAutoPush(db, { pushImpl: (d, opts) => { calls.push(opts); return { status: 'SENT' }; } })('felix');
  assert.equal(r.pushed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'HEATING_ALERT');
  assert.equal(calls[0].target, db.prepare(`SELECT open_id FROM consultants WHERE consultant_id='felix'`).get().open_id);
  assert.equal(calls[0].card.header.template, 'red');
  assert.ok(calls[0].card.elements[0].content.includes('Top1 易主'));
});

test('无重大变化时不推（no_material_change）', () => {
  process.env.BRAINX_PUSH_AUTO = '1';
  let calls = 0;
  const r = makeAutoPush(db, { pushImpl: () => { calls++; return { status: 'SENT' }; } })('york');
  assert.equal(r.reason, 'no_material_change');
  assert.equal(calls, 0);
});
