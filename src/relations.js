/** relations.js — 顾问×职位关系推导的单一权威（2026-08-10 框架修正新增）。
 *
 * 背景（修正前的结构断链）：recommend 只评「本人有 job_memberships 行」的职位，
 * 其余一律 UNKNOWN 被 hardBlock 阻断。桥接按纪律不写关系（relation=null），
 * fixture 又是 Felix 个人策展导出 —— 结果 mia/york 登录后推荐池恒为空，
 * 桥接每天刷新的团队池职位进不了任何人的推荐。
 *
 * 推导规则（优先级从高到低，fail-closed 语义保留）：
 *   1. 本人活跃 membership 行（valid_to IS NULL）→ 原样采用（策展资产优先）；
 *   2. TTC 主做归属（owner_name，0011 起）：= 本人显示名 → MY_JOB（ATS 权威）；
 *      = 花名册内他人 → OTHER_CONSULTANT；
 *   3. 其他顾问持有活跃 MY_JOB/PRIMARY_PM membership → OTHER_CONSULTANT（机会发现）；
 *   4. 无任何关系行 → TEAM_SHARED（团队共享池默认）。
 * 显式 UNKNOWN / NOT_JOINED 行不会被默认值覆盖（hardBlock 对它们仍然生效）。
 * owner 不在花名册（团队外成员主做）→ 不落 OTHER_CONSULTANT，走团队池默认——
 * 非花名册主做不构成「可机会发现的同事实名」，保持保守。
 */
export function relationMap(db, consultant_id) {
  const mine = new Map(db.prepare(`SELECT project_id, relation FROM job_memberships
    WHERE consultant_id=? AND valid_to IS NULL`).all(consultant_id)
    .map((r) => [r.project_id, r.relation]));
  const otherOwned = new Set(db.prepare(`SELECT DISTINCT project_id FROM job_memberships
    WHERE consultant_id != ? AND valid_to IS NULL
      AND relation IN ('MY_JOB','PRIMARY_PM')`).all(consultant_id)
    .map((r) => r.project_id));
  // TTC 主做归属层（无 owner_name 的行不进 Map，查询零开销）
  const ttcOwner = new Map(db.prepare(`SELECT project_id, owner_name FROM job_facts
    WHERE owner_name IS NOT NULL AND owner_name != ''`).all()
    .map((r) => [r.project_id, r.owner_name]));
  const myName = db.prepare('SELECT display_name FROM consultants WHERE consultant_id=?')
    .get(consultant_id)?.display_name || '';
  const rosterNames = new Set(db.prepare(`SELECT display_name FROM consultants
    WHERE active=1 AND consultant_id != ?`).all(consultant_id).map((r) => r.display_name));
  return { mine, otherOwned, ttcOwner, myName, rosterNames };
}

export function deriveRelation({ mine, otherOwned, ttcOwner = new Map(), myName = '', rosterNames = new Set() }, project_id) {
  const r = mine.get(project_id);
  if (r) return r;                                    // 1. 策展资产
  const owner = ttcOwner.get(project_id);
  if (owner && myName && owner === myName) return 'MY_JOB';          // 2a. ATS 权威主做=本人
  if (owner && rosterNames.has(owner)) return 'OTHER_CONSULTANT';    // 2b. 主做=花名册他人
  if (otherOwned.has(project_id)) return 'OTHER_CONSULTANT';         // 3. 他人策展持有
  return 'TEAM_SHARED';                                              // 4. 团队池默认
}

/** 单职位便捷入口（engage/opportunity 路由用）。 */
export function relationOf(db, consultant_id, project_id) {
  return deriveRelation(relationMap(db, consultant_id), project_id);
}
