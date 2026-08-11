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

/** 幂等播种：只补空位，不覆盖在线刷新得来的 open_id；
 * profile_json 只在「现值为空档案」时才播种——顾问自维护的档案（PUT /api/v1/profile）
 * 不得被重启时的种子冲掉（修正前每次 openDb 都会无条件覆盖）。 */
export function seedRoster(db, seedPath = join(ROOT, 'fixtures', 'roster.json')) {
  const rows = JSON.parse(readFileSync(seedPath, 'utf8'));
  const st = db.prepare(`INSERT INTO consultants
      (consultant_id, display_name, open_id, profile_json, source, active, created_at)
    VALUES (?,?,?,?,?,1,?)
    ON CONFLICT(consultant_id) DO UPDATE SET
      display_name = excluded.display_name,
      profile_json = CASE
        WHEN json_array_length(COALESCE(json_extract(consultants.profile_json,'$.profile_keywords'),'[]')) = 0
        THEN excluded.profile_json ELSE consultants.profile_json END,
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

/** 顾问档案自维护（2026-08-11）：只许改自己的方向画像。下一轮 recommend 即生效
 * （buildCtx 每轮实时读 consultants 表）。 */
export function updateProfile(db, consultant_id, { profile_keywords, profile_note } = {}) {
  const cur = withProfile(db.prepare('SELECT * FROM consultants WHERE consultant_id=? AND active=1')
    .get(consultant_id));
  if (!cur) return { ok: false, status: 404, error: '顾问不存在' };
  const kwsRaw = profile_keywords !== undefined ? profile_keywords : (cur.profile_keywords || []);
  if (!Array.isArray(kwsRaw)) return { ok: false, status: 422, error: 'profile_keywords 必须是字符串数组' };
  const cleaned = kwsRaw.map((k) => String(k).trim()).filter(Boolean);
  if (cleaned.length > 20) return { ok: false, status: 422, error: '方向关键词最多 20 个' };
  if (cleaned.some((k) => k.length > 20)) return { ok: false, status: 422, error: '单个关键词最长 20 字' };
  const kws = [...new Set(cleaned)]; // 去重在数量校验之后（21 个相同词也是超限）
  const note = String(profile_note !== undefined ? profile_note : (cur.profile_note || '')).slice(0, 200);
  db.prepare('UPDATE consultants SET profile_json=? WHERE consultant_id=?')
    .run(JSON.stringify({ profile_keywords: kws, profile_note: note }), consultant_id);
  return { ok: true, consultant_id, profile_keywords: kws, profile_note: note };
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
