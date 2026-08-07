-- Brain X 职位决策层 1.0 · 0001_init.sql（补全文档 §13.3）
-- ① 同步批次（complete=0 的快照不得用于正式推荐）
CREATE TABLE sync_runs (
  sync_id        TEXT PRIMARY KEY,
  consultant_id  TEXT NOT NULL,
  source         TEXT NOT NULL,                 -- ttc | feishu | fixture
  as_of          TEXT NOT NULL,
  rows_expected  INTEGER NOT NULL DEFAULT 0,
  rows_read      INTEGER NOT NULL DEFAULT 0,
  complete       INTEGER NOT NULL DEFAULT 0,
  errors         TEXT NOT NULL DEFAULT '[]',
  input_hash     TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  started_at     TEXT NOT NULL,
  completed_at   TEXT
);

-- ② 职位事实（project_id 唯一，重复同步 UPSERT 不新增）
CREATE TABLE job_facts (
  project_id   TEXT PRIMARY KEY,
  company      TEXT NOT NULL,
  role         TEXT NOT NULL,
  city         TEXT,
  pipeline     TEXT,
  hc           INTEGER,
  active_state TEXT NOT NULL DEFAULT 'UNKNOWN', -- OPEN | CLOSED | ON_HOLD | COMPLETED | COOLING | UNKNOWN
  source_url   TEXT,
  captured_at  TEXT NOT NULL,
  sync_id      TEXT NOT NULL REFERENCES sync_runs(sync_id),
  raw_json     TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_job_facts_state   ON job_facts(active_state);
CREATE INDEX idx_job_facts_company ON job_facts(company);

-- ③ 顾问×职位关系（当前关系 = valid_to IS NULL）
CREATE TABLE job_memberships (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  consultant_id TEXT NOT NULL,
  project_id    TEXT NOT NULL REFERENCES job_facts(project_id),
  relation      TEXT NOT NULL CHECK (relation IN
    ('MY_JOB','PRIMARY_PM','TEAM_SHARED','OTHER_CONSULTANT','NOT_JOINED','UNKNOWN')),
  source        TEXT NOT NULL,
  valid_from    TEXT NOT NULL,
  valid_to      TEXT,
  UNIQUE (consultant_id, project_id, relation, valid_from)
);
CREATE INDEX idx_memberships_lookup ON job_memberships(consultant_id, project_id, valid_to);

-- ④ 每一轮推荐
CREATE TABLE decision_runs (
  run_id          TEXT PRIMARY KEY,
  consultant_id   TEXT NOT NULL,
  snapshot_id     TEXT NOT NULL,                -- 最近一条 complete=1 的 sync_id
  policy_version  TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'COMPLETED', -- RUNNING | COMPLETED | FAILED
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_runs_consultant ON decision_runs(consultant_id, created_at);

-- ⑤ 推荐结果（冻结；回放只读此表不重算）
CREATE TABLE recommendations (
  decision_id        TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL REFERENCES decision_runs(run_id),
  project_id         TEXT NOT NULL REFERENCES job_facts(project_id),
  consultant_id      TEXT NOT NULL,
  action             TEXT NOT NULL,             -- RECOMMEND_ACCEPT | RECOMMEND_WATCH | OBSERVE
  score              REAL NOT NULL,
  confidence_band    TEXT NOT NULL,             -- HIGH | MEDIUM | LOW
  evidence_coverage  REAL NOT NULL,
  reasons_json       TEXT NOT NULL,             -- ≥2 条
  risks_json         TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,             -- [{type, ref, excerpt}]
  breakdown_json     TEXT NOT NULL DEFAULT '[]',-- 逐维得分 [{dim, weight, score|null}]
  policy_version     TEXT NOT NULL,
  rank               INTEGER NOT NULL,
  created_at         TEXT NOT NULL,
  UNIQUE (run_id, project_id)
);
CREATE INDEX idx_recs_consultant ON recommendations(consultant_id, created_at);

-- ⑥ 事件账本（只追加；idempotency_key 去重）
CREATE TABLE decision_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        TEXT NOT NULL UNIQUE,
  event_type      TEXT NOT NULL CHECK (event_type IN
    ('RECOMMENDED','VIEWED','WATCHED','ACCEPTED','DISMISSED','RELEASED','EXPIRED','COMPLETED')),
  actor           TEXT NOT NULL,
  occurred_at     TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  decision_id     TEXT,
  policy_version  TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  prev_state      TEXT,
  next_state      TEXT,
  reason          TEXT,
  payload_json    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_events_project ON decision_events(project_id, occurred_at);
CREATE INDEX idx_events_actor   ON decision_events(actor, occurred_at);

-- ⑦ 职位级结果（Slice 5）
CREATE TABLE job_outcomes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT NOT NULL REFERENCES job_facts(project_id),
  consultant_id   TEXT NOT NULL,
  stage           TEXT NOT NULL,                -- 推荐采纳 | 面试 | Offer | 入职 | 关闭 | 反馈
  value_json      TEXT NOT NULL,
  decision_id     TEXT REFERENCES recommendations(decision_id),
  idempotency_key TEXT NOT NULL UNIQUE,
  observed_at     TEXT NOT NULL
);
CREATE INDEX idx_outcomes_project ON job_outcomes(project_id, observed_at);

-- 当前承接状态 = 事件账本推导视图（单一事实源在账本）
CREATE VIEW current_engagement AS
SELECT project_id, actor AS consultant_id, next_state AS state,
       occurred_at AS state_since
FROM decision_events e1
WHERE id = (SELECT MAX(id) FROM decision_events e2
            WHERE e2.project_id = e1.project_id AND e2.actor = e1.actor
              AND e2.event_type IN
              ('WATCHED','ACCEPTED','DISMISSED','RELEASED','EXPIRED','COMPLETED'));
