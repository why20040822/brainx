/** recommend.js — 生成一轮推荐并冻结（PRD §6/§8，补全文档 §13.4）。
 * 只读最近 complete=1 快照；冻结 recommendations；Top10 写 RECOMMENDED 事件。
 */
import { now, uuid } from './db.js';
import { latestCompleteSnapshot, latestSync } from './sync.js';
import { WEIGHTS, POLICY_VERSION, hardBlock, scoreJob, actionOf, bandOf, sortRecs, explain } from './scorer.js';
import { listConsultants } from './roster.js';

/** 花名册从 DB 读（0003 起 consultants 表为权威，fixtures 只是种子）。 */
export function loadConsultants(db) {
  return listConsultants(db);
}

export function buildCtx(db, consultant_id, snapshot) {
  const c = loadConsultants(db).find((x) => x.consultant_id === consultant_id) || {};
  // 历史 MY_JOB 文本（含已关闭/过期关系 → 历史相似度，§17.2-2）
  const hist = db.prepare(`SELECT DISTINCT j.company || ' ' || j.role AS text
    FROM job_memberships m JOIN job_facts j ON j.project_id = m.project_id
    WHERE m.consultant_id=? AND m.relation IN ('MY_JOB','PRIMARY_PM')`).all(consultant_id);
  const watched = db.prepare(`SELECT COUNT(*) n FROM current_engagement
    WHERE consultant_id=? AND state='WATCHED'`).get(consultant_id).n;
  const accepted = db.prepare(`SELECT COUNT(*) n FROM current_engagement
    WHERE consultant_id=? AND state='ACCEPTED'`).get(consultant_id).n;
  const avg = db.prepare(`SELECT AVG(json_extract(value_json,'$.rating')) a FROM job_outcomes
    WHERE consultant_id=? AND json_extract(value_json,'$.rating') IS NOT NULL`).get(consultant_id).a;
  return {
    consultant_id,
    profile_keywords: c.profile_keywords || [],
    historical_texts: hist.map((h) => h.text),
    watched_count: watched, accepted_count: accepted,
    outcomes_avg: avg, now: now(), snapshot_id: snapshot?.sync_id || '',
  };
}

/**
 * 生成一轮推荐。硬约束：最近同步 complete=0 → blocked，不落推荐。
 * 返回 { run_id, blocked, items[] }；dry_run 不落库。
 */
export function recommend(db, consultant_id, { top = 10, dry_run = false } = {}) {
  const last = latestSync(db, consultant_id);
  const snapshot = latestCompleteSnapshot(db, consultant_id);
  if (!snapshot) {
    return { blocked: true, reason: '无完整快照，先同步', items: [], run_id: null };
  }
  if (!last || !last.complete) {
    return { blocked: true, reason: '本次同步不完整，暂不生成正式推荐',
             sync: last, snapshot_id: snapshot.sync_id, items: [], run_id: null };
  }

  const jobs = db.prepare(`SELECT * FROM job_facts`).all();
  const rels = db.prepare(`SELECT project_id, relation FROM job_memberships
    WHERE consultant_id=? AND valid_to IS NULL`).all(consultant_id);
  const relMap = Object.fromEntries(rels.map((r) => [r.project_id, r.relation]));
  const ctx = buildCtx(db, consultant_id, snapshot);

  const evaluated = [];
  let blockedCount = 0;
  for (const job of jobs) {
    const relation = relMap[job.project_id] || 'UNKNOWN';
    const block = hardBlock(job, relation, true);
    if (block) { blockedCount++; continue; }
    const scored = scoreJob(job, relation, ctx);
    const { reasons, risks, evidence_refs } = explain(job, relation, scored, ctx);
    evaluated.push({
      decision_id: uuid(), project_id: job.project_id, job, relation,
      action: actionOf(scored.score, scored.coverage),
      score: scored.score, evidence_coverage: scored.coverage,
      confidence_band: bandOf(scored.coverage),
      reasons, risks, evidence_refs, breakdown: scored.breakdown,
    });
  }
  evaluated.sort(sortRecs);
  evaluated.forEach((r, i) => { r.rank = i + 1; });

  const run_id = uuid();
  if (!dry_run) {
    const insRun = db.prepare(`INSERT INTO decision_runs
      (run_id, consultant_id, snapshot_id, policy_version, candidate_count, status, created_at)
      VALUES (?,?,?,?,?,?,?)`);
    const insRec = db.prepare(`INSERT INTO recommendations
      (decision_id, run_id, project_id, consultant_id, action, score, confidence_band,
       evidence_coverage, reasons_json, risks_json, evidence_refs_json, breakdown_json,
       policy_version, rank, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insEvt = db.prepare(`INSERT INTO decision_events
      (event_id, event_type, actor, occurred_at, project_id, decision_id, policy_version,
       idempotency_key, prev_state, next_state, payload_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    db.exec('BEGIN');
    try {
      insRun.run(run_id, consultant_id, snapshot.sync_id, POLICY_VERSION, evaluated.length, 'COMPLETED', now());
      for (const r of evaluated.slice(0, top)) {
        insRec.run(r.decision_id, run_id, r.project_id, consultant_id, r.action, r.score,
                   r.confidence_band, r.evidence_coverage, JSON.stringify(r.reasons),
                   JSON.stringify(r.risks), JSON.stringify(r.evidence_refs),
                   JSON.stringify(r.breakdown), POLICY_VERSION, r.rank, now());
        insEvt.run(uuid(), 'RECOMMENDED', consultant_id, now(), r.project_id, r.decision_id,
                   POLICY_VERSION, `rec:${run_id}:${r.project_id}`, null, 'RECOMMENDED', '{}');
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  return {
    run_id, blocked: false, snapshot_id: snapshot.sync_id, policy_version: POLICY_VERSION,
    input_stats: { candidates: jobs.length, after_hard_filter: evaluated.length, blocked: blockedCount },
    items: evaluated.slice(0, top).map(publicRec),
    generated_at: now(),
  };
}

export const publicRec = (r) => ({
  decision_id: r.decision_id, rank: r.rank, action: r.action,
  score: r.score, confidence_band: r.confidence_band, evidence_coverage: r.evidence_coverage,
  reasons: r.reasons, risks: r.risks, evidence_refs: r.evidence_refs,
  breakdown: r.breakdown,
  job: {
    project_id: r.job.project_id, company: r.job.company, role: r.job.role,
    city: r.job.city, pipeline: r.job.pipeline, hc: r.job.hc,
    active_state: r.job.active_state, relation: r.relation, source_url: r.job.source_url,
    captured_at: r.job.captured_at,
  },
});

/** 读最新一轮推荐（工作台默认视图）。 */
export function latestRun(db, consultant_id) {
  const run = db.prepare(`SELECT * FROM decision_runs WHERE consultant_id=?
    ORDER BY created_at DESC LIMIT 1`).get(consultant_id);
  if (!run) return null;
  const recs = db.prepare(`SELECT * FROM recommendations WHERE run_id=? ORDER BY rank`).all(run.run_id);
  const jobs = db.prepare(`SELECT * FROM job_facts`).all();
  const jobMap = Object.fromEntries(jobs.map((j) => [j.project_id, j]));
  const rels = db.prepare(`SELECT project_id, relation FROM job_memberships
    WHERE consultant_id=? AND valid_to IS NULL`).all(consultant_id);
  const relMap = Object.fromEntries(rels.map((r) => [r.project_id, r.relation]));
  return {
    run,
    items: recs.map((r) => ({
      decision_id: r.decision_id, rank: r.rank, action: r.action, score: r.score,
      confidence_band: r.confidence_band, evidence_coverage: r.evidence_coverage,
      reasons: JSON.parse(r.reasons_json), risks: JSON.parse(r.risks_json),
      evidence_refs: JSON.parse(r.evidence_refs_json), breakdown: JSON.parse(r.breakdown_json),
      job: { ...jobMap[r.project_id], relation: relMap[r.project_id] || 'UNKNOWN' },
    })),
  };
}
