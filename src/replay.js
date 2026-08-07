/** replay.js + outcomes.js — 回放只读冻结行（§13.4）；结果关联推荐（PRD Slice 5）。 */
import { now, uuid } from './db.js';

/** 决策回放：冻结的推荐行 + 当轮上下文 + 后续事件与结果。不重算。 */
export function replay(db, decision_id) {
  const r = db.prepare(`SELECT * FROM recommendations WHERE decision_id=?`).get(decision_id);
  if (!r) return null;
  const run = db.prepare(`SELECT * FROM decision_runs WHERE run_id=?`).get(r.run_id);
  const job = db.prepare(`SELECT * FROM job_facts WHERE project_id=?`).get(r.project_id);
  const events = db.prepare(`SELECT event_type, actor, occurred_at, reason, prev_state, next_state
    FROM decision_events WHERE project_id=? ORDER BY occurred_at, id`).all(r.project_id);
  const outcomes = db.prepare(`SELECT stage, value_json, observed_at FROM job_outcomes
    WHERE project_id=? ORDER BY observed_at`).all(r.project_id);
  return {
    decision_id,
    run: run && { run_id: run.run_id, snapshot_id: run.snapshot_id,
                  policy_version: run.policy_version, created_at: run.created_at,
                  candidate_count: run.candidate_count },
    recommendation: {
      project_id: r.project_id, action: r.action, score: r.score, rank: r.rank,
      confidence_band: r.confidence_band, evidence_coverage: r.evidence_coverage,
      reasons: JSON.parse(r.reasons_json), risks: JSON.parse(r.risks_json),
      evidence_refs: JSON.parse(r.evidence_refs_json),
      score_breakdown: JSON.parse(r.breakdown_json),
      policy_version: r.policy_version, created_at: r.created_at,
    },
    job_now: job && { company: job.company, role: job.role, active_state: job.active_state,
                      note: '回放以 recommendation 冻结行为准；此为当前职位现状，仅对照' },
    events, outcomes: outcomes.map((o) => ({ ...o, value: JSON.parse(o.value_json) })),
  };
}

/** 记录职位级结果；decision_id 可选关联推荐。幂等。 */
export function recordOutcome(db, consultant_id, { project_id, stage, value = {}, decision_id = null, idempotency_key = '' }) {
  if (!idempotency_key) return { ok: false, status: 400, error: '缺 idempotency_key' };
  const dup = db.prepare(`SELECT id FROM job_outcomes WHERE idempotency_key=?`).get(idempotency_key);
  if (dup) return { ok: true, already: true, outcome_id: dup.id };
  const job = db.prepare(`SELECT 1 FROM job_facts WHERE project_id=?`).get(project_id);
  if (!job) return { ok: false, status: 404, error: '职位不存在' };
  const info = db.prepare(`INSERT INTO job_outcomes
    (project_id, consultant_id, stage, value_json, decision_id, idempotency_key, observed_at)
    VALUES (?,?,?,?,?,?,?)`)
    .run(project_id, consultant_id, stage, JSON.stringify(value), decision_id, idempotency_key, now());
  return { ok: true, already: false, outcome_id: info.lastInsertRowid };
}
