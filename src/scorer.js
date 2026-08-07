/** scorer.js — 六维评分 + 硬约束 + 确定性排序（PRD §6，补全文档 §17.1）。
 *
 * 纪律：
 * - 无随机数：探索位用 md5(project_id+日期+consultant) 确定性排序选取；
 * - 缺失维记 null，coverage = 可用维权重和，<0.5 强制 OBSERVE；
 * - 排序链固定：score↓ → coverage↓ → 新鲜度↓ → project_id↑。
 */
import { createHash } from 'node:crypto';

export const WEIGHTS = {
  direction: 0.25,   // 职位方向匹配
  activity: 0.20,    // 项目活跃度与 Pipeline
  similarity: 0.15,  // 与历史项目相似度
  capacity: 0.15,    // 当前承接容量
  outcomes: 0.15,    // 历史行为与交付结果
  exploration: 0.10, // 探索额度
};

export const POLICY_VERSION = 'baseline-1.0';

/** 硬约束（PRD §6）：命中即不得生成正式推荐。返回原因或 null。 */
export function hardBlock(job, relation, syncComplete) {
  if (!syncComplete) return '本轮同步不完整';
  if (!job.project_id) return '缺少 project_id';
  if (!job.company || !job.role) return '缺少客户或职位名称';
  if (['CLOSED', 'COMPLETED'].includes(job.active_state)) return '职位已关闭/完成';
  if (job.active_state === 'COOLING') return '职位处于冷却期';
  if (!relation || relation === 'UNKNOWN') return '关系 UNKNOWN';
  if (relation === 'NOT_JOINED') return '未加入该项目';
  return null;
}

const kwOverlap = (text, kws) => {
  if (!text || !kws.length) return 0;
  const hit = kws.filter((k) => text.toLowerCase().includes(k.toLowerCase())).length;
  return Math.min(100, Math.round((hit / Math.max(2, Math.ceil(kws.length / 2))) * 100));
};

function daysSince(iso, nowIso) {
  if (!iso) return 9999;
  return (Date.parse(nowIso) - Date.parse(iso)) / 86400000;
}

/** 探索位：确定性 md5 排序，当日该顾问的后 10% 职位得探索分 100，其余 50。 */
export function explorationScore(project_id, consultant_id, dayIso) {
  const h = createHash('md5').update(`${project_id}|${dayIso.slice(0, 10)}|${consultant_id}`).digest('hex');
  return parseInt(h.slice(0, 8), 16) % 10 === 0 ? 100 : 50;
}

/**
 * 给单个职位打分。ctx 需要：
 *  profile_keywords, historical_texts[](历史 MY_JOB 的公司+职位文本),
 *  watched_count, accepted_count, outcomes_avg(1-5|null), now
 */
export function scoreJob(job, relation, ctx) {
  const text = `${job.company} ${job.role} ${job.pipeline || ''}`;
  const dims = {};

  // 方向匹配 25%：画像关键词 + 历史项目关键词
  dims.direction = kwOverlap(text, ctx.profile_keywords);

  // 活跃度 20%：状态 + pipeline 有内容 + 新鲜度
  let act = null;
  if (job.active_state === 'OPEN') {
    act = 50;
    if (job.pipeline) act += 25;
    const d = daysSince(job.captured_at, ctx.now);
    act += d <= 1 ? 25 : d <= 7 ? 18 : d <= 30 ? 8 : 0;
  }
  dims.activity = act;

  // 历史相似 15%：与历史 MY_JOB 文本重合（含 CLOSED 历史，补全文档 §17.2-2）
  dims.similarity = ctx.historical_texts.length
    ? Math.max(...ctx.historical_texts.map((h) => {
        const a = new Set(text.toLowerCase().split(/\s+|(?=[一-鿿])/));
        const b = new Set(h.toLowerCase().split(/\s+|(?=[一-鿿])/));
        let inter = 0;
        for (const t of b) if (t.length > 1 && a.has(t)) inter++;
        return Math.min(100, inter * 12);
      }))
    : null;

  // 承接容量 15%：关注+接单占 10 上限比例反向
  const used = (ctx.watched_count || 0) + (ctx.accepted_count || 0);
  dims.capacity = Math.max(0, Math.round((1 - used / 10) * 100));

  // 历史结果 15%：有结果评分则 ×20，无则缺失
  dims.outcomes = ctx.outcomes_avg != null ? Math.round(ctx.outcomes_avg * 20) : null;

  // 探索 10%：确定性
  dims.exploration = explorationScore(job.project_id, ctx.consultant_id, ctx.now);

  const available = Object.entries(WEIGHTS).filter(([k]) => dims[k] != null);
  const coverage = available.reduce((s, [, w]) => s + w, 0);
  const score = available.reduce((s, [k, w]) => s + dims[k] * w, 0) / (coverage || 1);

  return {
    score: Math.round(score * 10) / 10,
    coverage: Math.round(coverage * 100) / 100,
    breakdown: Object.entries(WEIGHTS).map(([k, w]) => ({ dim: k, weight: w, score: dims[k] })),
  };
}

export function actionOf(score, coverage) {
  if (coverage < 0.5) return 'OBSERVE'; // 硬规则：证据不足只观察
  if (score >= 75) return 'RECOMMEND_ACCEPT';
  if (score >= 55) return 'RECOMMEND_WATCH';
  return 'OBSERVE';
}

export function bandOf(coverage) {
  return coverage >= 0.85 ? 'HIGH' : coverage >= 0.6 ? 'MEDIUM' : 'LOW';
}

/** 确定性排序（PRD §6）：score↓ → coverage↓ → 新鲜度↓ → project_id↑。 */
export function sortRecs(a, b) {
  return b.score - a.score
      || b.evidence_coverage - a.evidence_coverage
      || String(b.job.captured_at).localeCompare(String(a.job.captured_at))
      || String(a.job.project_id).localeCompare(String(b.job.project_id));
}

/** 事实理由与风险（≥2 条理由，禁止裸分数）。 */
export function explain(job, relation, scored, ctx) {
  const b = Object.fromEntries(scored.breakdown.map((d) => [d.dim, d.score]));
  const reasons = [];
  const relLabel = { MY_JOB: '我的职位', PRIMARY_PM: '我是主 PM', TEAM_SHARED: '团队共享', OTHER_CONSULTANT: '其他顾问主做' }[relation] || relation;
  reasons.push(`关系：${relLabel}${job.pipeline ? `；${job.pipeline}` : ''}`);
  if (b.direction != null) reasons.push(`方向匹配 ${b.direction} 分：与你画像关键词（${ctx.profile_keywords.slice(0, 3).join('/')}等）的重合度`);
  if (b.activity != null) reasons.push(`活跃度 ${b.activity} 分：状态 ${job.active_state}${job.pipeline ? '，Pipeline 有进展记录' : ''}，最近同步 ${String(job.captured_at).slice(0, 10)}`);
  if (b.similarity != null && b.similarity > 0) reasons.push(`历史相似 ${b.similarity} 分：与你历史主做项目存在重合特征`);
  const risks = [];
  if ((ctx.watched_count || 0) >= 7) risks.push(`关注榜已 ${ctx.watched_count}/10，接近上限`);
  if (job.hc != null && job.hc <= 1) risks.push('HC 仅剩 1，窗口小');
  if (job.hc == null) risks.push('HC 未知（飞书源无此字段，待 ATS 补齐）');
  if (b.outcomes == null) risks.push('历史结果维度缺失：冷启动期，证据覆盖率被拉低');
  if (relation === 'TEAM_SHARED') risks.push('团队共享职位：需先确认无人已接单');
  if (relation === 'OTHER_CONSULTANT') risks.push('其他顾问主做：只能作机会发现，默认不可接单');
  const evidence_refs = [];
  if (job.source_url) evidence_refs.push({ type: 'source', ref: job.source_url, excerpt: `${job.company}/${job.role}` });
  evidence_refs.push({ type: 'sync', ref: ctx.snapshot_id || '', excerpt: `快照 ${ctx.snapshot_id || 'N/A'} · ${String(job.captured_at).slice(0, 10)}` });
  return { reasons: reasons.slice(0, 4), risks: risks.slice(0, 3), evidence_refs };
}
