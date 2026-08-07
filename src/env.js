/** env.js — 零依赖 .env 加载（node>=20.6 原生 process.loadEnvFile）。
 * 必须作为每个入口的第一个 import（副作用先于 oauth.js 等读取 env 的模块）。
 * .env 永不提交（.gitignore）；BRAINX_FEISHU_APP_SECRET 等敏感值只走这里。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = process.env.BRAINX_ENV_FILE || join(ROOT, '.env');
if (existsSync(p) && typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(p); } catch { /* 格式错误不致命，按未配置处理 */ }
}
