-- 0012_drop_placeholder.sql — 清除 P-FIX 占位假数据（2026-08-14，TTC 真 ID 已入池）
-- 纪律：有历史引用（承接/推荐/事件/结果/消息归因）的行只 CLOSED 不删——
-- 冻结回放是核心设计，删行会让回放读不到职位信息；CLOSED 即永久出推荐池（hardBlock）。
-- 零引用行直接删除。
DELETE FROM job_facts
WHERE project_id LIKE 'P-FIX-%'
  AND project_id NOT IN (SELECT project_id FROM job_memberships)
  AND project_id NOT IN (SELECT project_id FROM recommendations)
  AND project_id NOT IN (SELECT project_id FROM decision_events)
  AND project_id NOT IN (SELECT project_id FROM job_outcomes)
  AND project_id NOT IN (SELECT matched_project_id FROM job_messages WHERE matched_project_id IS NOT NULL);

UPDATE job_facts SET active_state='CLOSED', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE project_id LIKE 'P-FIX-%' AND active_state != 'CLOSED';
