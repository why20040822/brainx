-- 0008_agent12.sql - PRD 1.2 决策 Agent 新增三表（市场+驾驶舱 -> 标准库格式）
--
-- 依据 BrainX_职位决策Agent_1.2_工程可执行PRD.pdf §09：job_facts / cockpit_facts /
-- job_classifications / job_occupancy / recommendations / decision_events。
-- job_facts / recommendations / decision_events 已在 0001 建好且被现有评分/推荐代码使用，
-- 按「原本的也可以部分保留」原则不动它们；本迁移只补 PRD 1.2 引入的三张新表。
--
-- project_id 与现有 deriveProjectId(company, role) 同源（bitable.js），故 CSV 源、
-- fixture、bridge 源的同公司同岗行天然合并到同一 project_id，FK 不破。
--
-- 外键 -> job_facts(project_id) ON DELETE CASCADE：删职位时其驾驶舱/分类/占用一并清理
-- （与 MySQL 人才库 talent_tag/resume/match_record 的 CASCADE 同一纪律）。
-- 注意：SQLite PRAGMA foreign_keys=ON（db.js 已设），故写入顺序必须是 job_facts 先于本三表。

-- ① 驾驶舱事实（Felix 项目池 = cockpit 源）
--    一项目一行；membership_status / current_stage 由 LLM 从「当前状态+关系依据」分类。
CREATE TABLE IF NOT EXISTS cockpit_facts (
  project_id            TEXT PRIMARY KEY REFERENCES job_facts(project_id) ON DELETE CASCADE,
  membership_status     TEXT NOT NULL DEFAULT 'UNCONFIRMED'
                        CHECK (membership_status IN
    ('PRIMARY_PM','PARTICIPANT','MENTIONED','UNCONFIRMED')),
  current_stage         TEXT,                 -- ACTIVE_ADVANCEMENT | NEW_VALIDATION | UNCONFIRMED | RESULT_CLOSURE | ...
  stage_confidence      REAL DEFAULT 0,       -- 0..1，LLM 分类置信度；规则回退=0.5
  pipeline_snapshot     TEXT,                 -- 「岗位核心」-> 项目快照（客户在做什么）
  next_action           TEXT,                 -- 「下一步动作」
  client_feedback_refs  TEXT NOT NULL DEFAULT '[]', -- JSON[] 客户反馈引用
  weekly_report_refs    TEXT NOT NULL DEFAULT '[]', -- JSON[] 周报引用
  last_activity_at      TEXT,                 -- 最近活动时间（CSV 无则空）
  cockpit_as_of         TEXT NOT NULL,        -- 本行数据截止时间（同步 as_of）
  completeness          TEXT DEFAULT 'COCKPIT_CONTEXT', -- COCKPIT_CONTEXT | MARKET_ONLY | COCKPIT_STALE
  source_url            TEXT,                 -- 「来源」列里的飞书 wiki 链接
  raw_json              TEXT NOT NULL,        -- 原始行留底（审计/回放）
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cockpit_membership ON cockpit_facts(membership_status);

-- ② 岗位方向分类（LLM 产出；市场源每岗一行）
--    primary_direction 枚举见 PRD §06：PAID_ACQUISITION / GROWTH_LEADERSHIP /
--    GTM_LEADERSHIP / DTC_GROWTH / MARKETING_LEADERSHIP / PRODUCT / ENGINEERING / DESIGN / ...
CREATE TABLE IF NOT EXISTS job_classifications (
  project_id              TEXT PRIMARY KEY REFERENCES job_facts(project_id) ON DELETE CASCADE,
  primary_direction       TEXT NOT NULL,      -- 主方向（枚举）
  secondary_directions    TEXT NOT NULL DEFAULT '[]', -- JSON[] 次方向
  is_leadership           INTEGER NOT NULL DEFAULT 0, -- 0/1 是否带团队/负责人岗
  role_semantic_confidence REAL DEFAULT 0,    -- 0..1
  matched_terms           TEXT NOT NULL DEFAULT '[]', -- JSON[] 命中关键词
  excluded_terms          TEXT NOT NULL DEFAULT '[]', -- JSON[] 排除词（判负依据）
  classification_version  TEXT NOT NULL,      -- 分类器版本（llm-v1 / rules-v1）
  evidence                TEXT NOT NULL DEFAULT '[]', -- JSON[] 判据
  updated_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_direction ON job_classifications(primary_direction);

-- ③ 岗位 HC 占用（PRD §05 occupancy_status 状态机）
--    occupancy_status：OPEN | RESERVED_PENDING | FILLED | FILLED_ARCHIVED | CLOSED | UNKNOWN
CREATE TABLE IF NOT EXISTS job_occupancy (
  project_id        TEXT PRIMARY KEY REFERENCES job_facts(project_id) ON DELETE CASCADE,
  headcount_total   INTEGER DEFAULT NULL,     -- 总 HC（从职位/方向标签抽取，如「2-3 HC」）
  filled_current    INTEGER NOT NULL DEFAULT 0,
  reserved_current  INTEGER NOT NULL DEFAULT 0,
  remaining_hc      INTEGER DEFAULT NULL,     -- headcount_total - filled - reserved
  offer_status      TEXT,                      -- 待 Offer / 已 Offer
  onboarding_status TEXT,                      -- 已入职 / Onboarding 中
  occupancy_status  TEXT NOT NULL DEFAULT 'UNKNOWN'
                    CHECK (occupancy_status IN
    ('OPEN','RESERVED_PENDING','FILLED','FILLED_ARCHIVED','CLOSED','UNKNOWN','SOURCE_CONFLICT')),
  as_of             TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
