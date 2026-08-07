#!/usr/bin/env node
/** braintex-local-sync --source fixture|feishu --consultant felix [--dry-run] */
import '../src/env.js';
import { openDb } from '../src/db.js';
import { runSync } from '../src/sync.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const db = openDb();
const out = runSync(db, {
  source: arg('source', 'fixture'),
  consultant_id: arg('consultant', 'felix'),
  dry_run: process.argv.includes('--dry-run'),
});
console.log(JSON.stringify(out, null, 2));
console.error(out.complete ? `✅ 同步完整：${out.rows_read}/${out.rows_expected}`
                           : `⚠️ 不完整：${out.errors.length} 条错误（complete=0，正式推荐被阻断）`);
