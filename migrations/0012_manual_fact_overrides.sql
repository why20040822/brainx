-- 0012_manual_fact_overrides.sql — 当前顾问的项目事实人工覆盖
-- 原始同步事实保持不变；覆盖只作用于当前 consultant_id 的有效判断。

CREATE TABLE IF NOT EXISTS manual_fact_overrides (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  consultant_id   TEXT NOT NULL,
  project_id      TEXT NOT NULL REFERENCES job_facts(project_id) ON DELETE CASCADE,
  field           TEXT NOT NULL CHECK (field IN
    ('active_state','current_stage','pipeline_snapshot','remaining_hc','next_action','notes')),
  value_json      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (consultant_id, project_id, field)
);
CREATE INDEX IF NOT EXISTS idx_manual_fact_overrides_project
  ON manual_fact_overrides(consultant_id, project_id);

CREATE TABLE IF NOT EXISTS fact_override_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        TEXT NOT NULL UNIQUE,
  consultant_id   TEXT NOT NULL,
  project_id      TEXT NOT NULL REFERENCES job_facts(project_id) ON DELETE CASCADE,
  occurred_at     TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  before_json     TEXT NOT NULL,
  after_json      TEXT NOT NULL,
  changes_json    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fact_override_events_project
  ON fact_override_events(consultant_id, project_id, occurred_at);
