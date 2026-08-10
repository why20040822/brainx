# Brain X · 职位决策工作台

猎头团队的「今天该做哪个职位」决策系统。从飞书（职位盘点 Bitable + 三个业务群）拉数据，
确定性评分出每人每日推荐 Top10，顾问在自己的工作台承接/关注/关闭，事件溯源可回放。

- **技术栈**：Node ≥22（`node:sqlite` + `node:http`）+ 原生 ES-module 前端，**零 npm 依赖、零框架、零构建**
- **云版**：http://47.110.93.137:3100（systemd 常驻）· **本地版**：launchd 常驻 http://127.0.0.1:3100
- 规模：~4600 行（src ~2150 + tests ~1500 + public ~1050），22 个提交，69/69 测试绿

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
  sync.js             同步批次 + job_facts UPSERT（9 事实字段变化才前进 captured_at）+ 属主守卫
  recommend.js        生成一轮推荐（快照闸门；接 relations 推导；latestRun 剥离 raw_json）
  scorer.js           六维确定性评分（CJK bigram 分词；priority 活跃度加成；UNKNOWN 硬阻断）
  engagement.js       承接状态机（VIEW 不降级关注；ACCEPT 拦他人主做；事件账本推导）
  replay.js           冻结回放：只读 recommendations 冻结行，不重算
  autopush.js         重大变化检测（Top1 易主 / Top3 新 ACCEPT 档）→ 推卡钩子
  push.js             飞书 legacy v1 卡片 + lark-cli --as bot 发送（run_id '' 哨兵幂等）
  roster.js           顾问花名册（DB 权威，fixtures/roster.json 幂等播种）
  visibility.js       可见性单一权威（server.js 与 mcp 共用，fail-closed）
  db.js               node:sqlite 打开 + migrations 按文件名记账（schema_migrations 表）
  env.js              .env 加载
migrations/           7 个迁移：init / push_log / consultants / bridge / per_user / framework
                      / bitable_fields（扩列+退役+污染清理）
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
tests/                8 个测试文件 69 例：core(18) bridge(8) feishu(7) visibility(6)
                      autopush(5) oauth(5) mcp(2) framework(18)
docs/VERIFICATION.md  15 节真机验证记录（每次大改的实测证据）
docs/2026-08-10-bitable-standard-fields-and-cloud-isolation.md  字段标准/数据管理/云端隔离方案
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
3. **事实/关系分离**：桥接与 feishu 源只刷事实（relation=null）；关系只有两个来源——
   fixture 策展（属主=felix，非属主同步不写）+ `relations.js` 推导（本人行 > 他人主做 >
   团队池默认）。任何模块不得自行判定关系。
4. **fail-closed**：不在花名册拒登；无完整快照不出推荐；令牌失效跳过该顾问不阻断他人。
5. **lark-cli 会挂死**（fork 炸弹前科）：用户身份调用一律 45s 超时上限；直连 API 用
   `AbortSignal.timeout(45000)`。推卡只走 `--as bot`，仅推本人，绝不推群。
6. **数据语义**：`captured_at` = 事实最后变化时间（UPSERT 变化检测，禁回刷）；
   `raw_json` 不出网；migrations 只增不改，按文件名记账。
7. **MySQL 不适用**：本项目是 SQLite；但团队 RDS 纪律见 ttc 主仓 CLAUDE.md。

## 运行

```bash
npm test                     # 69/69，约 3 秒（Node ≥22；v22 用 node --test "tests/*.test.mjs"）
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
- ~~mia/york 推荐池为空~~（2026-08-10 框架修正：relations.js 推导层，团队池默认 TEAM_SHARED）。
- 关系推导目前是团队池粗粒度默认（不知道团队池里「主做」列对应谁）；
  ATS 导出落地后按主做信息细化 OTHER_CONSULTANT 判定。
