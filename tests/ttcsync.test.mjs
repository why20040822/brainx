/** ttcsync.test.mjs — TTC→job_facts 全链：字段映射 / owner 关系推导 / 桥接 TTC 段 / ID 重映射。 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { runSync } from '../src/sync.js';
import { relationOf } from '../src/relations.js';
import { toJobRow } from '../src/ttcsdk/job.js';
import { saveTtcToken, validateJwt } from '../src/ttcsdk/auth.js';
import { bridgeOnce } from '../src/bridge.js';
import { normalizeCompany, planRemap, applyRemap } from '../scripts/remap_project_ids.mjs';

let db;
before(() => { db = openDb(':memory:'); });

const TTC_JOB = {
  unique_id: 'JRW5YJJ', name: 'AI产业链投资岗TMT组', cities: ['上海市', '北京市'],
  head_count: 2, analytics: '清华本科…', company_name: '天壹紫腾资产管理（宁波）有限公司',
  company_unique_id: 'C12269', status: 1, status_tags: ['新职位', '活跃'],
  managers: [{ unique_id: 'U1856', name: 'Jade 郭子安' }],
  participants: [{ name: 'Coral 龙芊潼' }], pipeline_info: { pipeline_step_count: { Sourcing: 1 }, total_pipeline_count: 1 },
  update_time: 1786681652417, cooperation: '求合作', has_permission: true,
};

test('toJobRow：真 ID/HC/Pipeline/owner/时间映射齐全', () => {
  const r = toJobRow(TTC_JOB);
  assert.equal(r.project_id, 'JRW5YJJ');
  assert.equal(r.hc, 2);
  assert.equal(r.pipeline, 'Sourcing×1');
  assert.equal(r.owner_name, 'Jade 郭子安');
  assert.equal(r.active_state, 'OPEN');
  assert.equal(r.relation, null); // 桥接纪律
  assert.equal(r.city, '上海市、北京市');
  assert.equal(r.captured_at, new Date(1786681652417).toISOString());
  assert.equal(r.source_url, 'ttc://job/JRW5YJJ');
});

test('toJobRow：need_blur 用面向候选人名；status 非 1 不为 OPEN', () => {
  const blurred = toJobRow({ ...TTC_JOB, need_blur: 1, company_name_for_c: '某资管公司' });
  assert.equal(blurred.company, '某资管公司');
  assert.equal(toJobRow({ ...TTC_JOB, status: 0 }).active_state, 'COOLING');
  assert.equal(toJobRow({ ...TTC_JOB, status: 7 }).active_state, 'UNKNOWN');
});

test('runSync source=ttc：owner 列落库 + captured_at 用 TTC update_time', () => {
  const out = runSync(db, { source: 'ttc', consultant_id: 'mia', payload: { as_of: '2026-08-14', jobs: [toJobRow(TTC_JOB)] } });
  assert.equal(out.complete, true);
  const row = db.prepare(`SELECT owner_name, hc, pipeline, captured_at FROM job_facts WHERE project_id='JRW5YJJ'`).get();
  assert.equal(row.owner_name, 'Jade 郭子安');
  assert.equal(row.hc, 2);
  assert.equal(row.pipeline, 'Sourcing×1');
  assert.equal(row.captured_at, new Date(1786681652417).toISOString()); // 不被同步时间回刷
});

test('relations：TTC owner 推导层（本人→MY_JOB / 花名册他人→OTHER_CONSULTANT / 花名册外→团队池）', () => {
  // mia 的显示名是 "Mia 钟笑咪"；Jade 不在花名册
  assert.equal(relationOf(db, 'mia', 'JRW5YJJ'), 'TEAM_SHARED'); // owner 不在花名册 → 团队池
  db.prepare(`UPDATE job_facts SET owner_name='Mia 钟笑咪' WHERE project_id='JRW5YJJ'`).run();
  assert.equal(relationOf(db, 'mia', 'JRW5YJJ'), 'MY_JOB');       // owner=本人显示名
  assert.equal(relationOf(db, 'felix', 'JRW5YJJ'), 'OTHER_CONSULTANT'); // owner 在花名册（≠felix）
  db.prepare(`UPDATE job_facts SET owner_name='Jade 郭子安' WHERE project_id='JRW5YJJ'`).run();
});

test('bridgeOnce：TTC 段按人拉取合并入池；无凭据者跳过；失效标记', async () => {
  const jwt = (() => { const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'HS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 86400, CustomData: { nick_name: 'X' } })}.sig`; })();
  saveTtcToken(db, 'mia', jwt, validateJwt(jwt)); // 只有 mia 托管了 TTC 凭据
  let searchCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('job/search')) {
      searchCalls++;
      return new Response(JSON.stringify({ code: 0, data: { jobs: [TTC_JOB, { ...TTC_JOB, unique_id: 'JX2' }], has_more: false } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('unexpected ' + url);
  };
  const larkStub = () => ({ data: { fields: [], data: [], record_id_list: [] } }); // Bitable 空 payload
  const out = await bridgeOnce(db, { consultant_ids: ['mia', 'york'], execImpl: larkStub, api: { fetchImpl } });
  assert.equal(searchCalls, 1); // york 无 TTC 凭据 → 不发起
  const ttcSyncs = out.syncs.filter((s) => s.rows === 2);
  assert.equal(ttcSyncs.length, 2); // 两人各一条 source=ttc 快照（同一并集）
  assert.ok(db.prepare(`SELECT COUNT(*) n FROM job_facts WHERE project_id IN ('JRW5YJJ','JX2')`).get().n === 2);
});

test('remap：规范化/确定映射/歧义/事务执行', () => {
  assert.equal(normalizeCompany('天壹紫腾资产管理（宁波）有限公司'), '天壹紫腾资产管理');
  // 造数据：旧占位行 + 真 ID 行
  runSync(db, { source: 'bridge', consultant_id: 'felix', payload: { as_of: '2026-08-01', jobs: [
    { project_id: 'P-FIX-AAAA1111', company: '天壹紫腾', role: 'TMT投资', city: null, pipeline: null,
      hc: null, active_state: 'OPEN', relation: null, source_url: null },
  ] } });
  const plan = planRemap(
    [{ project_id: 'P-FIX-AAAA1111', company: '天壹紫腾', role: 'TMT投资' },
     { project_id: 'P-FIX-NOPE999', company: '不存在的公司', role: 'x' }],
    [{ project_id: 'JRW5YJJ', company: '天壹紫腾资产管理（宁波）有限公司', role: 'AI产业链投资岗TMT组' }]);
  assert.equal(plan.confident.length, 1);
  assert.equal(plan.confident[0].to, 'JRW5YJJ');
  assert.equal(plan.unmatched.length, 1);
  // 歧义：同公司两真行
  const amb = planRemap([{ project_id: 'P-FIX-AAAA1111', company: '天壹紫腾', role: '无关角色' }],
    [{ project_id: 'J1', company: '天壹紫腾资产管理', role: '甲' }, { project_id: 'J2', company: '天壹紫腾', role: '乙' }]);
  assert.equal(amb.ambiguous.length, 1);
  // 执行：引用搬移 + 旧行删除（先造一条推荐引用）
  db.prepare(`INSERT INTO decision_runs (run_id, consultant_id, snapshot_id, policy_version, candidate_count, created_at)
    VALUES ('r1','felix','s1','p',1,'t')`).run();
  db.prepare(`INSERT INTO recommendations (decision_id, run_id, consultant_id, project_id, action, score, confidence_band, evidence_coverage, reasons_json, risks_json, evidence_refs_json, breakdown_json, policy_version, rank, created_at)
    VALUES ('d1','r1','felix','P-FIX-AAAA1111','OBSERVE',50,'LOW',0.5,'[]','[]','[]','[]','p',1,'t')`).run();
  applyRemap(db, plan.confident);
  assert.equal(db.prepare(`SELECT project_id FROM recommendations WHERE decision_id='d1'`).get().project_id, 'JRW5YJJ');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM job_facts WHERE project_id='P-FIX-AAAA1111'`).get().n, 0);
});
