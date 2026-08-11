-- 0006_framework.sql — 2026-08-10 框架修正迁移
-- ① current_engagement 重建：VIEWED 纳入状态推导。
--    修正前视图不含 VIEWED → 「已查看」状态永不浮现（currentState 回落 RECOMMENDED），
--    且 VIEW 对 WATCHED 职位会写成 next_state=VIEWED 造成关注被静默降级。
--    配合 engagement.js：VIEW 对 WATCHED 职位 next_state 保持 WATCHED，视图即可安全纳入 VIEWED。
DROP VIEW IF EXISTS current_engagement;
CREATE VIEW current_engagement AS
SELECT project_id, actor AS consultant_id, next_state AS state,
       occurred_at AS state_since
FROM decision_events e1
WHERE id = (SELECT MAX(id) FROM decision_events e2
            WHERE e2.project_id = e1.project_id AND e2.actor = e1.actor
              AND e2.event_type IN
              ('VIEWED','WATCHED','ACCEPTED','DISMISSED','RELEASED','EXPIRED','COMPLETED'));

-- ② push_log：UNIQUE(consultant_id, kind, run_id) 中 run_id 为 NULL 时
--    SQLite 视 NULL 互不相等 → 唯一键对 SYNC_ALERT（run_id 恒 NULL）形同虚设。
--    统一 '' 哨兵（push.js 同步改），回填存量。
UPDATE push_log SET run_id='' WHERE run_id IS NULL;
