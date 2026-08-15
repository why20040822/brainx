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
import { listMatchesForPosition, upsertPosition, writeMatchRecord, listTalents } from './talent.js';

export function talentSupplyEnabled() {
  return process.env.BRAINX_TALENT_SUPPLY === '1';
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
 * job: { project_id, company, role } —— 决策库的职位事实（只读传入，不回写）。
 * 内部按「岗位关键词 × 候选意向标签」做确定性弱匹配打分，并把匹配记录写进人才库
 * match_record（人才侧的写入，不触碰决策库）。
 */
export async function talentSupplyForJob(job) {
  if (!talentSupplyEnabled()) {
    return { jobId: job.project_id, enabled: false };
  }
  // 岗位入库（幂等），拿到 position_id 才能写匹配记录
  const pos = await upsertPosition({ title: job.role || job.company, description: job.company, requirements: job.notes || '' });
  const jobTerms = tokenize(`${job.company} ${job.role || ''}`);

  // 拉候选池做弱匹配（用 summary 文本重合近似；真实场景应换成简历向量/结构化匹配）
  const talents = await listTalents({ limit: 100 });
  const scored = [];
  for (const t of talents) {
    const cand = tokenize(t.summary || t.name || '');
    let inter = 0;
    for (const term of cand) if (jobTerms.has(term)) inter++;
    if (inter === 0) continue;
    const score = Math.min(1, inter / Math.max(6, jobTerms.size));
    const detail = { matchedTerms: inter, jobTerms: jobTerms.size, dimension: 'intention_overlap' };
    scored.push({ talentId: t.id, name: t.name, score, detail, reactivatable: t.status === 'contacted' });
    // 把匹配写进人才库（幂等覆盖）
    await writeMatchRecord({ talentId: t.id, positionId: pos.id, score, detail });
  }
  scored.sort((a, b) => b.score - a.score);

  const matchable = scored.filter((s) => s.score >= 0.15);
  const count = matchable.length;
  const difficulty = difficultyOf(count);
  return {
    jobId: job.project_id,
    positionId: pos.id,
    enabled: true,
    matchableTalentCount: count,
    supplyDifficulty: difficulty,
    matchingSuggestion: suggestionOf(count, difficulty),
    reactivatableTalentCount: scored.filter((s) => s.reactivatable).length,
    topMatches: matchable.slice(0, 5).map((m) => ({ talentId: m.talentId, name: m.name, score: Number(m.score.toFixed(2)) })),
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
