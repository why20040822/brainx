# BrainX 部署编排（Deployment）

## 架构拓扑（为什么是单容器）

BrainX 是**后端反向代理前端**的一体化服务，单一对外入口 `:3000`：

```
浏览器 :3000 ──▶ src/server.js (node:http)
                  ├─ /api/v1/*  自己处理（SQLite / 可选 MySQL）
                  └─ 其它路径    反向代理到前端 :4321
                                    │ spawn: npm run start
                                    ▼
                                 vinext 前端 :4321
```

因为后端会 `spawn` 前端子进程并代理，**不需要 docker-compose 多容器**，单容器即可完整运行。

---

## 关于 wrangler 配置（重要设计决策）

**本项目不手写 `wrangler.toml`。** 原因：

1. 前端 `vinext build` 会**自动生成** `frontend/btex-frontend/dist/server/wrangler.json`（每次构建覆盖）；手写一份静态 wrangler 文件会与之冲突。
2. `vite.config.ts` 明确将部署设为 **local-only**（`d1=null; r2=null`），当前不部署到 Cloudflare Workers 的 D1/R2 绑定。
3. `vinext start` 内部已封装 miniflare/wrangler 运行时，无需外部 CLI 编排。

> 若未来要真上 Cloudflare Workers（启用 D1/R2）：在 `vite.config.ts` 里把 `d1`/`r2` 设为绑定名，`vinext build` 会把绑定写进生成的 wrangler.json，再用 `wrangler deploy` 部署 `dist/server`。**改配置源头（vite.config），而不是手写 wrangler.toml。**

---

## 三种部署方式

### 1) 本地/服务器直跑（推荐用于自托管）
```bash
./scripts/deploy.sh build   # 装依赖 + 构建前端
./scripts/deploy.sh start   # 启动一体化服务（:3000）
# 或一步到位：
./scripts/deploy.sh
```

### 2) Docker 单容器
```bash
./scripts/deploy.sh docker
# 等价于：
docker build -t brainx:latest .
docker run --rm -p 3000:3000 --env-file .env brainx:latest
```

### 3) CI（GitHub Actions，见 .github/workflows/ci.yml）
每次 push / PR 到 `main` 自动跑：
- `backend-test`：177 用例测试门禁
- `frontend-build`：vinext 构建校验
- `docker-build`：镜像可构建校验（仅构建不推送）

---

## 环境变量（.env，见 .env.example）

运行前必须准备 `.env`（**永不提交**，已在 .gitignore）：

| 变量 | 用途 |
|---|---|
| `BRAINX_PORT` / `BRAINX_HOST` | 后端监听（默认 3000 / 0.0.0.0） |
| `BRAINX_FRONTEND_PORT` | 前端子进程端口（默认 4321） |
| `BRAINX_MYSQL_*` | 接真库时填；不填则用本地 SQLite |
| `BRAINX_FEISHU_APP_SECRET` 等 | 接飞书真实数据源时填 |
| `BRAINX_LLM_*` | 方向分类 / 助手用的 LLM 凭据 |

---

## 生产安全清单（上线前必做）

- [ ] RDS 连接账号从超管 `hayden` 降级为**专库、权限受限**账号
- [ ] RDS 白名单从 `0.0.0.0/0` 收窄为部署机固定 IP/内网段
- [ ] 外网连 RDS 开启 **SSL**（阿里云 CA，见 `src/db.js` TODO）
- [ ] `.env` 通过部署平台的 secret 注入，不落盘明文
