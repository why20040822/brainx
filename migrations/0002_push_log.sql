-- 0002_push_log.sql（补全文档 §18.6）：推送记录与幂等
CREATE TABLE push_log (
  push_id       TEXT PRIMARY KEY,
  consultant_id TEXT NOT NULL,
  kind          TEXT NOT NULL,        -- DAILY_TOP3 | SYNC_ALERT | HEATING_ALERT
  run_id        TEXT,
  card_json     TEXT NOT NULL,
  target        TEXT NOT NULL,
  message_id    TEXT,
  status        TEXT NOT NULL,        -- SENT | FAILED | SKIPPED_DUPLICATE
  error         TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (consultant_id, kind, run_id)
);
