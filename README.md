# Brain X · 职位决策工作台

猎头团队的「今天该做哪个职位」决策系统。从飞书（职位盘点 Bitable + 三个业务群）拉数据，
确定性评分出每人每日推荐 Top10，顾问在自己的工作台承接/关注/关闭，事件溯源可回放。

- **技术栈**：Node ≥22（`node:sqlite` + `node:http`）+ 原生 ES-module 前端，**零 npm 依赖、零框架、零构建**
- **云版**：http://47.110.93.137:3100（systemd 常驻）· **本地版**：launchd 常驻 http://127.0.0.1:3100
- 规模：~4600 行（src ~2150 + tests ~1500 + public ~1050），22 个提交，72/72 测试绿

## 目录与文件（全部内容）

```
src/                  后端核心（18 文件，~2150 行）
  server.js           HTTP 路由 + SSE 总线（定向投递）+ 静态文件（isPathInside 防穿越）；入口 main
  bridge.js           飞书桥接器：3 分钟一轮；Bitable 团队池 + 按人令牌读各自所在群
  bitable.js          Bitable 字段解析层（唯一权威）：公司×单职能展开、priority 结构化、双通道拍平
  relations.js        关系推导单一权威：本人行 > 他人主做→OTHER_CONSULTANT > 团队池 TEAM_SHARED
  feishu.js           令牌 AES-256-GCM 存取 + refresh 轮换 + 直连 OpenAPI（45s 超时）
  oauth.js            网页授权 code flow；显式申请白名单 9 项 scope（含 offline_access）
  session.js          HMAC 无状态 Cookie（密钥 data/.secret，0600）
  sync.js             同步批次 sync_runs + job_facts UPSERT + 关系落位（含硬约束校验）
  recommend.js        生成一轮推荐（快照闸门：同步不完整 -> blocked 不落库）
  scorer.js           六维确定性评分（同批输入同排序，禁随机数；UNKNOWN 关系硬阻断）
  engagement.js       承接状态机 VIEW->WATCH->ACCEPT->COMPLETE/DISMISS（事件账本推导，无状态表）
  replay.js           冻结回放：只读 recommendations 冻结行，不重算
  autopush.js         重大变化检测（Top1 易主 / Top3 新 ACCEPT 档）-> 推卡钩子
  push.js             飞书 legacy v1 卡片构建 + lark-cli --as bot 发送（push_log 幂等）
  roster.js           顾问花名册（DB 权威，fixtures/roster.json 幂等播种）
  visibility.js       可见性单一权威（server.js 与 mcp 共用，fail-closed）
  db.js               node:sqlite 打开 + migrations 按位置迁移 + 阿里云 RDS MySQL 人才库连接（懒加载）
  env.js              .env 加载
migrations/           7 个迁移：init / push_log / consultants / bridge / per_user / framework
                      / bitable_fields（扩列+退役+污染清理）
public/               前端（12 文件，1032 行，无构建 ES-module）
  index.html login.html styles.css
  js/main.js          页面编排 + SSE 客户端（1s 去抖刷新）
  js/api-client.js    fetch 封装
  js/components/      WorkbenchHeader / DecisionQueue / OpportunityRow / OpportunityDrawer
                      / CommitmentSummary / ReplayPanel
mcp/server.mjs        MCP stdio 服务器（11 工具，三端注册；与 HTTP 同一套领域函数与可见性）
bin/                  CLI：sync/recommend/replay/roster/push/web + install-launchd.sh
                      + com.brainx.web.plist（macOS）+ brainx.service（systemd，含 HOME 修复）
fixtures/             60 职位种子（3 份真实飞书导出衍生）+ roster.json（3 顾问）+ _sources/
scripts/build_fixture.mjs   fixture 重建
tests/                8 个测试文件 72 例：core(18) bridge(8) feishu(7) visibility(6)
                      autopush(5) oauth(5) mcp(2) framework(21)
docs/VERIFICATION.md  16 节真机验证记录（每次大改的实测证据）
docs/2026-08-10-bitable-standard-fields-and-cloud-isolation.md  字段标准/数据管理/云端隔离方案
QUICKSTART.md         开箱即用（云版/本地/打包纪律）
```

## 如何运行

> 云版已在线：浏览器打开 http://47.110.93.137:3100 -> 飞书授权 -> 自己的工作台。
> 以下是在自己机器上跑的步骤，照着每条命令敲就行，不需要会写代码。

### 1. 装 Node.js（只要一次）

本项目用 Node.js ≥ 22.5，核心功能**零 npm 依赖**（不用 `npm install`）。

```bash
node -v          # 必须 v22.5 以上；没有就去 https://nodejs.org 装 LTS 版
```

### 2. 拿到代码

```bash
git clone <仓库地址> brainx
cd brainx
```

### 3. 配置飞书凭据（.env）

仓库**不含** `.env`（里面有飞书 App Secret，不进版本库）。先复制模板：

```bash
cp .env.example .env
```

打开 `.env`，填上飞书应用 secret（飞书开发者后台 -> 凭证与基础信息 -> App Secret）：

```ini
BRAINX_FEISHU_APP_SECRET=你的飞书App Secret
BRAINX_BASE_URL=http://127.0.0.1:3000
```

> 没有这一项飞书登录不可用。只想看界面、不登录，可加 `BRAINX_DEV_AUTH=1`（离线演示后门）。

### 4. 启动

```bash
node src/server.js          # 启动，浏览器打开 http://127.0.0.1:3000
```

浏览器打开 -> 飞书授权登录 -> 进自己的工作台。数据库 `data/brainx.db` 首次运行自动建表，不用手动建。

> 桥接器（每 3 分钟拉飞书新数据）依赖 `lark-cli`。没装也能跑，只是日志会报 sync_error、
> 拉不到飞书新数据，页面本身正常。彻底关掉桥接：`BRAINX_BRIDGE_OFF=1 node src/server.js`。

### 5. 跑测试（确认环境 OK）

```bash
npm test                    # 51/51 全绿，约 3 秒
```

### 6. 常驻后台（可选）

第 4 步是前台运行，关终端就停。要开机自启 / 崩溃拉起：

```bash
npm test                     # 72/72，约 3 秒（Node ≥22；v22 用 node --test "tests/*.test.mjs"）
node src/server.js           # 开发：127.0.0.1:3000
sh bin/install-launchd.sh    # macOS 常驻 → 127.0.0.1:3100
# 服务器部署：rsync（include/exclude 规则，勿多源带尾斜杠！）→ systemctl restart brainx
```

### 7. 阿里云 RDS MySQL 人才库（可选，不用人才库可跳过）

只有用到 talent / tag / resume / position / match_record / user 等 7 张表才需要。
Node 没有内置 MySQL 客户端，需装唯一一个依赖：

```bash
npm install mysql2
```

在 `.env` 补三行（RDS 账号 / 密码 / 库名），并在阿里云 RDS 控制台把本机公网 IP 加进白名单：

```ini
BRAINX_MYSQL_USER=...
BRAINX_MYSQL_PASSWORD=...
BRAINX_MYSQL_DATABASE=brainx_talent
```

外网地址 `ttc-rds-public-0707.mysql.rds.aliyuncs.com:3306`（已在 `src/db.js` 写死默认值）。
建表（一次即可，幂等可重复跑）：
```bash
node scripts/init-talent-schema.mjs   # 或 npm run init-talent
```
7 张表 DDL 在 `src/db.js` 的 `TALENT_DDL`。完整 5 步接入说明见 `src/db.js` 末尾注释。
