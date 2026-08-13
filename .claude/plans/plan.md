# BrainX 1.2 — CSV→标准库格式 LLM Adapter 实施计划

## 目标
读两份原始 CSV（①公司岗位情况-Shanon ②Felix投放增长营销项目池），用大模型把脏数据
标准化成 PRD 1.2 定义的数据库格式，写入 SQLite 决策库。LLM 接口配置进 .env/.env.example。
不动 db.js（数据库接口已写好），按 PRD 1.2 新增 SQLite 表（迁移文件）。最后更新 README。

## 关键判断（已从代码确认）
- **写入哪个库**：两份 CSV 是「职位/项目」数据 → 写 SQLite 决策库（job_facts 家族 + PRD 1.2 新表）。
  MySQL 人才库（talent/tag/position…）是「候选人」库，用户明确说是「下一步功能活」，本次只做 schema 就绪说明、不接线。
- **db.js 不动**：连接层 + MySQL TALENT_DDL 保持原样。新增表走 migrations/（项目既有纪律，0007 就是这样加的）。
- **project_id 复用 bitable.js 的 deriveProjectId(company, role)**：CSV 源与 fixture/bridge 源同 ID 自然合并。
- **LLM 可降级**：配了 key 走 LLM 分类；没配走确定性关键词回退（沿用 bitable.js mapPriority 哲学，离线可跑）。
- **LLM 接口用 OpenAI 兼容协议**（global fetch，零依赖）：一套 BASE_URL+KEY+MODEL 兼容 DeepSeek/通义/Kimi/OpenAI。

## CSV → 标准字段映射

### CSV① 公司岗位情况-Shanon（市场源 → job_facts + job_classifications）
列：公司, 地点, 公司类型, [AI产品, 运营, UIUX设计, 研发or其他]=职能分类列（每格多行多岗）
- 每格按换行拆岗 → 每个(公司, 岗)一行 job_facts：company/role/city/company_type
- 「不活跃岗位」分段 → active_state=COOLING；正常段 → OPEN
- 职能列名作为方向分类提示（AI产品列→产品向，运营列→增长/运营向…）
- project_id = deriveProjectId(公司, 岗)
- LLM 分类 → job_classifications：primary_direction / secondary_directions[] / is_leadership / confidence / matched_terms[]

### CSV② Felix项目池（驾驶舱源 → cockpit_facts + job_occupancy）
列：客户, 职位, 方向标签, 优先级, 当前状态, 关系依据, 岗位核心, 下一步动作, 来源
- project_id = deriveProjectId(客户, 职位)（与 CSV① 同名公司可对齐，如蝴蝶梦境/Goodnotes/RockFlow）
- 当前状态+关系依据 → membership_status：已参与/Felix已开展→PRIMARY_PM；共同参与/共同校准→PARTICIPANT；
  驾驶舱推荐/源表复制→MENTIONED；未加入→UNCONFIRMED
- 当前状态 → current_stage：已参与→ACTIVE_ADVANCEMENT；待判断→NEW_VALIDATION；未加入→UNCONFIRMED
- 岗位核心 → pipeline_snapshot；下一步动作 → next_action（入 raw_json）；方向标签 → 方向分类辅助
- 职位/方向标签里的 HC 提示（如「AI增长（2–3 HC）」）→ job_occupancy.headcount_total（LLM 抽取）
- 来源含 URL → source_url

## 新增/修改文件

### 新增
1. **src/csv.js** — 零依赖 CSV 解析器：处理 BOM、引号内嵌换行/逗号、CRLF。返回 string[][]。
2. **src/llm.js** — OpenAI 兼容 LLM 客户端（global fetch，零依赖）：
   - 读 `BRAINX_LLM_BASE_URL` / `BRAINX_LLM_API_KEY` / `BRAINX_LLM_MODEL`
   - `isLlmConfigured()` / `chatJson(system, user, schema)` 返回解析后 JSON
   - 超时 45s、错误抛出（调用方决定降级）
3. **src/adapter.js** — 适配器核心：
   - `parseMarketCsv(text)` → job_facts 形状行（公司×职能列×岗展开，跳空行/重复表头/分段标题）
   - `parseCockpitCsv(text)` → cockpit_facts 形状行
   - `classifyJobs(rows)` → 调 LLM 批量分类 primary_direction/is_leadership；无 key 走关键词回退
   - `classifyCockpit(rows)` → LLM 精化 membership_status/current_stage；无 key 走规则回退
   - `runAdapter(db, {dry_run, marketCsv, cockpitCsv, consultant_id})` → 编排：解析→分类→UPSERT job_facts + 写 cockpit_facts/job_classifications/job_occupancy；返回汇总（沿用 runSync 的 complete/errors/rows 契约）
4. **migrations/0008_agent12.sql** — PRD 1.2 三张新表（IF NOT EXISTS，FK→job_facts ON DELETE CASCADE）：
   - `cockpit_facts`(project_id PK, membership_status, current_stage, stage_confidence, pipeline_snapshot, next_action, client_feedback_refs, weekly_report_refs, last_activity_at, cockpit_as_of, completeness, source_url, raw_json, updated_at)
   - `job_classifications`(project_id PK, primary_direction, secondary_directions JSON, is_leadership, role_semantic_confidence, matched_terms JSON, excluded_terms JSON, classification_version, evidence JSON, updated_at)
   - `job_occupancy`(project_id PK, headcount_total, filled_current, reserved_current, remaining_hc, offer_status, onboarding_status, occupancy_status, as_of, updated_at)
5. **bin/brainx-adapter.mjs** — CLI 入口（沿用 bin/brainx-sync.mjs 风格）：
   `node bin/brainx-adapter.mjs --source ttc,cockpit --consultant felix [--dry-run] [--market-csv <path>] [--cockpit-csv <path>]`
   默认读项目根的两份 CSV；--dry-run 只打印 JSON 不落库。
6. **tests/adapter.test.mjs** — 纯解析层单测（不依赖 LLM）：CSV 解析、公司×岗展开、不活跃段、membership 映射、确定性回退分类。LLM 走 mock。

### 修改
7. **.env.example + .env** — 追加 LLM 段：
   ```ini
   # ---- LLM（CSV→标准库格式适配器；OpenAI 兼容协议，支持 DeepSeek/通义/Kimi/OpenAI）----
   BRAINX_LLM_BASE_URL=https://api.deepseek.com/v1
   BRAINX_LLM_API_KEY=
   BRAINX_LLM_MODEL=deepseek-chat
   ```
8. **package.json** — 加 `"adapter": "node bin/brainx-adapter.mjs"` 脚本 + bin 入口 `braintex-local-adapter`。
9. **README.md** — 在开头补三块（DB 格式 / 目录文件 / 运行命令），新增 adapter 命令与 LLM 配置说明，标注 MySQL 人才库「schema 就绪、业务接线下一步」。

## 不做（明确边界）
- 不改 src/db.js（连接层 + MySQL TALENT_DDL 原样）。
- 不接 MySQL 人才库业务读写（候选人→talent 同步是下一步）。
- 不改现有评分/推荐/桥接逻辑（adapter 是新数据源，产物落 job_facts 家族，下游 recommend.js 自动可用）。
- 不渲染 PDF 图片（只读 prd_extracted.txt 的字段结构，已读）。

## 验证
- `node bin/brainx-adapter.mjs --dry-run` 打印标准化 JSON（不落库，肉眼校验字段）。
- `node bin/brainx-adapter.mjs` 落库后 `node --test` 全绿（含新 adapter 测试）。
- 跑通后 README 命令可复制即跑。
