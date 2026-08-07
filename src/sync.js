/** sync.js — 同步批次 + project_id 去重 + 关系落位（补全文档 §13.4、PRD §4）。
 *
 * source=fixture：读 fixtures/ttc_jobs_felix.json（真实导出衍生）。
 * source=feishu：经 lark-cli 直读职位盘点 Bitable（L2 源，无 project_id →
 *   按硬约束进 errors，不落 job_facts——架构后果见补全文档 §17.2）。
 * 重复同步：job_facts UPSERT（project_id PRIMARY KEY），行数不增。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { now, uuid } from './db.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadFixture() {
  const f = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'ttc_jobs_felix.json'), 'utf8'));
  return { as_of: f.exported_at, jobs: f.jobs };
}

/** lark-cli 读职位盘点 Bitable（L2 飞书源实测通道）。 */
export function fetchFeishuJobs() {
  const out = execFileSync('lark-cli', [
    'base', '+record-list', '--base-token', 'RR5NbWHEfacz4jsRYMocy1qAnSh',
    '--table-id', 'tblsZBwtKIrIgtre', '--page-size', '100', '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const d = JSON.parse(out.slice(out.indexOf('{'))).data;
  const flat = (v) => (Array.isArray(v) ? v.filter(Boolean).join('、') : (v ?? ''));
  return {
    as_of: now(),
    jobs: d.data.map((cells, i) => {
      const rec = Object.fromEntries(d.fields.map((c, j) => [c, cells[j]]));
      return {
        project_id: '', // 飞书源无 project_id（实证）→ 硬约束进 errors
        company: flat(rec['公司']), role: flat(rec['职位']) || '职位待定',
        city: flat(rec['地点']) || null, pipeline: flat(rec['还做吗']) || null,
        active_state: /无|待定/.test(flat(rec['还做吗'])) ? 'COOLING' : 'OPEN',
        relation: 'TEAM_SHARED', relation_note: flat(rec['主做']) || '团队池',
        source_url: `feishu://base/RR5NbWHEfacz4jsRYMocy1qAnSh?record=${d.record_id_list[i]}`,
      };
    }).filter((j) => j.company && j.company !== 'TTC'),
  };
}

const hashInput = (jobs) => {
  const h = createHash('sha256');
  const stable = jobs.map((j) => ({ ...j, raw_json: undefined }))
    .sort((a, b) => String(a.project_id).localeCompare(String(b.project_id)));
  h.update(JSON.stringify(stable));
  return h.digest('hex');
};

/**
 * 跑一次同步。返回 sync_runs 行。
 * 硬约束落实：缺 project_id / 缺客户或职位名 → 记 errors 且不入库。
 * payload：桥接器直接喂规范化职位（source='bridge'），跳过文件/CLI 读取。
 */
export function runSync(db, { source = 'fixture', consultant_id = 'felix', dry_run = false, payload = null } = {}) {
  const t0 = now();
  const { as_of, jobs } = payload ?? (source === 'feishu' ? fetchFeishuJobs() : loadFixture());
  const errors = [];
  const valid = [];
  const seen = new Set();
  for (const j of jobs) {
    if (!j.project_id) { errors.push(`缺 project_id：${j.company}/${j.role}`); continue; }
    if (!j.company || !j.role) { errors.push(`缺客户或职位名：${j.project_id}`); continue; }
    if (seen.has(j.project_id)) { errors.push(`输入内重复 project_id：${j.project_id}`); continue; }
    seen.add(j.project_id);
    valid.push(j);
  }
  const sync_id = uuid();
  const input_hash = hashInput(jobs);
  const complete = errors.length === 0 ? 1 : 0;

  if (dry_run) {
    return { sync_id: '(dry-run)', source, rows_expected: jobs.length, rows_read: valid.length,
             complete: !!complete, errors, input_hash, would_upsert: valid.length };
  }

  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO sync_runs
      (sync_id, consultant_id, source, as_of, rows_expected, rows_read, complete, errors, input_hash, started_at, completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(sync_id, consultant_id, source, as_of, jobs.length, valid.length, complete,
           JSON.stringify(errors), input_hash, t0, now());

    const upsert = db.prepare(`INSERT INTO job_facts
      (project_id, company, role, city, pipeline, hc, active_state, source_url, captured_at, sync_id, raw_json, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET
        company=excluded.company, role=excluded.role, city=excluded.city,
        pipeline=excluded.pipeline, hc=excluded.hc, active_state=excluded.active_state,
        source_url=excluded.source_url, captured_at=excluded.captured_at,
        sync_id=excluded.sync_id, raw_json=excluded.raw_json, updated_at=excluded.updated_at`);
    const upsertRel = db.prepare(`INSERT INTO job_memberships
      (consultant_id, project_id, relation, source, valid_from, valid_to)
      VALUES (?,?,?,?,?,NULL)
      ON CONFLICT(consultant_id, project_id, relation, valid_from) DO NOTHING`);
    const closeRel = db.prepare(`UPDATE job_memberships SET valid_to=?
      WHERE consultant_id=? AND project_id=? AND valid_to IS NULL AND relation != ?`);

    for (const j of valid) {
      upsert.run(j.project_id, j.company, j.role, j.city, j.pipeline, j.hc,
                 j.active_state, j.source_url, j.captured_at || as_of, sync_id,
                 JSON.stringify(j), now());
      if (j.relation) {
        closeRel.run(now(), consultant_id, j.project_id, j.relation); // 旧关系到期
        upsertRel.run(consultant_id, j.project_id, j.relation, source, j.captured_at || as_of);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { sync_id, consultant_id, source, as_of, rows_expected: jobs.length,
           rows_read: valid.length, complete: !!complete, errors, input_hash,
           started_at: t0, completed_at: now() };
}

/** 最近一条 complete=1 的快照（推荐只允许用它）。 */
export function latestCompleteSnapshot(db, consultant_id) {
  return db.prepare(`SELECT sync_id, as_of, source, rows_read, completed_at FROM sync_runs
    WHERE consultant_id=? AND complete=1 ORDER BY completed_at DESC LIMIT 1`).get(consultant_id);
}

/** 最近一次同步（无论完整与否，给首屏状态胶囊用）。 */
export function latestSync(db, consultant_id) {
  return db.prepare(`SELECT sync_id, as_of, source, rows_expected, rows_read, complete, errors, completed_at
    FROM sync_runs WHERE consultant_id=? ORDER BY started_at DESC LIMIT 1`).get(consultant_id);
}
