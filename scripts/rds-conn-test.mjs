// 最小 RDS 连接测试：硬超时 12s，直接暴露真实错误（不走内存回退）。
import 'dotenv/config';
import mysql from 'mysql2/promise';

const cfg = {
  host: process.env.BRAINX_MYSQL_HOST,
  port: Number(process.env.BRAINX_MYSQL_PORT) || 3306,
  user: process.env.BRAINX_MYSQL_USER,
  password: process.env.BRAINX_MYSQL_PASSWORD,
  database: process.env.BRAINX_MYSQL_DATABASE,
  connectTimeout: 8000,
};
console.log('连接目标:', `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);

const killer = setTimeout(() => { console.error('❌ 12s 硬超时——连接被网络层丢弃（公网不通/端口封锁/白名单）'); process.exit(3); }, 12000);

try {
  const conn = await mysql.createConnection(cfg);
  const [r] = await conn.query('SELECT VERSION() AS v, DATABASE() AS db, CURRENT_USER() AS u');
  console.log('✅ 连通:', r[0]);
  const [tables] = await conn.query('SHOW TABLES');
  console.log('库内现有表数:', tables.length);
  console.log('表名:', tables.map((t) => Object.values(t)[0]).join(', ') || '(空库)');
  await conn.end();
  clearTimeout(killer);
  process.exit(0);
} catch (e) {
  clearTimeout(killer);
  console.error('❌ 连接失败:', e.code || '', e.message);
  process.exit(1);
}
