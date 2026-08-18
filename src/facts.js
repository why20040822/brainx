/** facts.js — 原始同步事实 + 当前顾问人工覆盖的有效事实读取/写入层。 */
import { now, uuid } from './db.js';

export const MANUAL_FACT_FIELDS = [
  'active_state', 'current_stage', 'pipeline_snapshot',
  'remaining_hc', 'next_action', 'notes',
];

const ACTIVE_STATES = new Set(['OPEN', 'COOLING', 'CLOSED', 'COMPLETED']);
const STRING_LIMITS = {
  current_stage: 120,
  pipeline_snapshot: 500,
  next_action: 500,
  notes: 2000,
};

const sourceFact = (job, cockpit, occupancy, field) => {
  if (field === 'active_state') return job?.active_state ?? null;
  if (field === 'current_stage') return cockpit?.current_stage ?? null;
  if (field === 'pipeline_snapshot') return cockpit?.pipeline_snapshot ?? job?.pipeline ?? null;
  if (field === 'remaining_hc') return occupancy?.remaining_hc ?? job?.hc ?? null;
  if (field === 'next_action') return cockpit?.next_action ?? null;
  if (field === 'notes') return job?.notes ?? null;
  return null;
};

const normalizeOverride = (field, value) => {
  if (field === 'active_state') {
    if (typeof value !== 'string' || !ACTIVE_STATES.has(value)) {
      return { ok: false, error: 'active_state 必须是 OPEN、COOLING、CLOSED 或 COMPLETED' };
    }
    return { ok: true, value };
  }
  if (field === 'remaining_hc') {
    if (!Number.isInteger(value) || value < 0 || value > 100000) {
      return { ok: false, error: 'remaining_hc 必须是 0 到 100000 的整数' };
    }
    return { ok: true, value };
  }
  if (typeof value !== 'string') return { ok: false, error: `${field} 必须是文本` };
  const valueTrimmed = value.trim();
  if (valueTrimmed.length > STRING_LIMITS[field]) {
    return { ok: false, error: `${field} 长度不能超过 ${STRING_LIMITS[field]} 个字符` };
  }
  return { ok: true, value: valueTrimmed };
};

function rowsFor(db, consultant_id, project_id) {
  const job = db.prepare('SELECT * FROM job_facts WHERE project_id=?').get(project_id);
  if (!job) return null;
  const cockpit = db.prepare('SELECT * FROM cockpit_facts WHERE project_id=?').get(project_id) || null;
  const occupancy = db.prepare('SELECT * FROM job_occupancy WHERE project_id=?').get(project_id) || null;
  const overrides = db.prepare(`SELECT field, value_json, updated_at
    FROM manual_fact_overrides WHERE consultant_id=? AND project_id=?`).all(consultant_id, project_id);
  return { job, cockpit, occupancy, overrides };
}

export function overrideMap(db, consultant_id, project_id) {
  const rows = rowsFor(db, consultant_id, project_id)?.overrides || [];
  return Object.fromEntries(rows.map((r) => [r.field, { value: JSON.parse(r.value_json), updated_at: r.updated_at }]));
}

/** 返回 scorer、推荐和详情共用的当前顾问有效职位事实。 */
export function effectiveJob(db, consultant_id, project_id, baseJob = null) {
  const rows = rowsFor(db, consultant_id, project_id);
  if (!rows) return null;
  const overrides = Object.fromEntries(rows.overrides.map((r) => [r.field, JSON.parse(r.value_json)]));
  const effective = { ...rows.job };
  const current_stage = overrides.current_stage ?? sourceFact(rows.job, rows.cockpit, rows.occupancy, 'current_stage');
  const pipeline_snapshot = overrides.pipeline_snapshot ?? sourceFact(rows.job, rows.cockpit, rows.occupancy, 'pipeline_snapshot');
  const remaining_hc = overrides.remaining_hc ?? sourceFact(rows.job, rows.cockpit, rows.occupancy, 'remaining_hc');
  effective.active_state = overrides.active_state ?? sourceFact(rows.job, rows.cockpit, rows.occupancy, 'active_state');
  effective.pipeline = pipeline_snapshot;
  effective.hc = remaining_hc;
  effective.current_stage = current_stage;
  effective.pipeline_snapshot = pipeline_snapshot;
  effective.next_action = overrides.next_action ?? sourceFact(rows.job, rows.cockpit, rows.occupancy, 'next_action');
  effective.notes = overrides.notes ?? sourceFact(rows.job, rows.cockpit, rows.occupancy, 'notes');
  effective.fact_sources = Object.fromEntries(MANUAL_FACT_FIELDS.map((field) => [
    field,
    overrides[field] !== undefined ? 'MANUAL' : sourceFact(rows.job, rows.cockpit, rows.occupancy, field) == null ? 'UNKNOWN' : 'SYNC',
  ]));
  effective.fact_updated_at = Object.fromEntries(MANUAL_FACT_FIELDS.map((field) => [
    field, rows.overrides.find((r) => r.field === field)?.updated_at || null,
  ]));
  return baseJob ? { ...baseJob, ...effective } : effective;
}

export function effectiveJobs(db, consultant_id) {
  return db.prepare('SELECT project_id FROM job_facts').all()
    .map(({ project_id }) => effectiveJob(db, consultant_id, project_id))
    .filter(Boolean);
}

export function effectiveFactPayload(db, consultant_id, project_id) {
  const rows = rowsFor(db, consultant_id, project_id);
  if (!rows) return null;
  const overrides = overrideMap(db, consultant_id, project_id);
  const effective = effectiveJob(db, consultant_id, project_id);
  const fields = Object.fromEntries(MANUAL_FACT_FIELDS.map((field) => [field, {
    value: sourceFact(rows.job, rows.cockpit, rows.occupancy, field),
    effective_value: effective[field === 'remaining_hc' ? 'hc' : field === 'pipeline_snapshot' ? 'pipeline_snapshot' : field],
    source: effective.fact_sources[field],
    updated_at: overrides[field]?.updated_at || null,
  }]));
  return { fields };
}

export function updateFactOverrides(db, consultant_id, project_id, {
  changes = {}, clear_fields = [], idempotency_key = '',
} = {}) {
  if (!idempotency_key || typeof idempotency_key !== 'string') {
    return { ok: false, status: 400, error: '缺 idempotency_key' };
  }
  if (idempotency_key.length > 200) return { ok: false, status: 400, error: 'idempotency_key 过长' };
  const job = db.prepare('SELECT 1 FROM job_facts WHERE project_id=?').get(project_id);
  if (!job) return { ok: false, status: 404, error: '职位不存在' };
  const duplicate = db.prepare(`SELECT event_id, occurred_at, after_json FROM fact_override_events
    WHERE idempotency_key=?`).get(idempotency_key);
  if (duplicate) {
    return { ok: true, already: true, event_id: duplicate.event_id,
      effective: effectiveJob(db, consultant_id, project_id), fact_updates: effectiveFactPayload(db, consultant_id, project_id) };
  }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return { ok: false, status: 400, error: 'changes 必须是对象' };
  }
  if (!Array.isArray(clear_fields)) return { ok: false, status: 400, error: 'clear_fields 必须是数组' };
  const keys = [...new Set([...Object.keys(changes), ...clear_fields])];
  if (!keys.length) return { ok: false, status: 422, error: '至少修正一个事实或撤销一个字段' };
  for (const field of keys) {
    if (!MANUAL_FACT_FIELDS.includes(field)) return { ok: false, status: 422, error: `不支持人工修正字段：${field}` };
    if (clear_fields.includes(field) && Object.prototype.hasOwnProperty.call(changes, field)) {
      return { ok: false, status: 422, error: `${field} 不能同时修改和撤销` };
    }
  }
  const before = effectiveJob(db, consultant_id, project_id);
  const normalized = {};
  for (const field of Object.keys(changes)) {
    const out = normalizeOverride(field, changes[field]);
    if (!out.ok) return { ok: false, status: 422, error: out.error };
    normalized[field] = out.value;
  }

  const at = now();
  db.exec('BEGIN');
  try {
    const upsert = db.prepare(`INSERT INTO manual_fact_overrides
      (consultant_id, project_id, field, value_json, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(consultant_id, project_id, field) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`);
    for (const [field, value] of Object.entries(normalized)) {
      upsert.run(consultant_id, project_id, field, JSON.stringify(value), at);
    }
    const clear = db.prepare('DELETE FROM manual_fact_overrides WHERE consultant_id=? AND project_id=? AND field=?');
    for (const field of clear_fields) clear.run(consultant_id, project_id, field);
    const after = effectiveJob(db, consultant_id, project_id);
    const event_id = uuid();
    db.prepare(`INSERT INTO fact_override_events
      (event_id, consultant_id, project_id, occurred_at, idempotency_key, before_json, after_json, changes_json)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      event_id, consultant_id, project_id, at, idempotency_key,
      JSON.stringify(before), JSON.stringify(after), JSON.stringify({ changes: normalized, clear_fields }),
    );
    db.exec('COMMIT');
    return { ok: true, already: false, event_id, effective: after,
      fact_updates: effectiveFactPayload(db, consultant_id, project_id) };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
