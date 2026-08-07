/** roster.js — 顾问花名册：DB 为权威，fixtures/roster.json 为种子（幂等）。
 * 种子派生自 FLX 职位优先级群成员实拉（见 fixtures/roster.json 头注）。
 * 在线刷新：bin/brainx-roster.mjs --from-group（lark-cli chat.members get）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { now } from './db.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const withProfile = (r) => {
  if (!r) return null;
  const p = JSON.parse(r.profile_json || '{}');
  return { ...r, ...p, profile_json: undefined };
};

/** 幂等播种：只补空位，不覆盖在线刷新得来的 open_id。 */
export function seedRoster(db, seedPath = join(ROOT, 'fixtures', 'roster.json')) {
  const rows = JSON.parse(readFileSync(seedPath, 'utf8'));
  const st = db.prepare(`INSERT INTO consultants
      (consultant_id, display_name, open_id, profile_json, source, active, created_at)
    VALUES (?,?,?,?,?,1,?)
    ON CONFLICT(consultant_id) DO UPDATE SET
      display_name = excluded.display_name,
      profile_json = excluded.profile_json,
      open_id = COALESCE(consultants.open_id, excluded.open_id)`);
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      st.run(r.consultant_id, r.display_name, r.open_id || null,
        JSON.stringify({ profile_keywords: r.profile_keywords || [], profile_note: r.profile_note || '' }),
        r.source || 'flx_group', now());
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return rows.length;
}

export function listConsultants(db, { activeOnly = true } = {}) {
  return db.prepare(`SELECT * FROM consultants ${activeOnly ? 'WHERE active=1' : ''}
    ORDER BY consultant_id`).all().map(withProfile);
}

export function findByOpenId(db, open_id) {
  if (!open_id) return null;
  return withProfile(db.prepare('SELECT * FROM consultants WHERE open_id=? AND active=1').get(open_id));
}

/** 在线刷新：从群成员列表 upsert（slug = 名字首词小写，felix/mia/york 与历史数据兼容）。 */
export function upsertMembers(db, members, source = 'flx_group') {
  const st = db.prepare(`INSERT INTO consultants
      (consultant_id, display_name, open_id, profile_json, source, active, created_at)
    VALUES (?,?,?,'{}',?,1,?)
    ON CONFLICT(consultant_id) DO UPDATE SET
      display_name=excluded.display_name, open_id=excluded.open_id`);
  let n = 0;
  for (const m of members) {
    const slug = String(m.name || '').trim().split(/\s+/)[0].toLowerCase();
    if (!slug || !m.member_id) continue;
    st.run(slug, m.name, m.member_id, source, now());
    n++;
  }
  return n;
}
