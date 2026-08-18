CREATE TABLE IF NOT EXISTS recommendation_batches (
  batch_id TEXT PRIMARY KEY,
  consultant_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 20,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (consultant_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  feedback_id TEXT PRIMARY KEY,
  consultant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  snapshot_id TEXT,
  batch_id TEXT,
  feedback TEXT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_consultant
  ON recommendation_feedback (consultant_id, project_id);
