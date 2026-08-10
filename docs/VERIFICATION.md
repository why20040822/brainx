# Brain X 职位决策工作台 1.0 · 开发验证报告

日期：2026-08-07 · 验证人：钟笑咪的 claude · 环境：macOS, Node v26.4.0 (`node:sqlite` 零依赖）

## 1. 交付范围（对照 PRD + 补全文档 §13–§18）

| Slice | 内容 | 状态 |
|---|---|---|
| 1 | 数据底座：SQLite 7 表 + WAL + migrations + 三来源同步（fixture / lark-cli 职位盘点） | ✅ |
| 2 | 确定性评分 6 维 + 硬约束（CLOSED/无ID/UNKNOWN 不出单）+ Top3/Top10 | ✅ |
| 3 | 承接状态机（VIEW/WATCH/ACCEPT/DISMISS/RELEASE/COMPLETE，8 态，幂等键） | ✅ |
| 4 | 机会详情抽屉（评分拆解/理由/风险/证据/操作按 legal_actions 渲染） | ✅ |
| 5 | 结果记录（outcomes 幂等） | ✅ |
| 6 | 决策回放（冻结 recommendations 行，不重算） | ✅ |
| 7 | 飞书卡片推送（DAILY_TOP3 / SYNC_ALERT，深链按钮，push_log 幂等） | ✅ 真发成功 |
| §14 | 登录：顾问选择 → HMAC httpOnly Cookie（7d，secret 0600） | ✅ |
| §15 | 六屏 UI：登录/工作台/队列/抽屉/承接/回放，PRD §11 视觉规范 | ✅ |

## 2. 自动化测试

`node --test` → **23/23 全绿**（188ms）：迁移幂等、同步 60 行、去重、dry-run、硬约束、Top10 ≥2 理由、确定性重跑同序、排序链、探索分确定性、coverage<0.5→OBSERVE、状态机全链、幂等无双写、DISMISS 冷静期、WATCH 上限 10、回放冻结（职位 CLOSED 后回放仍当时值）、outcome 幂等、推送卡片结构+SKIPPED_DUPLICATE 单行、FAILED 重发更新原行。

## 3. API 验证（curl）

- 未登录 → 401 JSON；登录 → 204 + Set-Cookie
- workbench READY（60/60 行）；recommendations 排序稳定
- WATCH 重复提交 → `already:true` 无双写；ACCEPT 无 confirm → 409；带 confirm → ACCEPTED
- 已 RELEASED 职位再 ACCEPT → 409（前端提示"状态冲突，已为你刷新"）
- replay 返回冻结行 + 事件 + outcome；job_now 仅标注"对照"

## 4. 浏览器验证（chrome-devtools MCP 真机）

- 工作台：Top3 默认 + 信号条（Fit/Activity/Evidence）+ 建议接单砖红标签 ✓
- Top10 展开/收起 ✓；行=article[role=button] 无幽灵事件 ✓
- 抽屉：KV/六维拆解条/理由/风险/证据/操作，Esc 关闭、焦点还原 ✓
- ACCEPT 二次确认 alertdialog → 确认 → 承接摘要 接单中 1/需处理 1 ✓
- 深链 `?open=replay:<id>` 自动打开回放抽屉，6 要素齐全 ✓
- 登录页：居中卡片 + 顾问单选 + 数据位置提示 ✓

## 5. 推送验证（真实发送）

- 目标：Mia 本人机器人私聊（`ou_1947320b...`，仅自己可见）
- 结果：**SENT**，`message_id: om_x100b686c4ed218b0c2e9ef5e50e7c4c`
- 同 run 重发 → `SKIPPED_DUPLICATE`（push_log 单行，UNIQUE 约束保证）
- 卡片含：3 职位摘要行（Fit/Activity/Evidence 等宽字体）+ 查看详情/回放深链按钮 + 承接摘要 + run/snapshot/policy 注脚

## 6. 验证中发现并修复的问题

| # | 问题 | 修复 |
|---|---|---|
| 1 | lark-cli 1.0.67 **没有** `im messages create` 命令 | 改走 `lark-cli api POST /open-apis/im/v1/messages` 逃生舱 |
| 2 | user 身份发消息 230027 缺 scope | 加 `--as bot`（im:message:send_as_bot） |
| 3 | 卡片 schema 2.0 已移除 `action` 标签（ErrCode 200861） | 降级 legacy v1 卡片（config/header/elements），行为一致 |
| 4 | FAILED 推送永久阻塞同 run 重发 | dup.status='FAILED' → 允许重发并 UPDATE 原行 |
| 5 | 深链 BASE_URL 与端口不一致 | 服务启动注入 `BRAINX_BASE_URL=http://127.0.0.1:3100` |
| 6 | 前端按钮嵌套按钮产生幽灵 RELEASE 事件 | OpportunityRow 改 article[role=button] |
| 7 | 抽屉关闭仍在 a11y 树 | visibility:hidden |

## 7. Fixture 来源（纪律：禁止手编）

60 职位全部派生自 3 份真实 lark-cli 导出（`fixtures/_sources/`）：职位盘点 Bitable 31 行 + ZP 订阅群摘要 + FLX 优先级群（Felix 真实主做标注）。唯二合成：`project_id = P-FIX-<md5(company|role)[:8]>`（确定性占位，待 ATS 导出替换）、HC 未知（飞书源无此字段，已进风险文案）。

## 8. 未关闭事项

- ⛔ **阻塞 Slice-1 真实数据**：TalentMatch ATS 职位导出方式（project_id/Pipeline/HC）——等 Felix
- FLX 群推送**未测试**（需 Mia 确认才发群）
- 定时推送 cron 未配置（`bin/brainx-push.mjs --send --target <id>` 已就绪）

## 9. 飞书 OAuth 多顾问登录（2026-08-07 第二轮，commit 4e2d631+）

- 花名册：migration 0003 `consultants` 表；种子 = FLX 群实拉成员（felix/mia/york 含 open_id），`bin/brainx-roster.mjs` 可在线刷新
- 登录：飞书网页授权唯一正式入口；state 无状态 HMAC 防 CSRF；回调按 open_id 匹配花名册，不在册 fail-closed 拒登；session 绑定 open_id
- 原身份选择器降为 `BRAINX_DEV_AUTH=1` 离线演示后门，默认关闭
- 真机 E2E：浏览器走通 登录页→飞书授权→回调→以 mia 身份进工作台（空态正确，数据按顾问隔离）
- 踩坑记录：① oidc/access_token 响应只含 token 族字段，身份必须再拉 /authen/v1/user_info；② 重定向 URL 白名单在安全设置，即时生效无需发版；③ lark-cli 的 secret 锁 keychain 不可取，brainx 用 .env（process.loadEnvFile 原生加载，gitignore 兜底）

## 11. MCP 连接器 + 桥接器 + 实时更新（2026-08-07 第三轮，commit 04691d3 / a0d3c36）

- **brainx-mcp**（04691d3）：零依赖 node:stdio NDJSON JSON-RPC 2.0，10 工具（consultants/workbench/recommendations/recommend_run/opportunity/engage/replay/record_outcome/sync_now/push_preview）；已注册 Claude Code / OpenCode / Codex 三端；真机冒烟 felix 工作台 READY、Top1 Goodnotes
- **桥接器**（a0d3c36）：`src/bridge.js` 只刷事实不动关系（payload relation=null → runSync 跳过关系分支，Felix 策展关系不被团队池冲掉）；project_id 与 fixture 同一推导（P-FIX-*）同源公司自动合并；3 群消息游标增量（冷启动 desc 取最新页建游标，防从最早页翻页漏新消息）、message_id 幂等去重、公司名最长优先 + project_id 确定性 tie-break
- **SSE**：`/api/v1/events`（登录鉴权，25s 心跳）；桥接有变化 → 广播 sync/recommend/sync_error → 前端 EventSource 1s 去抖静默刷新 + live 播报
- 真机验证：3 顾问 × 29 行 Bitable complete=1；81 条群消息入库 4 条公司命中；游标推进；自动推荐 felix Top1 Goodnotes 79.7 / mia Rockflow 57.6 / york 空（无策展关系全 UNKNOWN，fail-closed 正确行为；mia 有数据因走过 fixture 同步拿到关系种子）

## 12. 常驻服务 + 重大变化自动推卡（P4）

- **launchd**：`bin/com.brainx.web.plist` 模板 + `bin/install-launchd.sh`（幂等；端口占用先报错防 KeepAlive 崩溃循环；curl 重试 5s 确认就绪）。已装：`gui/$(id -u)/com.brainx.web` state=running，登录自启 + 崩溃拉起（ThrottleInterval 10s）
- **HEATING_ALERT**：`src/autopush.js` 比较最近两轮推荐——Top1 易主 或 Top3 内新出现 ACCEPT 档（含晋升）→ 红头卡片推**顾问本人 open_id**（机器人私聊）
- 安全边界：`BRAINX_PUSH_AUTO=1` 才启用（默认关）；**绝不推群**（群推送需 Mia 显式确认，永远不进自动化路径）；run_id 幂等键防重发；推卡失败不影响桥接
- 测试：autopush 5 例（diff 两种触发/幂等/关门/无 open_id/stub 断言不打真 CLI）；全套 35/35 绿

## 10. 运行方式

```bash
cd ~/Downloads/brainx
node scripts/build_fixture.mjs          # 重建 fixture（可选）
node bin/brainx-sync.mjs                # 同步入库（60 行）
node bin/brainx-recommend.mjs           # 生成推荐 run
BRAINX_PORT=3100 BRAINX_BASE_URL=http://127.0.0.1:3100 node src/server.js
# 浏览器打开 http://127.0.0.1:3100 → 飞书授权登录

# 常驻（推荐）：登录自启 + 崩溃拉起 + 桥接器定时跑
sh bin/install-launchd.sh               # 幂等；卸载见脚本头注释
```

## 13. 按人令牌 + 数据可见性隔离（2026-08-10，commits 1f30d3a→e3a3dd5）

**问题**：桥接此前用服务器唯一 lark-cli 用户凭据（Mia 身份）拉取全部数据；job_facts/job_messages 无顾问维度，隔离只在评分层涌现；`/api/v1/opportunities/:id` 存在跨人越权读。

**改造**（三项决策 Mia 拍板）：
- **登录即授权**：OAuth 回调存各人 user/refresh token（AES-256-GCM，密钥=sha256(`data/.secret`)，src/feishu.js）；到期自动 refresh（refresh_token 轮换整体落库）；被拒/过期标 `needs_reauth`，桥接跳过该顾问不阻断他人；网络异常不标记（下轮重试）
- **群消息按人拉取**：各人令牌 `im/v1/chats` 自动发现实际所在群 ∩ BRIDGE_CHATS；可见性落 `job_message_visibility`（同一消息行全局一条，谁能看按人登记）；存量 93 条归 mia（本就是她身份读入）；游标复制 `@mia` 保连续；非成员群**根本不发起拉取**
- **job_facts 保持团队单表**（三向外键 + 回放不破），可见性收敛 `src/visibility.js` 单一权威（server.js 与 mcp/server.mjs 共用）：opportunities/sync-runs/replay 跨人一律 404；events/outcomes 按人过滤；SSE 带 consultant_id 定向投递

**关键实现点**：
- 网页授权显式 `scope=` 白名单 9 项（不传 = 申请全部已启用项，含非白名单会被租户拦）；`offline_access` 不显式要就没有 refresh_token
- lark-cli 用户身份退出桥接主路径，仅保留：Bitable 无令牌回落、`--as bot` 推卡；直连超时 `AbortSignal.timeout(45s)` 等价防挂死
- skipped 提醒只在状态变化时发一次（防每 3 分钟刷屏）；工作台头部 `feishu_auth` 胶囊提示重登
- **⚠️ `data/brainx.db` 现含加密令牌：任何归档必须排除 `data/.secret`**（密钥与库同出 = 明文外发所有人令牌）

**测试**：新增 feishu.test.mjs（7 例：加密往返/无明文落库/refresh 轮换/被拒降级/网络异常不标记/过期直拒/翻页与时间换算）+ visibility.test.mjs（6 例：可见性规则/HTTP 闸门/跨人 404/事件结果过滤/SSE 定向/回调落令牌）；bridgeOnce 变异步 + 按人隔离 3 例；全套 **51/51 绿**（本地 Node v26 + 服务器 Node v22 双验）。

**服务器实测（47.110.93.137，2026-08-10）**：0005 迁移自动跑（user_version 5），93 条消息归属 mia，游标 ×2（全局+@mia）；桥接首轮三顾问 rows_read=29 complete=1（Bitable 走 lark-cli 回落）；无人有令牌 → 消息按设计暂停，各自重登即恢复。

## 14. 框架结构修正（2026-08-10，源码审计驱动）

**起因**：对全仓做框架级审计（对照 2026-08-03 设计文档与 PRD 纪律），发现 8 处结构缺陷并全部修正。每处附回归测试（新增 tests/framework.test.mjs，13 例）。

**缺陷与修正**：
1. **主链路断链（最重）**：recommend 只评「本人有 memberships 行」的职位，桥接按纪律不写关系、fixture 是 Felix 个人导出 → mia/york 推荐池恒为空。新增 `src/relations.js`（关系推导单一权威：本人行 > 他人 MY_JOB/PRIMARY_PM→OTHER_CONSULTANT > 团队池默认 TEAM_SHARED），recommend/latestRun/opportunity（HTTP+MCP）/engage 全部接入
2. **fixture 属主污染**：mia 跑 fixture 同步会把 Felix 的 MY_JOB 继承成自己的。runSync 加属主守卫（仅 `consultant_owner=felix` 本人同步写关系）；`fetchFeishuJobs` 同步改 relation=null（修正前会给同步者写 TEAM_SHARED，把其策展关系到期冲掉）
3. **接单守卫缺口**：OTHER_CONSULTANT 风险文案写「默认不可接单」但状态机不拦 → engage ACCEPT 对他人主做职位 409
4. **状态机 VIEWED 不可达 + VIEW 降级关注**：current_engagement 视图不含 VIEWED（「已查看」永不浮现，UI 徽章失效）；VIEW 对 WATCHED 职位写 next_state=VIEWED 会静默冲掉关注。0006 重建视图纳入 VIEWED；VIEW 的 next_state 按当前态求值（WATCHED 保持 WATCHED）；UNWATCH 的 note『关注回滚』落 reason 列（修正前定义了从不持久化）
5. **captured_at 失真**：每轮桥接 UPSERT 回刷 captured_at → scorer 新鲜度恒满分。改为六事实字段（公司/职位/城市/pipeline/HC/状态）任一变化（null 安全 IS NOT）才前进
6. **raw_json 出网**：latestRun 整行展开 job_facts → workbench/recommendations/MCP 每条推荐携整段原始负载。剥离（opportunity 路由本就剥）
7. **静态服务前缀漏洞**：`fp.startsWith(PUBLIC)` 裸前缀 → 兄弟目录 `public-x/…` 被误判内部。抽出 `isPathInside`（base+sep）导出并测试
8. **migrations 纯位置记账 + push_log 唯一键漏洞**：user_version 序数跳文件会错位 → schema_migrations 按文件名记账（旧库 user_version=N 自动回填前 N 个文件名）；push_log `UNIQUE(consultant_id,kind,run_id)` 遇 NULL 失效（SYNC_ALERT 恒 NULL 可重复插）→ '' 哨兵 + 0006 回填存量

**评分质量**：similarity 旧分词 `(?=[一-鿿])` 把中文逐字切开又被 length>1 过滤 → 纯中文职位相似度恒 0；改 CJK bigram（tokenize 导出），「增长负责人」×「增长经理」命中「增长」。

**验证**：64/64 测试绿（51 旧 + 13 新）；真实库副本实测迁移：user_version 5→6，0006 单文件补跑，视图含 VIEWED，push_log 存量 NULL 全部回填为 ''，recommendations 150 行 / events 169 行无损。

## 15. Bitable 标准字段适配（2026-08-10，字段解析逻辑修正）

**起因**：用户指出字段解析逻辑有问题，要求按云端标准字段实测重构。实测（field-list + 31 记录全扫）：「职位」是多选**职能类别**非职位名；「还做吗」是**优先级+状态**（1重点高优12/正常招11/无,待定4/新4）；「文本」是真实需求细节；「主做」user 列 31/31 全空。

**旧解析缺陷（实锤）**：① 职位多选被顿号拼成假职位名（22/86 行）且勾选变化致 project_id 漂移重复；② 文本 0/86 入库；③ 还做吗原文塞 pipeline，优先级信号全丢；④ 主做/公司类型丢弃。

**修正**：新增 `src/bitable.js` 解析层（唯一权威，bridge/sync 共用）——公司×单职能展开（project_id 仍 md5(公司|职能)，单职能行 ID 无缝续命，与 fixture 同源自然合并）；priority 结构化（HIGH/NEW/NORMAL/STANDBY，STANDBY→COOLING）；notes/company_type 入库（0007 扩列）；owner_names 解析入 raw_json 备用。captured_at 变化检测扩为 9 字段。scorer 活跃度加 priority 加成（HIGH+25/NEW+15/NORMAL+10）；卡片 🔥 高优；抽屉展示优先级+需求细节。

**0007 迁移**：扩三列；桥接旧复合行 CLOSED（12 行，fixture（多岗）策展行 23 行保留）；非属主 fixture 关系到期（云端 mia 60 条污染实锤，一并清理）。

**验证**：69/69 测试绿；真 lark-cli 干跑 31→51 行（像素律动 4 职能带 P0 文本）；真实库副本全演练（86→119 行，退役/清理/回填全对）。方案与数据管理纪律见 docs/2026-08-10-bitable-standard-fields-and-cloud-isolation.md。
