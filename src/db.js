/** db.js — SQLite 打开/迁移（补全文档 §13.1/§13.2）。零依赖：node:sqlite。 */
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

/** 迁移：migrations/*.sql 按文件名序应用，PRAGMA user_version 记录进度。 */
export function migrate(db) {
  const dir = join(ROOT, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const cur = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = cur; i < files.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(join(dir, files[i]), 'utf8'));
      db.exec(`PRAGMA user_version = ${i + 1}`);
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
