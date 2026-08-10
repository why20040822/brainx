/** relations.js — 顾问×职位关系推导的单一权威（2026-08-10 框架修正新增）。
 *
 * 背景（修正前的结构断链）：recommend 只评「本人有 job_memberships 行」的职位，
 * 其余一律 UNKNOWN 被 hardBlock 阻断。桥接按纪律不写关系（relation=null），
 * fixture 又是 Felix 个人策展导出 —— 结果 mia/york 登录后推荐池恒为空，
 * 桥接每天刷新的团队池职位进不了任何人的推荐。
 *
 * 推导规则（优先级从高到低，fail-closed 语义保留）：
 *   1. 本人活跃 membership 行（valid_to IS NULL）→ 原样采用（Felix 策展资产优先）；
 *   2. 其他顾问持有活跃 MY_JOB/PRIMARY_PM → OTHER_CONSULTANT（机会发现，不可接单）；
 *   3. 无任何关系行 → TEAM_SHARED（职位盘点 Bitable 本质是团队共享池）。
 * 显式 UNKNOWN / NOT_JOINED 行不会被默认值覆盖（hardBlock 对它们仍然生效）。
 */
export function relationMap(db, consultant_id) {
  const mine = new Map(db.prepare(`SELECT project_id, relation FROM job_memberships
    WHERE consultant_id=? AND valid_to IS NULL`).all(consultant_id)
    .map((r) => [r.project_id, r.relation]));
  const otherOwned = new Set(db.prepare(`SELECT DISTINCT project_id FROM job_memberships
    WHERE consultant_id != ? AND valid_to IS NULL
      AND relation IN ('MY_JOB','PRIMARY_PM')`).all(consultant_id)
    .map((r) => r.project_id));
  return { mine, otherOwned };
}

export function deriveRelation({ mine, otherOwned }, project_id) {
  const r = mine.get(project_id);
  if (r) return r;
  if (otherOwned.has(project_id)) return 'OTHER_CONSULTANT';
  return 'TEAM_SHARED';
}

/** 单职位便捷入口（engage/opportunity 路由用）。 */
export function relationOf(db, consultant_id, project_id) {
  return deriveRelation(relationMap(db, consultant_id), project_id);
}
