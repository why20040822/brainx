#!/usr/bin/env node
/** init-talent-schema.mjs - 在阿里云 RDS MySQL 上建人才库 7 张表（幂等，IF NOT EXISTS）。
 *
 * 用法：node scripts/init-talent-schema.mjs   （或 npm run init-talent）
 * 前置：
 *   1) npm install mysql2
 *   2) .env 填 BRAINX_MYSQL_USER / BRAINX_MYSQL_PASSWORD / BRAINX_MYSQL_DATABASE
 *   3) 本机公网 IP 加进阿里云 RDS 白名单（外网地址才生效）
 * 建的 7 张表：user / talent / tag / talent_tag / resume / position / match_record
 * （DDL 在 src/db.js 的 TALENT_DDL，外键依赖顺序已排好）。
 */
import '../src/env.js'; // 先加载 .env（副作用：填充 process.env，db.js 读凭据靠它）

let db;
try {
  db = await import('../src/db.js');
  await db.pingMysql();
  console.log('[OK] MySQL 连通');
  const n = await db.initTalentSchema();
  console.log(`[OK] 建表完成，共 ${n} 张表已就绪（幂等，可重复跑）`);
} catch (e) {
  console.error('[FAIL] 建表失败：', e.message);
  console.error('  检查：npm install mysql2 装了没 / .env 凭据填了没 / 公网 IP 加白名单没');
  process.exitCode = 1;
} finally {
  if (db) await db.closeMysql().catch(() => {});
}
