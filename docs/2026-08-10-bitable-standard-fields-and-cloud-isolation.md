# Bitable 标准字段适配与云端隔离方案（2026-08-10，实测驱动）

> 本文档是「字段解析逻辑修正」的设计依据与数据管理规范。所有结论均有实测出处：
> Bitable field-list / 31 条全量记录扫描 / 本地与云端（47.110.93.137）生产库探针。

---

## 1. 现状实测

### 1.1 数据源：职位盘点 Bitable 标准字段（`RR5NbWHEfacz4jsRYMocy1qAnSh` / `tblsZBwtKIrIgtre`）

| 字段 | 类型 | 多值 | 实测内容 | 旧解析的处置 | 判定 |
|---|---|---|---|---|---|
| 公司 | select | 单 | 客户名（TTC=内部行） | ✓ 正确（含过滤） | 保留 |
| 职位 | select | **多** | 职能类别（产品/工程/运营增长/算法/销售/战略/投资/FA/移动端/infra） | ✗ 顿号拼成假职位名（22/86 行） | **修正** |
| 主做 | user | 多 | **31/31 全空**（关系权威列无人维护） | ✗ 被丢弃 | 解析备用 |
| 地点 | select | 多 | 城市，含 remote | ✓ join 保留 | 保留 |
| 还做吗 | select | 多 | 实为**优先级+状态**：1重点高优(12)/有,正常招常年招(11)/无,待定(4)/新(4) | ✗ 原文塞 pipeline，优先级全丢 | **结构化** |
| 文本 | text | — | **真实需求细节**：P0/P1 岗位清单、客户文档链接、城市备注 | ✗ 完全丢弃（0/86 入库） | **入库 notes** |
| 公司类型 | select | 单 | AI 2C 等 | ✗ 丢弃 | **入库 company_type** |
| HC | — | — | **不存在此列**（已实证） | — | 保持 null |

### 1.2 本地库字段质量（修正前探针）

- 86 行 job_facts，22 行 role 是顿号拼接的复合假职位名；`captured_at` 被每轮桥接回刷（max=今天，新鲜度恒满分）；`pipeline` 全是"还做吗"原文。

### 1.3 云端生产库（47.110.93.137）探针

- user_version=5（0006/0007 未部署）；sync_runs 441（桥接 3 分钟一轮正常）；recommendations 210。
- **污染实锤**：`job_memberships` felix=60、mia=60 —— mia 在云端跑过 fixture 同步，把 Felix 的 60 条策展关系继承成了自己的（york=0 未跑过）。
- `consultant_tokens`=0：三人都未重登，按人消息同步未激活（桥接仅靠 lark-cli 回落拉 Bitable，群消息按设计暂停）。

---

## 2. 目标数据结构

### 2.1 粒度模型（双层并存）

```
职位盘点 Bitable（团队看板）          fixture（Felix 策展）
  1 记录 = 公司 × 职能集合             1 行 = 具体职位（含（多岗）复合记法）
        │ 展开 parseBitableRecord              │ 原样
        ▼                                      ▼
  job_facts：1 行 = 公司 × 单职能  ◄── project_id 同为 P-FIX-md5(公司|职能/职位) 自然合并 ──┘
```

- **展开**：Bitable 一记录按「职位」多选拆成 N 行，role=单职能。`md5(公司|单职能)` 对勾选变化稳定（加勾=新增一行，已有行 ID 不变）。
- **合并**：单职能公司行新旧 ID 相同，无缝续命；与 fixture 同名同行同 ID，Felix 策展关系自然生效。
- **退役**：旧顿号复合行（桥接来源、非（多岗））由 0007 置 CLOSED——不再被重建，冻结回放可对照，FK 不破。

### 2.2 job_facts 扩列（0007）

| 列 | 值域 | 语义 | 写入方 |
|---|---|---|---|
| priority | HIGH/NEW/NORMAL/STANDBY/null | 还做吗结构化；STANDBY→active_state=COOLING | 仅 Bitable 解析层 |
| notes | text/null | Bitable「文本」需求细节（P0/P1/文档链接） | 仅 Bitable 解析层 |
| company_type | text/null | Bitable「公司类型」 | 仅 Bitable 解析层 |
| pipeline | text/null | **进展记录**（fixture 策展语义）；Bitable 行恒 null | fixture |

### 2.3 字段语义与变化检测

`captured_at` = 事实最后变化时间：9 个事实字段（公司/职位/城市/pipeline/HC/状态/priority/notes/company_type）任一变化才前进，同步回刷不再污染新鲜度。

### 2.4 project_id 规则（纪律）

- 统一 `P-FIX-<md5(公司|role)[:8]>`，跨来源（fixture/bridge/未来 ATS 导入前的任何临时源）共用；
- ATS 导出落地后用真 project_id 整体替换（补全文档 §17.2 既定路线）；
- 「职位待定」是无职位信息时的占位 role（参与 md5，同公司只此一行）。

---

## 3. 数据管理纪律（来源 × 写入方矩阵）

| 数据 | 唯一写入方 | 其他人能做什么 |
|---|---|---|
| job_facts 事实列 | runSync（fixture/bridge/手动源统一入口） | 只读 |
| job_memberships | **仅 fixture 且仅属主 felix 同步时**；系统 EXPIRED 事件 | relations.js 推导（不写库） |
| 关系（读取语义） | relations.js 推导：本人行 > 他人主做→OTHER_CONSULTANT > 团队池 TEAM_SHARED | 任何模块不得自判 |
| sync_runs | runSync | 只读 |
| recommendations/decision_runs | recommend（快照 complete=1 闸门） | 只读（冻结） |
| decision_events | engage/recommend/expire（幂等键） | 只追加 |
| job_messages/visibility | bridge 按人令牌 | 按人过滤读 |
| consultant_tokens | OAuth 回调/refresh（AES-GCM） | 状态查询，永不读明文 |
| push_log | pushCard（consultant+kind+run_id 唯一） | 只读 |

补一条运营纪律：**「主做」列需要团队维护起来**（当前 31/31 全空）。一旦有人填，解析层已把 owner_names 落进 raw_json，relations.js 即可从「团队池粗粒度默认」细化为按主做判 OTHER_CONSULTANT——这是零代码升级的预留钩子。

---

## 4. 云端隔离方案（现状 → 缺口 → 补齐）

云版（47.110.93.137:3100）与本地同一份代码、同一个 SQLite 文件被三顾问共用，隔离全部在应用层。分层盘点：

| 层 | 机制 | 现状 | 缺口/动作 |
|---|---|---|---|
| 身份 | 飞书 OAuth → open_id 对花名册，fail-closed | ✅ 已上线 | felix/york 被应用可用范围拦 → 发 1.0.2 加人（先删 18 项垃圾权限） |
| 会话 | HMAC 无状态 Cookie（HttpOnly+SameSite=Strict，7 天） | ✅ | — |
| 数据 | visibility.js 单一权威：无关系/推荐/事件 → 404；events/outcomes 按人过滤 | ✅ | — |
| 推荐 | replay/recommendations/sync-runs 只出本人 | ✅ | — |
| 消息 | job_message_visibility 按人登记；非群成员根本不发起拉取 | ✅ 代码就绪 | **tokens=0 未激活** → 三人各重登一次（头部胶囊引导） |
| 令牌 | AES-256-GCM，密钥=data/.secret（0600，不进 git/归档） | ✅ | 备份纪律：db 与 .secret 不得同一份归档外发 |
| 通道 | SSE 带 consultant_id 定向投递；sync_error 分本人/全员 | ✅ | — |
| 推送 | lark-cli `--as bot`，仅推本人 open_id，**绝不推群** | ✅ | BRAINX_PUSH_AUTO 默认关保持 |
| 网络 | 工作台绑 0.0.0.0:3100（云版必要） | ✅ | HTTPS 子域 brainx.yorkteam.cn 待申请（现证书无泛域名） |
| 运维 | systemd unit 固化（HOME=/root）；45s 超时防 lark-cli 挂死 | ✅ | BRAINX_DEV_AUTH 云版必须保持未设置（后门默认关） |

**云版部署顺序（本轮修正上线时）**：
1. `rsync` 代码（排除 `data/`、`.env`、`data/.secret`）→ `systemctl restart brainx`；
2. 启动时 openDb 自动跑 0006+0007：视图重建（VIEWED）、push_log 回填、扩三列、12 行旧复合行 CLOSED、mia 60 条污染关系到期——**全部幂等，已在真实库副本演练**；
3. 桥接下一轮（≤3 分钟）自动按新解析层展开 51 行并回填 priority/notes/company_type；
4. 观察 `sync_runs.complete=1` 与推荐刷新；通知三人重登激活按人消息同步。

---

## 5. 验证记录

- 69/69 测试绿（framework.test.mjs 新增 18 例：解析层 4 + 评分 1 + 0007 迁移 1 + 既有框架 13）。
- 真实 lark-cli 拉取干跑：31 记录 → 51 职位行；像素律动 4 职能展开且 P0 文本随行；priority 分布 HIGH27/NORMAL15/STANDBY5/NEW4；STANDBY→COOLING 正确。
- 真实库副本演练 0007+桥接一轮：复合行退役 12、fixture（多岗）23 行保留、mia 污染 60→0、felix 60 不动、job_facts 86→119、priority/notes/company_type 回填 51/23/44。
- 云端探针确认待部署：user_version=5、tokens=0、mia 污染 60 行在云端同样存在（0007 会一并清理）。
