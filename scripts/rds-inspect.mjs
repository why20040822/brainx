import 'dotenv/config';
import mysql from 'mysql2/promise';
const conn = await mysql.createConnection({
  host: process.env.BRAINX_MYSQL_HOST, port: Number(process.env.BRAINX_MYSQL_PORT)||3306,
  user: process.env.BRAINX_MYSQL_USER, password: process.env.BRAINX_MYSQL_PASSWORD,
  database: process.env.BRAINX_MYSQL_DATABASE, connectTimeout: 8000,
});
const tables = ['user','talent','tag','talent_tag','resume','position','match_record'];
for (const t of tables) {
  const [[{ c }]] = await conn.query(`SELECT COUNT(*) c FROM \`${t}\``);
  const [cols] = await conn.query(`SHOW COLUMNS FROM \`${t}\``);
  console.log(`\n【${t}】行数=${c}  字段=${cols.length}`);
  console.log('  ', cols.map((x) => x.Field).join(', '));
}
await conn.end();
process.exit(0);
