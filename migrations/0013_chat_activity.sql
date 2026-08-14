-- 0013_chat_activity.sql — 职位驾驶舱群关联与活跃判定（2026-08-14）
-- chat_id：TTC group_chat.id（一群可挂多职位）；chat_last_at/chat_msgs_7d 由桥接
-- 消息拉取后回写（计算列，不参与 captured_at 变化检测）。
ALTER TABLE job_facts ADD COLUMN chat_id TEXT;
ALTER TABLE job_facts ADD COLUMN chat_last_at TEXT;
ALTER TABLE job_facts ADD COLUMN chat_msgs_7d INTEGER;
CREATE INDEX IF NOT EXISTS idx_job_facts_chat ON job_facts(chat_id);
CREATE INDEX IF NOT EXISTS idx_job_messages_chat_sent ON job_messages(chat_id, sent_at);
