#!/usr/bin/env node
/** braintex-local-adapter --source ttc,cockpit --consultant felix [--dry-run] [--market-csv <path>] [--cockpit-csv <path>]
 *
 * PRD 1.2 LLM Adapter：读两份原始 CSV -> 标准库格式 -> 落 SQLite（job_facts +
 * cockpit_facts + job_classifications + job_occupancy）。--dry-run 只打印 JSON 不落库。
 */
import '../src/env.js';
import { openDb } from '../src/db.js';
import { runAdapter } from '../src/adapter.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(`--${k}`);

const db = openDb();
const out = await runAdapter(db, {
  consultant_id: arg('consultant', 'felix'),
  dry_run: has('dry-run'),
  marketCsv: arg('market-csv', undefined),
  cockpitCsv: arg('cockpit-csv', undefined),
});

if (has('dry-run')) {
  // dry-run 直接把标准化结果打到 stdout，便于肉眼校验字段格式
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(JSON.stringify(out, null, 2));
  console.error(out.complete
    ? `✅ 适配完成：市场 ${out.rows.market} + 驾驶舱 ${out.rows.cockpit} -> ${out.rows.jobs} 个职位（LLM ${out.llm}）`
    : `⚠️ 不完整：${out.errors.length} 条错误`);
}
