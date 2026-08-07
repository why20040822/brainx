-- 0004_bridge.sql — 桥接器：增量游标 + 群消息证据（补全文档 §17.2 L3 源）
CREATE TABLE IF NOT EXISTS bridge_cursor (
  source      TEXT PRIMARY KEY,   -- 'chat:oc_xxx'
  checkpoint  TEXT NOT NULL,      -- 最后已见消息 create_time（lark-cli 原样字符串）
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_messages (
  message_id         TEXT PRIMARY KEY,
  chat_id            TEXT NOT NULL,
  sender_name        TEXT,
  msg_type           TEXT,
  text               TEXT,
  sent_at            TEXT,
  matched_project_id TEXT,         -- 公司名词典命中（可空=未归因）
  ingested_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_messages_project ON job_messages(matched_project_id);
CREATE INDEX IF NOT EXISTS idx_job_messages_sent ON job_messages(sent_at);
