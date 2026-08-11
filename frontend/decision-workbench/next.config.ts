import type { NextConfig } from 'next';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 仓库内并存多套前端（public/ 零依赖生产界面 + 本原型），锁文件在各自目录：
// 显式声明 turbopack root，避免 Next 误把仓库根的 package-lock.json 当工作区根。
const config: NextConfig = {
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};
export default config;
