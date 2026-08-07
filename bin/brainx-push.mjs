#!/usr/bin/env node
/** braintex-local-push --consultant felix [--target oc_xxx] [--send]（默认只预览） */
import '../src/env.js';
import { openDb } from '../src/db.js';
import { latestSync, latestCompleteSnapshot } from '../src/sync.js';
import { latestRun, loadConsultants } from '../src/recommend.js';
import { commitmentSummary } from '../src/engagement.js';
import { buildDailyCard, buildSyncAlertCard, pushCard } from '../src/push.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const cid = arg('consultant', 'felix');
const db = openDb();
const sync = latestSync(db, cid);
const snapshot = latestCompleteSnapshot(db, cid);
const run = latestRun(db, cid);
const c = commitmentSummary(db, cid);
const name = loadConsultants(db).find((x) => x.consultant_id === cid)?.display_name || cid;
const kind = sync && !sync.complete ? 'SYNC_ALERT' : 'DAILY_TOP3';
const card = kind === 'SYNC_ALERT' ? buildSyncAlertCard(sync)
  : buildDailyCard({ consultant_name: name, run: run?.run, items: run?.items || [],
                     commitments: c, sync, snapshot_id: snapshot?.sync_id });
if (!process.argv.includes('--send')) {
  console.log(JSON.stringify(card, null, 2));
  console.error('（预览模式，加 --send 才真正发送）');
  process.exit(0);
}
const target = arg('target', process.env.BRAINX_PUSH_TARGET || '');
if (!target) { console.error('缺 --target（chat_id/open_id）'); process.exit(1); }
const out = pushCard(db, { consultant_id: cid, kind, run_id: run?.run?.run_id || null, card, target, send: true });
console.log(JSON.stringify(out, null, 2));
