#!/usr/bin/env node
/** braintex-local-recommend --consultant felix [--top 10] [--dry-run] */
import '../src/env.js';
import { openDb } from '../src/db.js';
import { recommend } from '../src/recommend.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const db = openDb();
const out = recommend(db, arg('consultant', 'felix'),
  { top: Number(arg('top', 10)), dry_run: process.argv.includes('--dry-run') });
if (out.blocked) { console.error(`⛔ ${out.reason}`); process.exit(2); }
for (const r of out.items) {
  console.log(`#${r.rank} ${r.job.role} @ ${r.job.company}  ${r.score}分 [${r.action}/${r.confidence_band}/覆盖${Math.round(r.evidence_coverage * 100)}%]`);
  console.log(`   理由: ${r.reasons.slice(0, 2).join('；')}`);
  if (r.risks[0]) console.log(`   风险: ${r.risks[0]}`);
}
console.error(`\nrun_id=${out.run_id} snapshot=${out.snapshot_id} policy=${out.policy_version} 候选${out.input_stats.candidates}→过滤后${out.input_stats.after_hard_filter}`);
