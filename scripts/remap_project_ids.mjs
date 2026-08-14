#!/usr/bin/env node
/** remap_project_ids.mjs — P-FIX 占位 ID → TTC 真 project_id 一次性重映射（2026-08-14）。
 *
 * 用法：
 *   node scripts/remap_project_ids.mjs            # dry-run：只打印映射计划，不写库
 *   node scripts/remap_project_ids.mjs --apply    # 正式执行（事务 + FK 临时关闭）
 *
 * 匹配纪律（宁缺毋滥）：
 *   - 公司名规范化（去 有限公司/括号内容/空白，小写）后双向包含即候选；
 *   - 同公司多职位行时要求角色名也互相包含，否则判「歧义」不动；
 *   - 一对多/多对多 → 不动，进报告人工处理。
 * 执行面：job_facts 主键替换，引用同步更新（job_memberships / recommendations /
 * decision_events / job_outcomes / job_messages.matched_project_id），
 * 旧 P-FIX 行删除（事实以 TTC 行为准——更新更频、字段更全）。
 */
import { openDb } from '../src/db.js';

export const normalizeCompany = (s) => String(s || '')
  .toLowerCase()
  .replace(/（[^）]*）|\([^)]*\)/g, '')
  .replace(/有限责任公司|股份有限公司|有限公司/g, '')
  .replace(/[\s·・-]/g, '');

/** 纯函数：给旧行与新行集合，产出 { 确定映射, 歧义, 无匹配 }。 */
export function planRemap(oldRows, newRows) {
  const confident = [], ambiguous = [], unmatched = [];
  const newByNorm = new Map();
  for (const n of newRows) {
    const k = normalizeCompany(n.company);
    if (!k) continue;
    if (!newByNorm.has(k)) newByNorm.set(k, []);
    newByNorm.get(k).push(n);
  }
  for (const o of oldRows) {
    const k = normalizeCompany(o.company);
    const candidates = new Map(); // newId → newRow
    for (const [nk, rows] of newByNorm) {
      if (k && nk && (k.includes(nk) || nk.includes(k))) {
        for (const r of rows) candidates.set(r.project_id, r);
      }
    }
    if (candidates.size === 0) { unmatched.push(o); continue; }
    if (candidates.size === 1) { confident.push({ from: o.project_id, to: [...candidates.keys()][0], company: o.company }); continue; }
    // 多候选：用角色名收窄
    const roleHit = [...candidates.values()].filter((r) => {
      const a = String(o.role || ''), b = String(r.role || '');
      return a && b && (a.includes(b) || b.includes(a));
    });
    if (roleHit.length === 1) confident.push({ from: o.project_id, to: roleHit[0].project_id, company: o.company, via: 'role' });
    else ambiguous.push({ from: o.project_id, company: o.company, role: o.role, candidates: [...candidates.keys()] });
  }
  return { confident, ambiguous, unmatched };
}

/** 执行一组映射（单事务；FK 临时关闭）。返回实际执行的条数。 */
export function applyRemap(db, pairs) {
  db.exec('PRAGMA foreign_keys = OFF');
  const upd = (table, col) => db.prepare(`UPDATE ${table} SET ${col}=? WHERE ${col}=?`);
  const stmts = [
    upd('job_memberships', 'project_id'), upd('recommendations', 'project_id'),
    upd('decision_events', 'project_id'), upd('job_outcomes', 'project_id'),
    upd('job_messages', 'matched_project_id'),
  ];
  const delFact = db.prepare('DELETE FROM job_facts WHERE project_id=?');
  let done = 0;
  db.exec('BEGIN');
  try {
    for (const { from, to } of pairs) {
      for (const st of stmts) st.run(to, from);
      delFact.run(from); // 旧占位行删除（真 ID 行已存在且字段更全）
      done++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { db.exec('PRAGMA foreign_keys = ON'); }
  return done;
}

if (process.argv[1] && process.argv[1].endsWith('remap_project_ids.mjs')) {
  const apply = process.argv.includes('--apply');
  const db = openDb(process.env.BRAINX_DB || 'data/brainx.db');
  const oldRows = db.prepare(`SELECT project_id, company, role FROM job_facts WHERE project_id LIKE 'P-FIX-%'`).all();
  const newRows = db.prepare(`SELECT project_id, company, role FROM job_facts WHERE project_id NOT LIKE 'P-FIX-%'`).all();
  const { confident, ambiguous, unmatched } = planRemap(oldRows, newRows);
  console.log(`旧占位行 ${oldRows.length} · 真 ID 行 ${newRows.length}`);
  console.log(`确定映射 ${confident.length} · 歧义 ${ambiguous.length} · 无匹配 ${unmatched.length}`);
  for (const c of confident) console.log(`  ✓ ${c.from} → ${c.to}（${c.company}${c.via ? '，角色收窄' : ''}）`);
  for (const a of ambiguous.slice(0, 10)) console.log(`  ? 歧义 ${a.from}（${a.company}/${a.role}）候选: ${a.candidates.join(',')}`);
  if (apply && confident.length) {
    const n = applyRemap(db, confident);
    console.log(`已执行 ${n} 条重映射（事务提交）`);
  } else if (!apply) {
    console.log('（dry-run，加 --apply 执行）');
  }
  db.close();
}
