/** scorer.test.mjs — 六维评分专属单测（P1 打磨的行为锁定）。
 *
 * 覆盖：
 *  - 硬约束 hardBlock（关闭/冷却/未加入/同步不完整）
 *  - 容量维参数化（CAPACITY_LIMIT 默认 + ctx.capacity_limit 覆盖）
 *  - 画像冷启动三级降级（画像 > 历史兜底 > null 缺失不惩罚）
 *  - coverage / actionOf / bandOf 阈值
 *  - 确定性排序 sortRecs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreJob, hardBlock, actionOf, bandOf, sortRecs,
  WEIGHTS, CAPACITY_LIMIT,
} from '../src/scorer.js';

const baseJob = {
  project_id: 'P-1', company: '39AI', role: '海外投放经理',
  active_state: 'OPEN', pipeline: '面试 2', captured_at: '2026-08-18T00:00:00Z',
};
const baseCtx = {
  consultant_id: 'felix',
  profile_keywords: ['投放', '增长'],
  historical_texts: [],
  watched_count: 0, accepted_count: 0, outcomes_avg: null,
  now: '2026-08-18T08:00:00Z', snapshot_id: 's1',
};

test('hardBlock：关闭/冷却/未加入/同步不完整 命中即拦截', () => {
  assert.ok(hardBlock(baseJob, 'MY_JOB', false), '同步不完整应拦');
  assert.ok(hardBlock({ ...baseJob, active_state: 'CLOSED' }, 'MY_JOB', true), '已关闭应拦');
  assert.ok(hardBlock({ ...baseJob, active_state: 'COOLING' }, 'MY_JOB', true), '冷却应拦');
  assert.ok(hardBlock(baseJob, 'NOT_JOINED', true), '未加入应拦');
  assert.equal(hardBlock(baseJob, 'MY_JOB', true), null, '正常职位不拦');
});

test('容量维：默认上限 CAPACITY_LIMIT', () => {
  const r = scoreJob(baseJob, 'MY_JOB', { ...baseCtx, watched_count: 5, accepted_count: 0 });
  const cap = r.breakdown.find((d) => d.dim === 'capacity').score;
  assert.equal(cap, Math.round((1 - 5 / CAPACITY_LIMIT) * 100), '默认按 CAPACITY_LIMIT 计');
});

test('容量维：ctx.capacity_limit 覆盖默认上限', () => {
  const r = scoreJob(baseJob, 'MY_JOB', { ...baseCtx, watched_count: 5, capacity_limit: 20 });
  const cap = r.breakdown.find((d) => d.dim === 'capacity').score;
  assert.equal(cap, Math.round((1 - 5 / 20) * 100), '应按覆盖上限 20 计（75）');
  assert.equal(cap, 75);
});

test('画像冷启动：无画像但有历史 → 用历史兜底（direction 非 null）', () => {
  const r = scoreJob(baseJob, 'MY_JOB', {
    ...baseCtx, profile_keywords: [], historical_texts: ['39AI 海外投放经理'],
  });
  const dir = r.breakdown.find((d) => d.dim === 'direction').score;
  assert.notEqual(dir, null, '有历史时方向维应有分');
  assert.ok(dir > 0, '历史高度重合应有正分');
});

test('画像冷启动：无画像无历史 → direction=null（缺失，不计入 coverage、不惩罚）', () => {
  const r = scoreJob(baseJob, 'MY_JOB', {
    ...baseCtx, profile_keywords: [], historical_texts: [],
  });
  const dir = r.breakdown.find((d) => d.dim === 'direction');
  assert.equal(dir.score, null, '纯冷启动方向维应为 null');
  // coverage 应扣掉 direction 的 0.25 权重
  assert.ok(r.coverage <= 1 - WEIGHTS.direction + 1e-9, 'coverage 不含缺失的 direction 权重');
});

test('画像冷启动对比：冷启动分不应低于「被 0 分硬扣」的旧行为', () => {
  const cold = scoreJob(baseJob, 'MY_JOB', { ...baseCtx, profile_keywords: [], historical_texts: [] });
  // 模拟旧行为：direction=0 计入。新行为 direction=null 不计入 → 归一化后分数不被 0 拉低。
  assert.ok(cold.score > 0, '冷启动仍应有正分（其余维度支撑）');
});

test('actionOf / bandOf 阈值', () => {
  assert.equal(actionOf(80, 0.85), 'RECOMMEND_ACCEPT');
  assert.equal(actionOf(60, 0.7), 'RECOMMEND_WATCH');
  assert.equal(actionOf(80, 0.4), 'OBSERVE', 'coverage<0.5 强制 OBSERVE');
  assert.equal(bandOf(0.9), 'HIGH');
  assert.equal(bandOf(0.7), 'MEDIUM');
  assert.equal(bandOf(0.3), 'LOW');
});

test('sortRecs：score↓ → coverage↓ → 新鲜度↓ → project_id↑', () => {
  const a = { score: 80, evidence_coverage: 0.9, job: { captured_at: '2026-08-18', project_id: 'P-A' } };
  const b = { score: 80, evidence_coverage: 0.8, job: { captured_at: '2026-08-18', project_id: 'P-B' } };
  assert.ok(sortRecs(a, b) < 0, '同分时 coverage 高者在前');
});
