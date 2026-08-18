/** talent-supply.js — 人才供给适配层（README「未来人才侧接口」的落地实现）。
 *
 * README 约定（原文）：
 *   > 当前评分不依赖人才数据。未来应在独立适配层 adapters/talent-supply.ts 接入……
 *   > 在开关启用前不得进入客户或职位基础评分。
 *
 * 因此本模块是【只读、旁路】的：它把人才库（talent.js）的候选供给情况，按职位换算成
 * TalentSupplySnapshot，供职位详情/雷达做「供给参考」展示。它绝不被 scorer.js /
 * recommend.js 引用，也绝不回写决策库——保证「不进入基础评分」的纪律由「无引用」硬保证。
 *
 * 开关：BRAINX_TALENT_SUPPLY=1 时启用；默认关闭，关闭时 snapshot() 返回 { enabled:false }。
 */
import { tokenize } from './scorer.js';
import { listMatchesForPosition, upsertPosition, writeMatchRecord, listTalentsWithTags } from './talent.js';

export function talentSupplyEnabled() {
  return process.env.BRAINX_TALENT_SUPPLY === '1';
}

// ---------------------------------------------------------------------------
// 匹配算法 v1（可解释、确定性；只用现有数据：职位 role/notes/company × 人才 tag/summary）
// ---------------------------------------------------------------------------
/**
 * 三维加权匹配：技能 0.5 + 意向 0.3 + 摘要 0.2，命中率 ∈ [0,1]。
 *   - skill  维：职位「role+notes+requirements」分词 ∩ 人才 skill 标签，除以人才 skill 标签数（覆盖率）
 *   - intent 维：职位「role」分词 ∩ 人才 intention 标签
 *   - text   维：职位全文分词 ∩ 人才 summary 分词（标签缺失时的兜底信号）
 * 命中词全部记进 detail，可在卡片/回放里解释「为什么匹配」。
 */
export const SUPPLY_WEIGHTS = { skill: 0.5, intent: 0.3, text: 0.2 };
export const SUPPLY_MATCH_THRESHOLD = 0.15; // 低于此分不计入「可匹配候选」

function overlapRate(candTerms, jobTerms) {
  if (!candTerms.length || !jobTerms.size) return { rate: 0, hits: [] };
  const hits = candTerms.filter((t) => jobTerms.has(t));
  return { rate: hits.length / candTerms.length, hits };
}

/** 给单个候选人对某职位打分。job/cand 均为已分词的上下文，返回 { score, detail }。 */
export function scoreTalentForJob(cand, ctx) {
  const skillTags = (cand.tags || []).filter((t) => t.category === 'skill').map((t) => t.name.toLowerCase());
  const intentTags = (cand.tags || []).filter((t) => t.category === 'intention').map((t) => t.name.toLowerCase());
  const summaryTerms = [...tokenize(cand.summary || cand.name || '')];

  const skill = overlapRate(skillTags, ctx.reqTerms);   // 技能对需求
  const intent = overlapRate(intentTags, ctx.roleTerms); // 意向对职位
  const text = overlapRate(summaryTerms, ctx.allTerms);  // 摘要兜底

  const score = Math.min(1,
    SUPPLY_WEIGHTS.skill * skill.rate +
    SUPPLY_WEIGHTS.intent * intent.rate +
    SUPPLY_WEIGHTS.text * text.rate);

  return {
    score: Number(score.toFixed(4)),
    detail: {
      algo: 'supply-match-v1',
      dimensions: {
        skill: { weight: SUPPLY_WEIGHTS.skill, rate: Number(skill.rate.toFixed(3)), matched: skill.hits },
        intent: { weight: SUPPLY_WEIGHTS.intent, rate: Number(intent.rate.toFixed(3)), matched: intent.hits },
        text: { weight: SUPPLY_WEIGHTS.text, rate: Number(text.rate.toFixed(3)), matchedCount: text.hits.length },
      },
    },
  };
}

/** 由职位事实构造匹配上下文（各维度用不同职位文本，贴合语义）。 */
export function buildJobMatchContext(job) {
  const req = `${job.role || ''} ${job.notes || job.requirements || ''} ${job.pipeline || ''}`;
  const all = `${job.company || ''} ${job.role || ''} ${job.notes || ''} ${job.pipeline || ''}`;
  return {
    roleTerms: tokenize(job.role || ''),
    reqTerms: tokenize(req),
    allTerms: tokenize(all),
  };
}

/** 供给难度分档：可匹配候选越多越低。 */
function difficultyOf(count) {
  if (count >= 8) return 'low';
  if (count >= 3) return 'medium';
  return 'high';
}

function suggestionOf(count, difficulty) {
  if (count === 0) return '暂无可匹配候选，建议先扩搜或激活沉睡人才';
  if (difficulty === 'high') return `仅 ${count} 名可匹配候选，供给偏紧，优先精准触达`;
  if (difficulty === 'medium') return `${count} 名候选可推进，建议按匹配分分层触达`;
  return `${count} 名候选可选，供给充足，可快速起量`;
}

/**
 * 为一个职位产出 TalentSupplySnapshot（README 接口形状）。
 * job: { project_id, company, role, notes, pipeline } —— 决策库职位事实（只读传入，不回写）。
 * 用匹配算法 v1 对真库候选池打分，把结果写进人才库 match_record（人才侧写入，不触碰决策库）。
 */
export async function talentSupplyForJob(job) {
  if (!talentSupplyEnabled()) {
    return { jobId: job.project_id, enabled: false };
  }
  // 岗位入库（幂等），拿到 position_id 才能写匹配记录
  const pos = await upsertPosition({ title: job.role || job.company, description: job.company, requirements: job.notes || '' });
  const ctx = buildJobMatchContext(job);

  // 真库候选池（含 skill/intention 标签），用 v1 算法打分
  const talents = await listTalentsWithTags({ limit: 200 });
  const scored = [];
  for (const t of talents) {
    const { score, detail } = scoreTalentForJob(t, ctx);
    if (score <= 0) continue;
    scored.push({ talentId: t.id, name: t.name, score, detail, reactivatable: t.status === 'contacted' });
    await writeMatchRecord({ talentId: t.id, positionId: pos.id, score, detail }); // 幂等覆盖
  }
  scored.sort((a, b) => b.score - a.score);

  const matchable = scored.filter((s) => s.score >= SUPPLY_MATCH_THRESHOLD);
  const count = matchable.length;
  const difficulty = difficultyOf(count);
  return {
    jobId: job.project_id,
    positionId: pos.id,
    enabled: true,
    algo: 'supply-match-v1',
    matchableTalentCount: count,
    supplyDifficulty: difficulty,
    matchingSuggestion: suggestionOf(count, difficulty),
    reactivatableTalentCount: scored.filter((s) => s.reactivatable).length,
    topMatches: matchable.slice(0, 5).map((m) => ({
      talentId: m.talentId, name: m.name, score: Number(m.score.toFixed(2)),
      matched: [...(m.detail.dimensions.skill.matched || []), ...(m.detail.dimensions.intent.matched || [])].slice(0, 5),
    })),
    calculatedAt: new Date().toISOString(),
    source: 'talent-supply-adapter',
  };
}

/** 只读版：只读已存在的 match_record，不重算、不写库（回放/展示用）。 */
export async function readTalentSupply(job, positionId) {
  if (!talentSupplyEnabled()) return { jobId: job.project_id, enabled: false };
  const matches = await listMatchesForPosition(positionId);
  const matchable = matches.filter((m) => (m.score || 0) >= 0.15);
  const difficulty = difficultyOf(matchable.length);
  return {
    jobId: job.project_id, positionId, enabled: true,
    matchableTalentCount: matchable.length, supplyDifficulty: difficulty,
    matchingSuggestion: suggestionOf(matchable.length, difficulty),
    reactivatableTalentCount: 0,
    topMatches: matchable.slice(0, 5).map((m) => ({ talentId: m.talent_id, name: m.talent_name, score: Number((m.score || 0).toFixed(2)) })),
    calculatedAt: new Date().toISOString(), source: 'talent-supply-adapter(read)',
  };
}
