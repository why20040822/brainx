/** db.js — SQLite 打开/迁移（补全文档 §13.1/§13.2）。零依赖：node:sqlite。
 *
 * 迁移记账（2026-08-10 框架修正）：schema_migrations 表按【文件名】记账，
 * 取代修正前的纯位置 PRAGMA user_version（按序数跳文件——中间插入新迁移文件
 * 就会错位/重复执行）。user_version 仍同步维护，仅供旧探测代码兼容。
 * 旧库兼容：无 schema_migrations 且 user_version=N → 前 N 个文件标记为已应用，
 * 只补执行其后新增的文件。
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedRoster } from './roster.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.BRAINX_DB || join(ROOT, 'data', 'brainx.db');

export function openDb(dbPath = DB_PATH) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  seedRoster(db); // 幂等：花名册种子只在空位补种
  return db;
}

/** 迁移：migrations/*.sql 按文件名序应用；schema_migrations 逐文件记账。 */
export function migrate(db) {
  const dir = join(ROOT, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);

  // 旧库回填：user_version=N 代表前 N 个文件已按位置应用过
  let applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  if (applied.size === 0) {
    const cur = db.prepare('PRAGMA user_version').get().user_version;
    if (cur > 0) {
      const mark = db.prepare('INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?,?)');
      db.exec('BEGIN');
      try {
        for (let i = 0; i < Math.min(cur, files.length); i++) mark.run(files[i], now());
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
    }
  }

  const mark = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?,?)');
  for (let i = 0; i < files.length; i++) {
    if (applied.has(files[i])) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(join(dir, files[i]), 'utf8'));
      mark.run(files[i], now());
      db.exec(`PRAGMA user_version = ${i + 1}`); // 兼容旧探测（不代表逐文件真值）
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${files[i]} failed: ${e.message}`);
    }
  }
  return files.length;
}

export const now = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
