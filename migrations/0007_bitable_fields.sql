-- 0007_bitable_fields.sql — Bitable 标准字段适配（2026-08-10，实测驱动）
-- 实测依据：field-list 7 列（公司/职位[多选职能]/主做[user,全空]/地点/还做吗[优先级]/文本/公司类型）
-- ① job_facts 扩三列：还做吗结构化为 priority；文本=需求细节进 notes；公司类型进 company_type。
ALTER TABLE job_facts ADD COLUMN priority TEXT;      -- HIGH | NEW | NORMAL | STANDBY | NULL(非盘点源)
ALTER TABLE job_facts ADD COLUMN notes TEXT;         -- Bitable「文本」需求细节（修正前 0/86 入库）
ALTER TABLE job_facts ADD COLUMN company_type TEXT;  -- Bitable「公司类型」（方向匹配素材）

-- ② 旧桥接复合 role 行退役：新解析按「公司×单职能」展开（bitable.js），旧顿号拼接行
--    不再被任何同步重建，CLOSED 硬阻断（冻结回放可对照，FK 不破）。
--    只动桥接来源：fixture 的「（多岗）」复合行是 Felix 策展资产，保留不动。
UPDATE job_facts SET active_state='CLOSED', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE role LIKE '%、%' AND role NOT LIKE '%（多岗）'
  AND sync_id IN (SELECT sync_id FROM sync_runs WHERE source='bridge');

-- ③ fixture 属主污染清理：非属主顾问的 fixture 来源关系行到期（云端实测 mia 已继承
--    Felix 60 条；关系今后由 relations.js 推导：本人行 > 他人主做 > 团队池默认）。
UPDATE job_memberships SET valid_to=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source='fixture' AND consultant_id != 'felix' AND valid_to IS NULL;
