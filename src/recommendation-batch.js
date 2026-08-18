import { now, uuid } from './db.js';
import { latestRun } from './recommend.js';
import { effectiveJob } from './facts.js';
import { currentState } from './engagement.js';

const LIMIT = 20;

function batchFor(db, consultantId, snapshotId, size = LIMIT) {
  let batch = db.prepare('SELECT * FROM recommendation_batches WHERE consultant_id=? AND snapshot_id=?').get(consultantId, snapshotId);
  if (!batch) {
    const at = now();
    const batchId = `batch_${uuid()}`;
    db.prepare(`INSERT INTO recommendation_batches
      (batch_id, consultant_id, snapshot_id, cursor, size, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(batchId, consultantId, snapshotId, 0, Math.min(size, LIMIT), at, at);
    batch = db.prepare('SELECT * FROM recommendation_batches WHERE batch_id=?').get(batchId);
  }
  return batch;
}

function isHidden(db, consultantId, item) {
  const feedback = db.prepare(`SELECT 1 FROM recommendation_feedback
    WHERE consultant_id=? AND project_id=? LIMIT 1`).get(consultantId, item.job.project_id);
  if (feedback) return true;
  const state = currentState(db, consultantId, item.job.project_id);
  if (['ACCEPTED', 'COOLING', 'DISMISSED'].includes(state.state)) return true;
  return ['CLOSED', 'COMPLETED', 'COOLING'].includes(item.job.active_state);
}

function page(db, consultantId, batch, cursor) {
  const run = latestRun(db, consultantId);
  if (!run || run.run.snapshot_id !== batch.snapshot_id) return { items: [], next_cursor: null, has_more: false };
  const size = Math.min(Number(batch.size) || LIMIT, LIMIT);
  const all = run.items.filter((item) => !isHidden(db, consultantId, item));
  const items = all.slice(cursor, cursor + size);
  const next = cursor + items.length;
  return { items, next_cursor: next < all.length ? String(next) : null, has_more: next < all.length };
}

export function pickTray(db, consultantId, { limit = LIMIT, cursor } = {}) {
  const run = latestRun(db, consultantId);
  if (!run) return { snapshot_id: null, batch_id: null, items: [], next_cursor: null, has_more: false };
  const batch = batchFor(db, consultantId, run.run.snapshot_id, Math.min(Number(limit) || LIMIT, LIMIT));
  const requested = cursor == null || cursor === '' ? batch.cursor : Math.max(0, Number(cursor) || 0);
  if (requested !== batch.cursor) db.prepare('UPDATE recommendation_batches SET cursor=?, updated_at=? WHERE batch_id=?').run(requested, now(), batch.batch_id);
  const result = page(db, consultantId, batch, requested);
  return { snapshot_id: run.run.snapshot_id, batch_id: batch.batch_id, items: result.items,
    next_cursor: result.next_cursor, has_more: result.has_more, cursor: String(requested) };
}

export function nextBatch(db, consultantId, body) {
  const run = latestRun(db, consultantId);
  if (!run) return { ok: false, status: 409, code: 'NO_RECOMMENDATION', message: '暂无完整推荐快照' };
  const batch = batchFor(db, consultantId, run.run.snapshot_id, body?.size || LIMIT);
  const current = Math.max(0, Number(body?.cursor ?? batch.cursor) || 0);
  const currentPage = page(db, consultantId, batch, current);
  const next = current + currentPage.items.length;
  db.prepare('UPDATE recommendation_batches SET cursor=?, updated_at=? WHERE batch_id=?').run(next, now(), batch.batch_id);
  const result = page(db, consultantId, batch, next);
  return { ok: true, snapshot_id: run.run.snapshot_id, batch_id: batch.batch_id, items: result.items,
    next_cursor: result.next_cursor, has_more: result.has_more, cursor: String(next) };
}

export function feedback(db, consultantId, body) {
  if (!body?.project_id || body.feedback !== 'NOT_INTERESTED' || !body.reason || !body.idempotency_key) {
    return { ok: false, status: 422, code: 'INVALID_FEEDBACK', message: '需要 project_id、NOT_INTERESTED、reason 和 idempotency_key' };
  }
  const existing = db.prepare('SELECT * FROM recommendation_feedback WHERE idempotency_key=?').get(body.idempotency_key);
  if (existing) return { ok: true, already: true, feedback_id: existing.feedback_id, replacement: pickTray(db, consultantId, { limit: LIMIT }) };
  const run = latestRun(db, consultantId);
  const item = run?.items.find((entry) => entry.job.project_id === body.project_id);
  if (!item) return { ok: false, status: 404, code: 'NOT_IN_SNAPSHOT', message: '职位不在当前冻结推荐快照中' };
  const batch = batchFor(db, consultantId, run.run.snapshot_id, LIMIT);
  const feedbackId = `feedback_${uuid()}`;
  db.prepare(`INSERT INTO recommendation_feedback
    (feedback_id, consultant_id, project_id, snapshot_id, batch_id, feedback, reason, idempotency_key, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(feedbackId, consultantId, body.project_id, run.run.snapshot_id, body.batch_id || batch.batch_id,
      body.feedback, String(body.reason).slice(0, 200), body.idempotency_key, now());
  return { ok: true, feedback_id: feedbackId, replacement: pickTray(db, consultantId, { limit: LIMIT }) };
}
