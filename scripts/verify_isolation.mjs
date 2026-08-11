#!/usr/bin/env node
/** verify_isolation.mjs — 按人隔离与激活状态体检（只读，不写任何数据）。
 *
 * 用途：云端登录鉴权链路激活后，逐个顾问核对：
 *   1. 档案（方向关键词是否已填）；
 *   2. 飞书令牌（OAuth 重登后 authorized=true）；
 *   3. 群成员缓存（桥接每轮刷新；0 = 未激活或令牌失效）；
 *   4. 消息可见性（本人令牌读到的群消息数；与群成员身份强绑定）；
 *   5. 快照/推荐（complete 快照存在 + 最新一轮推荐条数）。
 *
 * 用法：node scripts/verify_isolation.mjs [--db /opt/brainx/data/brainx.db]
 * 云端：ssh root@47.110.93.137 'cd /opt/brainx && node scripts/verify_isolation.mjs'
 */
import '../src/env.js';
import { openDb } from '../src/db.js';
import { listConsultants } from '../src/roster.js';
import { tokenStatus } from '../src/feishu.js';
import { latestCompleteSnapshot, latestSync } from '../src/sync.js';
import { latestRun } from '../src/recommend.js';

const argi = process.argv.indexOf('--db');
const db = openDb(argi > -1 ? process.argv[argi + 1] : undefined);

console.log('Brain X · 按人隔离与激活体检（只读）\n');
let allOk = true;
for (const c of listConsultants(db)) {
  const cid = c.consultant_id;
  const tok = tokenStatus(db, cid);
  const chats = db.prepare('SELECT COUNT(*) n FROM consultant_chats WHERE consultant_id=?').get(cid).n;
  const msgs = db.prepare('SELECT COUNT(*) n FROM job_message_visibility WHERE consultant_id=?').get(cid).n;
  const snap = latestCompleteSnapshot(db, cid);
  const last = latestSync(db, cid);
  const run = latestRun(db, cid);
  const kws = c.profile_keywords || [];

  const checks = [
    ['档案', kws.length > 0, `${kws.length} 个方向词${kws.length ? '（' + kws.slice(0, 4).join('/') + '…）' : '——空档案，direction 维度恒 0，请在工作台「完善方向档案」'}`],
    ['令牌', tok.authorized && !tok.needs_reauth, tok.authorized ? (tok.needs_reauth ? '需重登' : '有效') : '未授权——打开工作台重登一次'],
    ['群缓存', chats > 0, `${chats} 个群`],
    ['消息可见', true, `${msgs} 条（0 = 尚未按人拉取，重登后下轮桥接恢复）`],
    ['快照', !!snap, snap ? `complete 快照 ${String(snap.completed_at || '').slice(0, 16)}` : '无完整快照'],
    ['最近同步', !!last?.complete, last ? (last.complete ? '完整' : '不完整（推荐阻断中）') : '从未同步'],
    ['推荐', !!run, run ? `${run.items.length} 条 · ${run.run.created_at.slice(0, 16)}` : '尚无推荐轮次'],
  ];
  console.log(`■ ${c.display_name}（${cid}）`);
  for (const [name, ok, detail] of checks) {
    if (!ok) allOk = false;
    console.log(`  ${ok ? '✅' : '⚠️ '} ${name}: ${detail}`);
  }
  console.log();
}
console.log(allOk ? '全部就绪。' : '存在待办项（见 ⚠️）。');
