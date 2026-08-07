#!/usr/bin/env node
/** braintex-local-replay --run-id <run_id> | --decision-id <decision_id> */
import '../src/env.js';
import { openDb } from '../src/db.js';
import { replay } from '../src/replay.js';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : null; };
const db = openDb();
let decisionId = arg('decision-id');
if (!decisionId && arg('run-id')) {
  const r = db.prepare('SELECT decision_id FROM recommendations WHERE run_id=? ORDER BY rank LIMIT 1')
    .get(arg('run-id'));
  decisionId = r?.decision_id;
}
if (!decisionId) { console.error('用法: brainx-replay --run-id <id> | --decision-id <id>'); process.exit(1); }
const out = replay(db, decisionId);
if (!out) { console.error('决策不存在'); process.exit(1); }
console.log(JSON.stringify(out, null, 2));
