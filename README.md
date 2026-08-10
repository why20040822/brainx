# Brain X · 职位决策工作台

猎头团队的「今天该做哪个职位」决策系统。从飞书（职位盘点 Bitable + 三个业务群）拉数据，
确定性评分出每人每日推荐 Top10，顾问在自己的工作台承接/关注/关闭，事件溯源可回放。

- **技术栈**：Node ≥22（`node:sqlite` + `node:http`）+ 原生 ES-module 前端，**零 npm 依赖、零框架、零构建**
- **云版**：http://47.110.93.137:3100（systemd 常驻）· **本地版**：launchd 常驻 http://127.0.0.1:3100
- 规模：~4200 行（src 1913 + tests 1017 + public 1032），16 个提交，51/51 测试绿

## 目录与文件（全部内容）

```
src/                  后端核心（16 文件，1913 行）
  server.js           HTTP 路由 + SSE 总线（定向投递）+ 静态文件；入口 main
  bridge.js           飞书桥接器：3 分钟一轮；Bitable 团队池 + 按人令牌读各自所在群
  feishu.js           令牌 AES-256-GCM 存取 + refresh 轮换 + 直连 OpenAPI（45s 超时）
  oauth.js            网页授权 code flow；显式申请白名单 9 项 scope（含 offline_access）
  session.js          HMAC 无状态 Cookie（密钥 data/.secret，0600）
  sync.js             同步批次 sync_runs + job_facts UPSERT + 关系落位（含硬约束校验）
  recommend.js        生成一轮推荐（快照闸门：同步不完整 → blocked 不落库）
  scorer.js           六维确定性评分（同批输入同排序，禁随机数；UNKNOWN 关系硬阻断）
  engagement.js       承接状态机 VIEW→WATCH→ACCEPT→COMPLETE/DISMISS（事件账本推导，无状态表）
  replay.js           冻结回放：只读 recommendations 冻结行，不重算
  autopush.js         重大变化检测（Top1 易主 / Top3 新 ACCEPT 档）→ 推卡钩子
  push.js             飞书 legacy v1 卡片构建 + lark-cli --as bot 发送（push_log 幂等）
  roster.js           顾问花名册（DB 权威，fixtures/roster.json 幂等播种）
  visibility.js       可见性单一权威（server.js 与 mcp 共用，fail-closed）
  db.js               node:sqlite 打开 + migrations 按位置迁移（PRAGMA user_version）
  env.js              .env 加载
migrations/           5 个迁移：init / push_log / consultants / bridge / per_user（令牌+可见性）
public/               前端（12 文件，1032 行，无构建 ES-module）
  index.html login.html styles.css
  js/main.js          页面编排 + SSE 客户端（1s 去抖刷新）
  js/api-client.js    fetch 封装
  js/components/      WorkbenchHeader / DecisionQueue / OpportunityRow / OpportunityDrawer
                      / CommitmentSummary / ReplayPanel
mcp/server.mjs        MCP stdio 服务器（10 工具，三端注册；与 HTTP 同一套领域函数与可见性）
bin/                  CLI：sync/recommend/replay/roster/push/web + install-launchd.sh
                      + com.brainx.web.plist（macOS）+ brainx.service（systemd，含 HOME 修复）
fixtures/             60 职位种子（3 份真实飞书导出衍生）+ roster.json（3 顾问）+ _sources/
scripts/build_fixture.mjs   fixture 重建
tests/                7 个测试文件 51 例：core(18) bridge(8) feishu(7) visibility(6)
                      autopush(5) oauth(5) mcp(2)
docs/VERIFICATION.md  13 节真机验证记录（每次大改的实测证据）
QUICKSTART.md         开箱即用（云版/本地/打包纪律）
```

## 数据模型（7+3 表）

`sync_runs`（同步批次，complete=1 才能用于推荐）→ `job_facts`（职位事实，project_id 主键，
团队共享单表）→ `job_memberships`（顾问×职位关系，valid_to 区间）→ `decision_runs` +
`recommendations`（冻结行）→ `decision_events`（事件账本）→ `job_outcomes`（结果观察，幂等键）。
桥接侧：`bridge_cursor`（按人游标 `chat:oc_x@cid`）、`job_messages` + `job_message_visibility`
（消息全局一条，可见性按人登记）、`consultant_tokens`（加密令牌）、`consultant_chats`（群成员缓存）。

## 关键纪律（改动时必读）

1. **凭据**：app_secret 只走 `BRAINX_FEISHU_APP_SECRET` 环境变量；用户令牌 AES-GCM 入库，
   密钥 = `data/.secret`；任何日志/响应不出令牌；打包必须排除 `.env` 和 `data/.secret`。
2. **按人隔离**：群消息只用本人令牌读本人实际所在群（im/v1/chats ∩ BRIDGE_CHATS）；
   API 跨人一律 404；SSE 带 consultant_id 定向。
3. **桥接只刷事实不动关系**：payload relation=null，Felix 的策展关系不被冲掉。
4. **fail-closed**：不在花名册拒登；无完整快照不出推荐；令牌失效跳过该顾问不阻断他人。
5. **lark-cli 会挂死**（fork 炸弹前科）：用户身份调用一律 45s 超时上限；直连 API 用
   `AbortSignal.timeout(45000)`。推卡只走 `--as bot`，仅推本人，绝不推群。
6. **MySQL 不适用**：本项目是 SQLite；但团队 RDS 纪律见 ttc 主仓 CLAUDE.md。

## 运行

```bash
npm test                     # 51/51，约 3 秒（Node ≥22；v22 用 node --test "tests/*.test.mjs"）
node src/server.js           # 开发：127.0.0.1:3000
sh bin/install-launchd.sh    # macOS 常驻 → 127.0.0.1:3100
# 服务器部署：rsync（include/exclude 规则，勿多源带尾斜杠！）→ systemctl restart brainx
```

## 当前待办

- **felix/york 登录被拦**：应用 1.0.0 可用范围只有 Mia → 需发 1.0.2（可用范围加人），
  发布前先取消约 18 项「待发布」垃圾权限（mail/okr/calendar/打卡/建群），否则又被驳回。
- 三人各自重登一次激活按人消息同步（工作台头部胶囊引导）。
- Felix 提供 TalentMatch ATS 职位导出（project_id/Pipeline/HC）→ 替换 P-FIX 占位 ID。
- brainx.yorkteam.cn 子域名 + HTTPS（现有证书无泛域名）。
