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

## 10. 运行方式

```bash
cd ~/Downloads/brainx
node scripts/build_fixture.mjs          # 重建 fixture（可选）
node bin/brainx-sync.mjs                # 同步入库（60 行）
node bin/brainx-recommend.mjs           # 生成推荐 run
BRAINX_PORT=3100 BRAINX_BASE_URL=http://127.0.0.1:3100 node src/server.js
# 浏览器打开 http://127.0.0.1:3100 → 选 Felix 进入
```
