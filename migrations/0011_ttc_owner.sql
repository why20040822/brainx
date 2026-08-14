-- 0011_ttc_owner.sql — TTC 职位主做归属列（2026-08-14）
-- TTC job/search 的 managers[0] 是权威主做归属；落列供 relations.js 推导层使用
-- （owner=本人 → MY_JOB；owner 在花名册 → OTHER_CONSULTANT；否则团队池默认）。
ALTER TABLE job_facts ADD COLUMN owner_name TEXT;        -- TTC 主做显示名（"Jade 郭子安"）
ALTER TABLE job_facts ADD COLUMN owner_unique_id TEXT;   -- TTC 用户唯一 id（U1856…）
