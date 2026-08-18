/** data-quality.test.mjs — P2 主线数据质量安全闸回归。
 *
 * 锁定「脏数据不得产出推荐」的核心纪律：
 *  ① 无任何完整快照 → recommend blocked（不落推荐）
 *  ② 最近一次同步 complete=0（不完整）→ recommend blocked
 *  ③ 同输入重复同步 → input_hash 一致（可判定「无变化」，支撑增量/幂等）
 *  ④ 重复同步不新增 job_facts（project_id 唯一 UPSERT）
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { runSync } from '../src/sync.js';
import { recommend } from '../src/recommend.js';

const CID = 'felix';
let db;
beforeEach(() => { db = openDb(':memory:'); });

test('安全闸：无完整快照时 recommend 被 blocked、不落推荐', () => {
  const r = recommend(db, CID, { dry_run: true });
  assert.equal(r.blocked, true, '没同步过应 blocked');
  assert.equal(r.items.length, 0);
  assert.equal(r.run_id, null);
});

test('安全闸：不完整同步(complete=0)时 recommend 被 blocked', () => {
  // 用一条缺 company/role 的脏职位制造 errors → complete=0
  const dirty = [{ project_id: 'P-DIRTY', company: '', role: '', active_state: 'OPEN' }];
  const out = runSync(db, { source: 'bridge', consultant_id: CID, payload: { as_of: '2026-08-18', jobs: dirty } });
  assert.equal(out.complete, false, '脏数据应判定 complete=0');
  const r = recommend(db, CID, { dry_run: true });
  assert.equal(r.blocked, true, '不完整同步后应 blocked');
});

test('幂等：同输入重复同步 → input_hash 一致', () => {
  const a = runSync(db, { source: 'fixture', consultant_id: CID });
  const b = runSync(db, { source: 'fixture', consultant_id: CID });
  assert.equal(a.input_hash, b.input_hash, '同一 fixture 两次同步 input_hash 应一致');
  assert.ok(a.complete && b.complete);
});

test('去重：重复同步不新增 job_facts（project_id 唯一 UPSERT）', () => {
  runSync(db, { source: 'fixture', consultant_id: CID });
  const n1 = db.prepare('SELECT COUNT(*) n FROM job_facts').get().n;
  runSync(db, { source: 'fixture', consultant_id: CID });
  const n2 = db.prepare('SELECT COUNT(*) n FROM job_facts').get().n;
  assert.equal(n1, n2, '重复同步职位数不变');
  assert.ok(n1 > 0);
});

test('完整同步后 recommend 能产出（安全闸放行）', () => {
  runSync(db, { source: 'fixture', consultant_id: CID });
  const r = recommend(db, CID, { dry_run: true });
  assert.equal(r.blocked ?? false, false, '完整快照后应放行');
  assert.ok(Array.isArray(r.items));
});
