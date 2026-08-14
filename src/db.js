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

// ============================================================================
// 阿里云 RDS MySQL 连接（人才库 7 表：talent / tag / talent_tag / resume
// / position / match_record / user）
//
// 与上方 SQLite（brainx 决策主库）并存、互不干扰：
//   - SQLite（openDb）  = 项目原有决策库，同步 API，零依赖。
//   - MySQL（本段）     = 团队阿里云 RDS 人才库，异步 API，需 mysql2 依赖。
// 池懒加载——不调 getMysqlPool()/withMysql() 就不会连接，SQLite-only 入口
// （sync/recommend/replay 等命令行）不受影响，也不需要 MySQL 凭据。
// ============================================================================

/*
 * ⚠️ 接入前必须做的 5 件事（每件下面都有对应 TODO）：
 *
 * 1) 装依赖：本项目原本「零 npm 依赖」，但 Node 没有内置 MySQL 客户端
 *    （不像 SQLite 有 node:sqlite），所以必须装 mysql2——这是唯一新增依赖：
 *      npm install mysql2
 *    （package.json 已声明，跑一次上面的命令即可。）
 *
 * 2) 开白名单：阿里云 RDS 控制台 → 数据安全 → 白名单设置，
 *    把运行本机的【公网 IP】加进白名单（外网地址只对白名单内 IP 生效）。
 *    本机走【外网】：ttc-rds-public-0707.mysql.rds.aliyuncs.com:3306
 *    （内网地址 rm-bp12ok9so2ma3i3j7.mysql.rds.aliyuncs.com 只在 VPC 内可用，
 *     本机不在 VPC，必须走外网地址。）
 *
 * 3) 建库 + 建账号：在 RDS 上先建好目标库（如 brainx_talent），
 *    并建一个对该库有增删改查权限的账号。
 *
 * 4) 填凭据：把 .env.example 里的 MYSQL_ 段复制到 .env（.env 已在 .gitignore，
 *    永不提交），填真实账号/密码/库名。绝不把密码硬编码进本文件。
 *
 * 5) 建表：首次接通后跑一次 `await initTalentSchema()`（幂等，IF NOT EXISTS），
 *    或直接在 RDS 控制台/客户端执行下方 TALENT_DDL 里的 7 条建表语句。
 */
import mysql from 'mysql2/promise'; // TODO 依赖：npm install mysql2（见上「1) 装依赖」）

// ---- 连接配置：全部走 env（与 BRAINX_FEISHU_APP_SECRET 同一纪律：只走 .env）----
// 外网地址默认值写死，方便只填账号/密码/库名就能连；其余用 env 覆盖。
export const MYSQL_CONFIG = {
  host: process.env.BRAINX_MYSQL_HOST || 'ttc-rds-public-0707.mysql.rds.aliyuncs.com', // 外网地址
  port: Number(process.env.BRAINX_MYSQL_PORT) || 3306,
  user: process.env.BRAINX_MYSQL_USER || '',         // TODO .env 填 RDS 账号
  password: process.env.BRAINX_MYSQL_PASSWORD || '', // TODO .env 填 RDS 密码
  database: process.env.BRAINX_MYSQL_DATABASE || '', // TODO .env 填库名（如 brainx_talent）
  charset: process.env.BRAINX_MYSQL_CHARSET || 'utf8mb4',
  // 连接池（Druid 等价：connectionLimit≈maxActive，waitForConnections+queueLimit≈排队策略）
  waitForConnections: true,
  connectionLimit: Number(process.env.BRAINX_MYSQL_POOL_SIZE) || 10,
  queueLimit: 0,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  // TODO 安全（推荐开）：外网连 RDS 建议走 SSL。阿里云 RDS 下载 CA 后改成：
  //   ssl: { rejectUnauthorized: true, ca: readFileSync('/path/aliyun-rds-ca.pem') }
  // 默认不开（与 Java demo 一致），先确认链路通再加。
  ssl: process.env.BRAINX_MYSQL_SSL === '1' ? {} : undefined,
};

let _pool = null;

/** 懒加载连接池。未配置凭据时抛错（而非静默失败），但不影响 import。 */
export function getMysqlPool() {
  if (!_pool) {
    if (!MYSQL_CONFIG.user || !MYSQL_CONFIG.database) {
      throw new Error(
        'MySQL 未配置：请在 .env 设置 BRAINX_MYSQL_USER / BRAINX_MYSQL_PASSWORD / BRAINX_MYSQL_DATABASE',
      );
    }
    _pool = mysql.createPool(MYSQL_CONFIG);
  }
  return _pool;
}

/** 取一条连接跑 fn，结束自动还池（等价 Java demo 的 try-with-resources + getConnection）。 */
export async function withMysql(fn) {
  const pool = getMysqlPool();
  const conn = await pool.getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

/** 连通性自检：接通后跑一次确认白名单/凭据/网络都对（等价 Java demo 的 main 里先 select）。 */
export async function pingMysql() {
  return withMysql((conn) => conn.query('SELECT 1 AS ok'));
}

/** 关闭连接池（进程退出 / 测试清理用）。 */
export async function closeMysql() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

// ---- 建表：7 张表，幂等（IF NOT EXISTS）。等价 Java demo 的 createTable()。----
// 外键依赖顺序：user → talent → tag → talent_tag / resume → position → match_record。
export async function initTalentSchema() {
  return withMysql(async (conn) => {
    for (const ddl of TALENT_DDL) {
      await conn.execute(ddl);
    }
    return TALENT_DDL.length;
  });
}

// 7 张表 DDL（与你的设计一一对应；改字段就改这里）。
const TALENT_DDL = [
  // 1) 用户表
  `CREATE TABLE IF NOT EXISTS \`user\` (
    \`id\` bigint(20) NOT NULL AUTO_INCREMENT,
    \`username\` varchar(50) NOT NULL COMMENT '用户名',
    \`password_hash\` varchar(255) NOT NULL COMMENT '密码哈希',
    \`email\` varchar(100) NOT NULL COMMENT '邮箱',
    \`role\` varchar(20) DEFAULT 'hr' COMMENT '角色: admin, hr, manager',
    \`created_at\` datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uk_username\` (\`username\`),
    UNIQUE KEY \`uk_email\` (\`email\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表'`,

  // 2) 人才主表
  `CREATE TABLE IF NOT EXISTS \`talent\` (
    \`id\` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '人才ID',
    \`name\` varchar(100) NOT NULL COMMENT '姓名',
    \`phone\` varchar(20) DEFAULT NULL COMMENT '手机号',
    \`email\` varchar(100) DEFAULT NULL COMMENT '邮箱',
    \`status\` varchar(20) DEFAULT 'active' COMMENT '状态: active-活跃, contacted-已联系, hired-已入职',
    \`last_active_time\` datetime DEFAULT NULL COMMENT '最后活跃时间',
    \`summary\` text COMMENT '人才简介（可由AI生成）',
    \`created_by\` bigint(20) DEFAULT NULL COMMENT '创建人ID (关联user表)',
    \`created_at\` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    \`updated_at\` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (\`id\`),
    KEY \`idx_status\` (\`status\`),
    KEY \`idx_last_active\` (\`last_active_time\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='人才主表'`,

  // 3) 标签字典表
  `CREATE TABLE IF NOT EXISTS \`tag\` (
    \`id\` bigint(20) NOT NULL AUTO_INCREMENT,
    \`name\` varchar(50) NOT NULL COMMENT '标签名称，如：Java, 5年经验',
    \`category\` varchar(20) DEFAULT NULL COMMENT '标签分类：skill-技能, edu-学历, intention-意向',
    \`created_at\` datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uk_name_category\` (\`name\`, \`category\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标签字典表'`,

  // 4) 人才与标签关联表（依赖 talent + tag）
  `CREATE TABLE IF NOT EXISTS \`talent_tag\` (
    \`id\` bigint(20) NOT NULL AUTO_INCREMENT,
    \`talent_id\` bigint(20) NOT NULL COMMENT '人才ID',
    \`tag_id\` bigint(20) NOT NULL COMMENT '标签ID',
    \`source\` varchar(20) DEFAULT 'auto' COMMENT '来源: auto-AI生成, manual-手动添加',
    \`created_at\` datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uk_talent_tag\` (\`talent_id\`, \`tag_id\`),
    KEY \`idx_tag_id\` (\`tag_id\`),
    CONSTRAINT \`fk_talent_tag_talent\` FOREIGN KEY (\`talent_id\`) REFERENCES \`talent\` (\`id\`) ON DELETE CASCADE,
    CONSTRAINT \`fk_talent_tag_tag\` FOREIGN KEY (\`tag_id\`) REFERENCES \`tag\` (\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='人才标签关联表'`,

  // 5) 人才简历表（依赖 talent）
  `CREATE TABLE IF NOT EXISTS \`resume\` (
    \`id\` bigint(20) NOT NULL AUTO_INCREMENT,
    \`talent_id\` bigint(20) NOT NULL COMMENT '所属人才ID',
    \`file_name\` varchar(255) NOT NULL COMMENT '原始文件名',
    \`file_path\` varchar(500) NOT NULL COMMENT '文件存储路径',
    \`parsed_content\` longtext COMMENT '解析后的文本内容，供AI分析',
    \`upload_time\` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
    PRIMARY KEY (\`id\`),
    KEY \`idx_talent_id\` (\`talent_id\`),
    CONSTRAINT \`fk_resume_talent\` FOREIGN KEY (\`talent_id\`) REFERENCES \`talent\` (\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='人才简历表'`,

  // 6) 岗位表
  `CREATE TABLE IF NOT EXISTS \`position\` (
    \`id\` bigint(20) NOT NULL AUTO_INCREMENT,
    \`title\` varchar(200) NOT NULL COMMENT '岗位名称',
    \`description\` text COMMENT '岗位描述',
    \`requirements\` text COMMENT '岗位要求',
    \`created_at\` datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='岗位表'`,

  // 7) 人才岗位匹配记录表（依赖 talent + position）
  `CREATE TABLE IF NOT EXISTS \`match_record\` (
    \`id\` bigint(20) NOT NULL AUTO_INCREMENT,
    \`talent_id\` bigint(20) NOT NULL,
    \`position_id\` bigint(20) NOT NULL,
    \`score\` float DEFAULT NULL COMMENT '匹配分数，如 0.85',
    \`match_detail\` json DEFAULT NULL COMMENT '匹配详情，JSON格式存储各维度得分',
    \`created_at\` datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`idx_talent_position\` (\`talent_id\`, \`position_id\`),
    CONSTRAINT \`fk_match_talent\` FOREIGN KEY (\`talent_id\`) REFERENCES \`talent\` (\`id\`) ON DELETE CASCADE,
    CONSTRAINT \`fk_match_position\` FOREIGN KEY (\`position_id\`) REFERENCES \`position\` (\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='人才岗位匹配记录表'`,
];

// ---- 示例 CRUD（对应 Java demo 的 insert/select；其余表同 withMysql 套路）----
// 插入一条人才，返回新 id。
export async function insertTalent({ name, phone, email, status, summary, createdBy }) {
  return withMysql(async (conn) => {
    const [res] = await conn.execute(
      `INSERT INTO talent (name, phone, email, status, summary, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, phone ?? null, email ?? null, status ?? 'active', summary ?? null, createdBy ?? null],
    );
    return res.insertId;
  });
}

// 按 id 查人才。
export async function findTalentById(id) {
  return withMysql(async (conn) => {
    const [rows] = await conn.execute(`SELECT * FROM talent WHERE id = ?`, [id]);
    return rows[0] ?? null;
  });
}

// 列出人才（分页），按最后活跃时间倒序。
export async function listTalents({ limit = 20, offset = 0 } = {}) {
  return withMysql(async (conn) => {
    const [rows] = await conn.execute(
      `SELECT * FROM talent ORDER BY last_active_time DESC, id DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    return rows;
  });
}
