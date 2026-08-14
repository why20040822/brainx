/** framework.test.mjs — 2026-08-10 框架修正的回归测试（每项对应一处结构缺陷）。
 *
 * ① relations.js 关系推导层（mia/york 推荐池断链）
 * ② fixture 属主守卫（非属主同步不继承策展关系）
 * ③ ACCEPT 接单守卫（OTHER_CONSULTANT 只可机会发现）
 * ④ 状态机：VIEWED 可达 / VIEW 不降级 WATCHED / UNWATCH note 落 reason
 * ⑤ captured_at 只在事实变化时前进（新鲜度维度恢复意义）
 * ⑥ latestRun 不携 raw_json 出网
 * ⑦ 静态服务 isPathInside 兄弟目录前缀漏洞
 * ⑧ push_log run_id '' 哨兵唯一键
 * ⑨ migrations 按文件名记账（含旧库 user_version 兼容）
 * ⑩ 中文 bigram 分词（similarity 对中文职位不再恒 0）
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { runSync, loadFixture } from '../src/sync.js';
import { recommend, latestRun } from '../src/recommend.js';
import { engage, currentState } from '../src/engagement.js';
import { relationOf, relationMap, deriveRelation } from '../src/relations.js';
import { updateProfile, seedRoster, listConsultants } from '../src/roster.js';
import { pushCard } from '../src/push.js';
import { tokenize, scoreJob } from '../src/scorer.js';
import { isPathInside } from '../src/server.js';
import { deriveProjectId, flatLark, flatApi, mapPriority, parseBitableRecord } from '../src/bitable.js';

let db;
before(() => { db = openDb(':memory:'); });

const fixtureJob = (rel) => loadFixture().jobs.find((j) => j.relation === rel);

/* ① 关系推导：本人行 > 他人主做 → OTHER_CONSULTANT > 团队池默认 TEAM_SHARED */
test('关系推导：无本人行时按他人主做/团队池默认推导', () => {
  runSync(db, { source: 'fixture', consultant_id: 'felix' }); // 属主本人：关系落位
  const myJob = fixtureJob('MY_JOB');
  const teamJob = fixtureJob('TEAM_SHARED');
  assert.equal(relationOf(db, 'felix', myJob.project_id), 'MY_JOB');        // 本人行优先
  assert.equal(relationOf(db, 'mia', myJob.project_id), 'OTHER_CONSULTANT'); // Felix 主做 → 对他人
  assert.equal(relationOf(db, 'mia', teamJob.project_id), 'TEAM_SHARED');    // 团队池默认
  const ctx = relationMap(db, 'mia');
  assert.equal(deriveRelation(ctx, 'P-NO-SUCH-JOB'), 'TEAM_SHARED');         // 无记录亦默认团队池
});

/* ② fixture 属主守卫：mia 跑 fixture 同步不继承 Felix 的策展关系 */
test('fixture 属主守卫：非属主同步只刷事实、不写关系', () => {
  const before = db.prepare(`SELECT COUNT(*) n FROM job_memberships WHERE consultant_id='mia'`).get().n;
  const out = runSync(db, { source: 'fixture', consultant_id: 'mia' });
  assert.equal(out.complete, true);
  const afterRows = db.prepare(`SELECT COUNT(*) n FROM job_memberships WHERE consultant_id='mia'`).get().n;
  assert.equal(before, afterRows); // 一个关系行都不该多（修正前会继承 60 条 Felix 关系）
});

/* ①b 断链修复：mia 没有任何策展关系行，推荐池不再为空 */
test('无策展关系的顾问（mia）推荐池不再为空，且关系均为推导值', () => {
  const out = recommend(db, 'mia', { top: 10 });
  assert.equal(out.blocked, false);
  assert.ok(out.items.length > 0); // 修正前恒为 []
  for (const r of out.items) assert.ok(['TEAM_SHARED', 'OTHER_CONSULTANT'].includes(r.job.relation));
});

/* ③ ACCEPT 守卫：他人主做职位不可直接接单 */
test('ACCEPT 守卫：OTHER_CONSULTANT 职位 409，只可机会发现', () => {
  const myJob = fixtureJob('MY_JOB');
  let r = engage(db, 'york', myJob.project_id, 'VIEW', { idempotency_key: 'fw:york:view' });
  assert.equal(r.ok, true);
  r = engage(db, 'york', myJob.project_id, 'ACCEPT', { idempotency_key: 'fw:york:accept', confirm: true });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.match(r.error, /其他顾问主做/);
});

/* ④ 状态机：VIEWED 真正可达；查看 WATCHED 职位不降级；UNWATCH note 落 reason */
test('状态机：VIEW 后状态为 VIEWED（不再回落 RECOMMENDED）', () => {
  const pid = fixtureJob('TEAM_SHARED').project_id;
  const r = engage(db, 'mia', pid, 'VIEW', { idempotency_key: 'fw:mia:view1' });
  assert.equal(r.state, 'VIEWED');
  assert.equal(currentState(db, 'mia', pid).state, 'VIEWED'); // 修正前视图不含 VIEWED
});

test('状态机：查看 WATCHED 职位不降级；UNWATCH 落『关注回滚』reason', () => {
  const pid = db.prepare(`SELECT project_id FROM job_facts WHERE project_id != ? LIMIT 1`)
    .get(fixtureJob('TEAM_SHARED').project_id).project_id;
  let r = engage(db, 'mia', pid, 'WATCH', { idempotency_key: 'fw:mia:watch' });
  assert.equal(r.state, 'WATCHED');
  r = engage(db, 'mia', pid, 'VIEW', { idempotency_key: 'fw:mia:view2' });
  assert.equal(r.state, 'WATCHED'); // 修正前：查看把关注冲成 VIEWED
  assert.equal(currentState(db, 'mia', pid).state, 'WATCHED');
  const ev = db.prepare(`SELECT event_type, next_state FROM decision_events
    WHERE actor='mia' AND project_id=? AND idempotency_key='fw:mia:view2'`).get(pid);
  assert.deepEqual([ev.event_type, ev.next_state], ['VIEWED', 'WATCHED']); // 审计记 VIEW，状态留 WATCHED
  r = engage(db, 'mia', pid, 'UNWATCH', { idempotency_key: 'fw:mia:unwatch' });
  assert.equal(r.state, 'VIEWED');
  const rel = db.prepare(`SELECT event_type, reason FROM decision_events
    WHERE actor='mia' AND project_id=? AND idempotency_key='fw:mia:unwatch'`).get(pid);
  assert.deepEqual([rel.event_type, rel.reason], ['RELEASED', '关注回滚']); // 修正前 note 从不持久化
});

/* ⑤ captured_at：无变化不回刷，事实变化才前进 */
test('captured_at：重复同事实同步不前进，事实变化才前进', () => {
  const job = { project_id: 'P-FW-CAP', company: '甲方', role: '后端', city: '北京',
    pipeline: '初步接触', hc: null, active_state: 'OPEN', relation: null, source_url: null };
  runSync(db, { source: 'bridge', consultant_id: 'felix',
    payload: { as_of: '2026-08-01T00:00:00.000Z', jobs: [{ ...job, captured_at: '2026-08-01T00:00:00.000Z' }] } });
  const cap = () => db.prepare(`SELECT captured_at FROM job_facts WHERE project_id='P-FW-CAP'`).get().captured_at;
  assert.equal(cap(), '2026-08-01T00:00:00.000Z');
  // 同事实、新一轮（as_of/captured_at 更新）→ captured_at 必须保留原值（修正前被回刷）
  runSync(db, { source: 'bridge', consultant_id: 'felix',
    payload: { as_of: '2026-08-09T00:00:00.000Z', jobs: [{ ...job, captured_at: '2026-08-09T00:00:00.000Z' }] } });
  assert.equal(cap(), '2026-08-01T00:00:00.000Z');
  // pipeline 变了 → captured_at 前进
  runSync(db, { source: 'bridge', consultant_id: 'felix',
    payload: { as_of: '2026-08-09T00:00:00.000Z',
      jobs: [{ ...job, pipeline: '约面 2 人', captured_at: '2026-08-09T00:00:00.000Z' }] } });
  assert.equal(cap(), '2026-08-09T00:00:00.000Z');
});

/* ⑥ latestRun：raw_json 不出网 */
test('latestRun：推荐项不携带 raw_json（原始负载不出网）', () => {
  recommend(db, 'felix', { top: 10 });
  const run = latestRun(db, 'felix');
  assert.ok(run.items.length > 0);
  for (const r of run.items) assert.equal(r.job.raw_json, undefined);
});

/* ⑦ 静态服务：兄弟目录前缀漏洞 */
test('isPathInside：兄弟目录（public-x）不被误判为内部', () => {
  assert.equal(isPathInside('/x/public', '/x/public/index.html'), true);
  assert.equal(isPathInside('/x/public', '/x/public'), true);
  assert.equal(isPathInside('/x/public', '/x/public-x/evil.js'), false); // 修正前裸 startsWith 放行
  assert.equal(isPathInside('/x/public', '/x/src/server.js'), false);
});

/* ⑧ push_log：run_id 空值哨兵唯一键真生效 */
test('push_log：无 run_id 推送按空串哨兵去重，DB 唯一键兜底', () => {
  const card = { config: {} };
  const r1 = pushCard(db, { consultant_id: 'felix', kind: 'SYNC_ALERT', run_id: null, card, target: 'oc_x', send: false });
  assert.equal(r1.status, 'PREVIEW');
  const r2 = pushCard(db, { consultant_id: 'felix', kind: 'SYNC_ALERT', run_id: null, card, target: 'oc_x', send: false });
  assert.equal(r2.status, 'SKIPPED_DUPLICATE');
  // 绕过应用层直插同键 → SQLite UNIQUE 必须拦截（修正前 NULL 可无限重复插）
  assert.throws(() => db.prepare(`INSERT INTO push_log
    (push_id, consultant_id, kind, run_id, card_json, target, status, created_at)
    VALUES ('fw-dup', 'felix', 'SYNC_ALERT', '', '{}', 'oc_x', 'PREVIEW', '2026-08-10')`).run(),
    /UNIQUE constraint/);
  const n = db.prepare(`SELECT COUNT(*) n FROM push_log WHERE consultant_id='felix' AND kind='SYNC_ALERT'`).get().n;
  assert.equal(n, 1);
});

/* ⑨ migrations：按文件名记账 + 旧库 user_version 兼容 */
test('migrations：schema_migrations 逐文件记账，重开不重跑', () => {
  const rows = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r) => r.name);
  assert.deepEqual(rows, ['0001_init.sql', '0002_push_log.sql', '0003_consultants.sql',
                          '0004_bridge.sql', '0005_per_user.sql', '0006_framework.sql',
                          '0007_bitable_fields.sql', '0008_agent12.sql', '0009_switch_app.sql',
                          '0010_ttc_tokens.sql', '0011_ttc_owner.sql', '0012_drop_placeholder.sql']);
});

const TMPDB = join(tmpdir(), `brainx-fw-${process.pid}.db`);
after(() => { for (const s of ['', '-wal', '-shm']) rmSync(TMPDB + s, { force: true }); });

test('migrations：旧库 user_version=2 兼容——前 2 个文件标记已应用，只补跑新增', () => {
  // 忠实模拟修正前的旧库：0001/0002 真执行过、user_version=2、无 schema_migrations
  const legacy = new DatabaseSync(TMPDB);
  const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  for (const f of ['0001_init.sql', '0002_push_log.sql']) {
    legacy.exec(readFileSync(join(migDir, f), 'utf8'));
  }
  legacy.exec('PRAGMA user_version = 2');
  legacy.close();
  const reopened = openDb(TMPDB);
  const rows = reopened.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r) => r.name);
  assert.equal(rows.length, 12); // 全部记账
  const view = reopened.prepare(`SELECT sql FROM sqlite_master WHERE type='view' AND name='current_engagement'`).get();
  assert.match(view.sql, /VIEWED/); // 0006 新视图已应用（含 VIEWED 推导）
  // 0007 扩列已生效
  const cols = reopened.prepare(`PRAGMA table_info(job_facts)`).all().map((c) => c.name);
  for (const c of ['priority', 'notes', 'company_type']) assert.ok(cols.includes(c), `缺列 ${c}`);
  // 0006 的 push_log 回填在真实旧表上执行无报错（旧库确实有 push_log 行）
  reopened.exec(`INSERT INTO push_log (push_id, consultant_id, kind, run_id, card_json, target, status, created_at)
    VALUES ('fw-legacy', 'felix', 'SYNC_ALERT', '', '{}', 'oc_x', 'SENT', '2026-08-10')`);
  reopened.close();
});

/* ⑩ 中文 bigram 分词：similarity 对纯中文职位不再恒 0 */
test('中文分词：bigram 命中使中文职位相似度 > 0（修正前恒 0）', () => {
  const t = tokenize('增长负责人');
  for (const bg of ['增长', '长负', '负责', '责人']) assert.ok(t.has(bg));
  const scored = scoreJob(
    { project_id: 'P-FW-CN', company: '字节', role: '增长负责人', pipeline: '', active_state: 'OPEN', captured_at: '2026-08-09' },
    'TEAM_SHARED',
    { consultant_id: 'mia', profile_keywords: [], historical_texts: ['某厂 增长经理'],
      watched_count: 0, accepted_count: 0, outcomes_avg: null, now: '2026-08-10T00:00:00.000Z' });
  const sim = scored.breakdown.find((d) => d.dim === 'similarity');
  assert.ok(sim.score > 0); // 「增长」bigram 命中（旧分词逐字切开又被 length>1 过滤 → 恒 0）
});

/* ── ⑪ Bitable 字段解析层（2026-08-10 实测标准字段驱动）── */

test('Bitable 解析：职位多选展开为「公司×单职能」多行，project_id 与 fixture 同推导', () => {
  const rec = { '公司': ['Rockflow'], '职位': ['产品', '工程', '运营增长'], '地点': ['北京'],
    '还做吗': ['1重点高优'], '文本': 'B端优先', '公司类型': ['AI 2C'], '主做': null };
  const jobs = parseBitableRecord(rec, 'recX', flatLark);
  assert.equal(jobs.length, 3); // 修正前：1 行假职位名「产品、工程、运营增长」
  assert.deepEqual(jobs.map((j) => j.role), ['产品', '工程', '运营增长']);
  assert.equal(jobs[0].project_id, deriveProjectId('Rockflow', '产品')); // 单职能稳定 ID
  assert.equal(new Set(jobs.map((j) => j.project_id)).size, 3);
  for (const j of jobs) {
    assert.equal(j.priority, 'HIGH');
    assert.equal(j.notes, 'B端优先');        // 文本字段修正前 0/86 入库
    assert.equal(j.company_type, 'AI 2C');
    assert.equal(j.pipeline, null);          // 还做吗不再塞 pipeline
    assert.equal(j.active_state, 'OPEN');
    assert.equal(j.relation, null);
  }
});

test('Bitable 解析：TTC 内部行过滤；职位空缺 → 职位待定；还做吗全值映射', () => {
  assert.equal(parseBitableRecord({ '公司': ['TTC'], '职位': ['工程'] }, 'r1', flatLark).length, 0);
  const j = parseBitableRecord({ '公司': ['甲'], '职位': null, '还做吗': ['新'] }, 'r2', flatLark)[0];
  assert.equal(j.role, '职位待定');
  assert.equal(j.priority, 'NEW');
  assert.deepEqual(['1重点高优', '有，正常招/常年招', '无，待定', '新'].map(mapPriority),
    ['HIGH', 'NORMAL', 'STANDBY', 'NEW']);
  assert.equal(parseBitableRecord({ '公司': ['乙'], '还做吗': ['无，待定'] }, 'r3', flatLark)[0].active_state, 'COOLING');
});

test('Bitable 解析：API 通道富文本段无缝拼接、人员列取名', () => {
  const rec = { '公司': [{ type: 'text', text: '像素' }, { type: 'text', text: '律动' }],
    '职位': ['算法'], '文本': [{ type: 'text', text: 'P0：\n算法工程师' }, { type: 'text', text: '\nC 端产品' }],
    '主做': [{ name: 'Felix 黄鑫' }] };
  const j = parseBitableRecord(rec, 'recY', flatApi)[0];
  assert.equal(j.company, '像素律动'); // 富文本段不能用顿号拼
  assert.equal(j.notes, 'P0：\n算法工程师\nC 端产品');
  assert.deepEqual(j.owner_names, ['Felix 黄鑫']); // 主做 user 列（当前实测全空，解析备用）
});

test('评分：HIGH 优先级活跃度加成 > NORMAL（修正前优先级信号全丢）', () => {
  const ctx = { consultant_id: 'mia', profile_keywords: [], historical_texts: [],
    watched_count: 0, accepted_count: 0, outcomes_avg: null, now: '2026-08-10T00:00:00.000Z' };
  const mk = (priority) => ({ project_id: 'P-FW-P', company: '甲', role: '算法', pipeline: null,
    active_state: 'OPEN', captured_at: '2026-08-10', priority });
  const high = scoreJob(mk('HIGH'), 'TEAM_SHARED', ctx).breakdown.find((d) => d.dim === 'activity').score;
  const normal = scoreJob(mk('NORMAL'), 'TEAM_SHARED', ctx).breakdown.find((d) => d.dim === 'activity').score;
  assert.ok(high > normal, `HIGH(${high}) 应 > NORMAL(${normal})`);
});

/* ⑫ 0007 迁移：复合行退役 + fixture（多岗）保留 + 属主污染清理 */
const TMPDB2 = join(tmpdir(), `brainx-fw7-${process.pid}.db`);
after(() => { for (const s of ['', '-wal', '-shm']) rmSync(TMPDB2 + s, { force: true }); });

test('0007：桥接复合行退役、fixture（多岗）保留、非属主关系到期', () => {
  // 忠实模拟 0007 之前的库：0001-0006 已执行 + 污染数据已存在
  const legacy = new DatabaseSync(TMPDB2);
  const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  for (const f of ['0001_init.sql', '0002_push_log.sql', '0003_consultants.sql',
                   '0004_bridge.sql', '0005_per_user.sql', '0006_framework.sql']) {
    legacy.exec(readFileSync(join(migDir, f), 'utf8'));
  }
  legacy.exec('PRAGMA user_version = 6');
  legacy.exec(`INSERT INTO sync_runs (sync_id, consultant_id, source, as_of, input_hash, started_at)
    VALUES ('s-bridge', 'felix', 'bridge', 't', 'h', 't'), ('s-fixture', 'felix', 'fixture', 't', 'h', 't')`);
  const insJob = `INSERT INTO job_facts (project_id, company, role, active_state, captured_at, sync_id, raw_json, updated_at)
    VALUES (?,?,?,'OPEN','t',?,'{}','t')`;
  legacy.prepare(insJob).run('P-FIX-OLDCP', 'Rockflow', '产品、工程、运营增长', 's-bridge'); // 桥接旧复合行
  legacy.prepare(insJob).run('P-FIX-MULTI', '像素律动', '运营增长、工程、产品、算法（多岗）', 's-fixture'); // Felix 策展行
  legacy.prepare(`INSERT INTO job_memberships (consultant_id, project_id, relation, source, valid_from)
    VALUES ('mia', 'P-FIX-MULTI', 'MY_JOB', 'fixture', 't'), ('felix', 'P-FIX-MULTI', 'MY_JOB', 'fixture', 't')`).run();
  legacy.close();

  const db2 = openDb(TMPDB2); // 0007-0012 在此依次应用（累积终态断言）
  assert.equal(db2.prepare(`SELECT COUNT(*) n FROM job_facts WHERE project_id='P-FIX-OLDCP'`).get().n,
    0); // 0007 CLOSED → 0012 零引用删除（P-FIX-% 前缀谓词，生产占位行全在此前缀下）
  assert.equal(db2.prepare(`SELECT active_state FROM job_facts WHERE project_id='P-FIX-MULTI'`).get().active_state,
    'CLOSED'); // 0007 保留为 OPEN；0012 因有引用（memberships）只关不删——冻结回放不破
  assert.ok(db2.prepare(`SELECT valid_to FROM job_memberships WHERE consultant_id='mia'`).get().valid_to); // 污染到期
  assert.equal(db2.prepare(`SELECT valid_to FROM job_memberships WHERE consultant_id='felix'`).get().valid_to,
    null); // 属主本人不动
  db2.close();
});

/* ⑬ 档案系统：自维护 + 种子不冲自维护档案 + direction 链路生效 */
test('档案：updateProfile 校验与持久化；非法输入 422/404', () => {
  let r = updateProfile(db, 'mia', { profile_keywords: ['AI应用', '企业服务', ' 产品 '] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.profile_keywords, ['AI应用', '企业服务', '产品']); // trim + 去重
  r = updateProfile(db, 'mia', { profile_keywords: Array(21).fill('x') });
  assert.equal(r.status, 422); // 超 20 个
  r = updateProfile(db, 'mia', { profile_keywords: ['a'.repeat(21)] });
  assert.equal(r.status, 422); // 单词超 20 字
  r = updateProfile(db, 'no_such_person', { profile_keywords: ['a'] });
  assert.equal(r.status, 404);
  r = updateProfile(db, 'mia', { profile_note: '主管视角' }); // 只改 note，keywords 保留
  assert.deepEqual(r.profile_keywords, ['AI应用', '企业服务', '产品']);
  assert.equal(r.profile_note, '主管视角');
});

test('档案：种子只填空档案，不冲顾问自维护内容', () => {
  // mia 已自维护关键词 → 重播种后仍在（修正前每次 openDb 无条件覆盖回空）
  seedRoster(db);
  const mia = listConsultants(db).find((c) => c.consultant_id === 'mia');
  assert.deepEqual(mia.profile_keywords, ['AI应用', '企业服务', '产品']);
});

test('档案：方向关键词让 direction 维度真正出分（空档案恒 0）', () => {
  const ctx0 = { consultant_id: 'mia', profile_keywords: [], historical_texts: [],
    watched_count: 0, accepted_count: 0, outcomes_avg: null, now: '2026-08-10T00:00:00.000Z' };
  const ctx1 = { ...ctx0, profile_keywords: ['AI应用'] };
  const job = { project_id: 'P-FW-PROF', company: '某厂', role: 'AI应用工程师', pipeline: '', active_state: 'OPEN', captured_at: '2026-08-10' };
  const d0 = scoreJob(job, 'TEAM_SHARED', ctx0).breakdown.find((d) => d.dim === 'direction').score;
  const d1 = scoreJob(job, 'TEAM_SHARED', ctx1).breakdown.find((d) => d.dim === 'direction').score;
  assert.equal(d0, 0);
  assert.ok(d1 > 0);
});
