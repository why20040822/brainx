/** visibility.js — 职位/消息可见性的唯一权威（server.js 与 mcp/server.mjs 共用，
 * 防止两处过滤逻辑分叉）。
 *
 * 规则（fail-closed）：顾问只能看「与自己有过关系」的职位——
 *   有过 job_memberships 行（含已到期）、或被推荐过、或自己操作过（事件 actor）。
 * 其余一律 404（不泄露职位存在性）。
 * job_facts 保持全团队单表不动（三向外键 + 回放依赖），过滤只发生在读取层。
 */

export function jobVisibleTo(db, consultant_id, project_id) {
  return !!db.prepare('SELECT 1 FROM job_memberships WHERE consultant_id=? AND project_id=? LIMIT 1')
    .get(consultant_id, project_id)
    || !!db.prepare('SELECT 1 FROM recommendations WHERE consultant_id=? AND project_id=? LIMIT 1')
    .get(consultant_id, project_id)
    || !!db.prepare('SELECT 1 FROM decision_events WHERE actor=? AND project_id=? LIMIT 1')
    .get(consultant_id, project_id);
}

/** 该顾问可见的消息 id 集合（他自己的令牌+群成员身份拉到的）。 */
export function visibleMessageIds(db, consultant_id) {
  return new Set(db.prepare('SELECT message_id FROM job_message_visibility WHERE consultant_id=?')
    .all(consultant_id).map((r) => r.message_id));
}
