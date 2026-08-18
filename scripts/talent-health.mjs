#!/usr/bin/env node
/** talent-health.mjs — 人才库连接自检（不建表，只报状态）。
 *
 * 用法：node scripts/talent-health.mjs   （或 npm run talent:health）
 * 作用：读 .env 的 BRAINX_MYSQL_* 凭据，尝试连阿里云 RDS，打印后端类型 + 连通性
 *       + 建表状态。凭据只回显 host/库名，绝不打印密码。
 *
 * 三种典型结果：
 *   1) 未填凭据      → backend=memory（当前走内存回退，功能可用但不落真库）
 *   2) 填了但连不通  → backend=memory + degraded=MYSQL_UNREACHABLE（多为白名单没加/网络）
 *   3) 连通          → backend=mysql + schema=ready（已切到真库，7 张表就绪）
 */
import '../src/env.js';
import { talentHealth } from '../src/talent.js';

const h = await talentHealth();
console.log(JSON.stringify(h, null, 2));

if (h.backend === 'mysql' && h.schema === 'ready') {
  console.log('\n[OK] 已连接真实 RDS 人才库，7 张表就绪，人才库读写将落真库。');
  process.exitCode = 0;
} else if (h.config.credentials_present) {
  console.log('\n[WARN] 已填凭据但未连通/表未就绪：');
  console.log('  - 把运行本机的【公网 IP】加进阿里云 RDS 白名单（外网地址只对白名单内 IP 生效）');
  console.log('  - 确认账号/密码/库名正确，且账号对该库有建表(DDL)与增删改查权限');
  console.log('  - 外网连库建议开 SSL：.env 设 BRAINX_MYSQL_SSL=1');
  process.exitCode = 1;
} else {
  console.log('\n[INFO] 未填凭据，当前使用内存库（功能可用，数据不落真库）。');
  console.log('  在 .env 填 BRAINX_MYSQL_USER / BRAINX_MYSQL_PASSWORD / BRAINX_MYSQL_DATABASE 后重跑本脚本。');
  process.exitCode = 0;
}

// 显式收尾：MySQL 连接池的 keepAlive 定时器会让事件循环不空、进程挂起。
// 关掉连接池后主动退出，避免 `npm run talent:health` 每次都要等到超时才结束。
try {
  const db = await import('../src/db.js');
  if (typeof db.closeMysql === 'function') await db.closeMysql();
} catch { /* 内存回退时无 db 连接池，忽略 */ }
process.exit(process.exitCode ?? 0);
