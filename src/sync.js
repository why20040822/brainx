/** sync.js — 同步批次 + project_id 去重 + 关系落位（补全文档 §13.4、PRD §4）。
 *
 * source=fixture：读 fixtures/ttc_jobs_felix.json（真实导出衍生）。
 * source=feishu：经 lark-cli 直读职位盘点 Bitable（L2 源，无 project_id →
 *   按硬约束进 errors，不落 job_facts——架构后果见补全文档 §17.2）。
 * 重复同步：job_facts UPSERT（project_id PRIMARY KEY），行数不增。
 *
 * 2026-08-10 框架修正（事实/关系分离纪律统一）：
 *   - fixture 是 Felix 个人策展导出（文件名即属主）：只有 consultant_id 属主本人
 *     同步时才写关系行——修正前 mia/york 跑 fixture 同步会把 Felix 的 MY_JOB
 *     继承成自己的关系（数据污染）；
 *   - fetchFeishuJobs 改为 relation=null（与 bridge 同一纪律）——修正前它给每个
 *     同步者写 TEAM_SHARED，会把该顾问既有策展关系（MY_JOB/PRIMARY_PM）到期冲掉；
 *   - captured_at 只在事实字段（公司/职位/城市/pipeline/HC/状态）变化时前进——
 *     修正前每轮桥接 UPSERT 都回刷 captured_at，scorer 新鲜度维度恒为满分、失去意义。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { now, uuid } from './db.js';
import { BITABLE_BASE, BITABLE_TABLE, flatLark, parseBitableRecord } from './bitable.js';
import { larkProfileArgs } from './env.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** fixture 属主：Felix 个人策展导出。关系行只许属主本人同步时落位。 */
export const FIXTURE_OWNER = 'felix';

export function loadFixture() {
  const f = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'ttc_jobs_felix.json'), 'utf8'));
  return { as_of: f.exported_at, jobs: f.jobs, consultant_owner: f.consultant_id || FIXTURE_OWNER };
}

/** lark-cli 读职位盘点 Bitable（L2 飞书源实测通道）。
 * 解析层 = src/bitable.js（与 bridge 同一权威）：公司×单职能展开、priority 结构化、
 * relation=null（事实/关系分离——防止 TEAM_SHARED 把同步者既有策展关系冲掉）。 */
export function fetchFeishuJobs() {
  const out = execFileSync('lark-cli', [
    ...larkProfileArgs(),
    'base', '+record-list', '--base-token', BITABLE_BASE,
    '--table-id', BITABLE_TABLE, '--page-size', '100', '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const d = JSON.parse(out.slice(out.indexOf('{'))).data;
  return {
    as_of: now(),
    jobs: d.data.flatMap((cells, i) => {
      const rec = Object.fromEntries(d.fields.map((c, j) => [c, cells[j]]));
      return parseBitableRecord(rec, d.record_id_list[i], flatLark);
    }),
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
 * 关系落位守卫：payload 声明了 consultant_owner 时，只有属主本人同步才写关系行。
 */
export function runSync(db, { source = 'fixture', consultant_id = 'felix', dry_run = false, payload = null } = {}) {
  const t0 = now();
  const loaded = payload ?? (source === 'feishu' ? fetchFeishuJobs() : loadFixture());
  const { as_of, jobs } = loaded;
  const writeRels = !loaded.consultant_owner || loaded.consultant_owner === consultant_id;
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

    // captured_at 语义 = 「事实最后变化时间」，不是「最后同步时间」：
    // 九个事实字段任一变化（IS NOT = null 安全不等）才前进，否则保留原值。
    const upsert = db.prepare(`INSERT INTO job_facts
      (project_id, company, role, city, pipeline, hc, active_state, priority, notes, company_type, source_url, captured_at, sync_id, raw_json, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET
        company=excluded.company, role=excluded.role, city=excluded.city,
        pipeline=excluded.pipeline, hc=excluded.hc, active_state=excluded.active_state,
        priority=excluded.priority, notes=excluded.notes, company_type=excluded.company_type,
        source_url=excluded.source_url,
        captured_at=CASE WHEN
            job_facts.company      IS NOT excluded.company      OR
            job_facts.role         IS NOT excluded.role         OR
            job_facts.city         IS NOT excluded.city         OR
            job_facts.pipeline     IS NOT excluded.pipeline     OR
            job_facts.hc           IS NOT excluded.hc           OR
            job_facts.active_state IS NOT excluded.active_state OR
            job_facts.priority     IS NOT excluded.priority     OR
            job_facts.notes        IS NOT excluded.notes        OR
            job_facts.company_type IS NOT excluded.company_type
          THEN excluded.captured_at ELSE job_facts.captured_at END,
        sync_id=excluded.sync_id, raw_json=excluded.raw_json, updated_at=excluded.updated_at`);
    const upsertRel = db.prepare(`INSERT INTO job_memberships
      (consultant_id, project_id, relation, source, valid_from, valid_to)
      VALUES (?,?,?,?,?,NULL)
      ON CONFLICT(consultant_id, project_id, relation, valid_from) DO NOTHING`);
    const closeRel = db.prepare(`UPDATE job_memberships SET valid_to=?
      WHERE consultant_id=? AND project_id=? AND valid_to IS NULL AND relation != ?`);

    for (const j of valid) {
      upsert.run(j.project_id, j.company, j.role, j.city, j.pipeline, j.hc,
                 j.active_state, j.priority ?? null, j.notes ?? null, j.company_type ?? null,
                 j.source_url, j.captured_at || as_of, sync_id,
                 JSON.stringify(j), now());
      if (j.relation && writeRels) {
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
