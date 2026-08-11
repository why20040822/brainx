/** adapter.js - TTC/驾驶舱 CSV -> 标准库格式适配器（PRD 1.2 LLM Adapter）。
 *
 * 两份原始 CSV（飞书/Excel 导出，脏数据）-> PRD 1.2 标准库格式：
 *   ① 公司岗位情况-Shanon - Sheet1.csv  = 市场源 -> job_facts + job_classifications
 *   ② Felix｜投放增长营销项目池.csv       = 驾驶舱源 -> job_facts(桩) + cockpit_facts + job_occupancy
 *
 * 大模型用于把脏文本分类到枚举（PRD §06 方向、§03 membership/stage）；
 * 未配 LLM key 时走确定性关键词回退（与 bitable.js mapPriority 同一哲学，离线可跑）。
 *
 * project_id 复用 bitable.js 的 deriveProjectId(company, role)：CSV 源与 fixture/bridge
 * 源同公司同岗行同 ID 自然合并。事实落库复用 sync.js 的 runSync（sync_runs + job_facts
 * UPSERT + 事实/关系分离），三张 PRD 1.2 新表由本模块单独 UPSERT（0008 迁移）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.js';
import { deriveProjectId } from './bitable.js';
import { runSync } from './sync.js';
import { now } from './db.js';
import { isLlmConfigured, chatJson } from './llm.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 默认两份 CSV 就放在项目根（用户上传位置）。 */
export const DEFAULT_MARKET_CSV = join(ROOT, '公司岗位情况-Shanon - Sheet1.csv');
export const DEFAULT_COCKPIT_CSV = join(ROOT, 'Felix｜投放增长营销项目池 - 项目录入.csv');

// ---- PRD §06 方向枚举 ----
export const DIRECTIONS = [
  'PAID_ACQUISITION', 'GROWTH_LEADERSHIP', 'GTM_LEADERSHIP', 'DTC_GROWTH',
  'MARKETING_LEADERSHIP', 'PRODUCT', 'ENGINEERING', 'DESIGN',
  'OPERATIONS', 'SALES', 'FINANCE', 'OTHER',
];
const DIRECTION_LABEL = {
  PAID_ACQUISITION: '海外投放/效果营销/付费获客',
  GROWTH_LEADERSHIP: '增长负责人/Growth Lead/Head of Growth/CMO',
  GTM_LEADERSHIP: 'GTM/Go-to-market/商业化/产品市场',
  DTC_GROWTH: 'DTC/独立站/电商增长',
  MARKETING_LEADERSHIP: '市场负责人/Marketing/Brand/PR/Media/社媒',
  PRODUCT: '产品经理/产品',
  ENGINEERING: '后端/前端/Agent工程/研发/运维',
  DESIGN: 'UIUX/设计',
  OPERATIONS: '运营/社群/达人/KOL/创作者',
  SALES: '销售/商务/BD',
  FINANCE: '财务/融资/FA',
  OTHER: '其他',
};

// ============================================================================
// ① 市场源解析（公司岗位情况 CSV -> job_facts 形状行）
// ============================================================================

/** 把一个单元格里的多岗文本拆成岗位数组：按换行 + 「、」切，去空白。
 *  不按「，」切——「C端，2-1 2-2」这类是单岗描述，切了会碎。 */
const splitRoles = (cell) =>
  (cell || '')
    .split(/\r?\n/)
    .flatMap((line) => line.split('、'))
    .map((s) => s.trim())
    .filter(Boolean);

/** 职能列定义：下标 + 列名（分类提示）+ 方向 hint。 */
const CATEGORY_COLS = [
  { idx: 3, name: 'AI产品', hint: 'product' },
  { idx: 4, name: '运营', hint: 'growth' },
  { idx: 5, name: 'UIUX设计', hint: 'design' },
  { idx: 6, name: '研发or其他', hint: 'engineering' },
];

/**
 * 解析市场 CSV -> job_facts 形状行数组。
 * 表头有两种：4 职能列（AI产品/运营/UIUX/研发）或单「岗位」列；统一扫 col3-6 收岗，
 * 用列名当分类提示。「不活跃岗位」分段之后的行 -> active_state=COOLING。
 */
export function parseMarketCsv(text) {
  const rows = parseCsv(text);
  const out = [];
  let inactive = false;
  for (const row of rows) {
    const c0 = (row[0] || '').trim();
    if (!c0) continue;
    if (c0 === '公司') continue;              // 表头行（两种表头都以此开头）
    if (c0 === '不活跃岗位') { inactive = true; continue; } // 分段标题

    const company = c0.replace(/[\r\n]+/g, ''); // 公司名去内部换行（"Mach\nine"->"Machine"），保留空格（"Aether AI"）
    const city = (row[1] || '').trim() || null;
    const companyType = (row[2] || '').trim() || null;
    const activeState = inactive ? 'COOLING' : 'OPEN';

    // 扫 col3-6 收岗；单「岗位」列表头时岗在 col3，col4-6 空，同样被收进 AI产品列桶。
    for (const cat of CATEGORY_COLS) {
      const roles = splitRoles(row[cat.idx]);
      for (const role of roles) {
        out.push({
          project_id: deriveProjectId(company, role),
          company, role, city, company_type: companyType,
          active_state: activeState, priority: null, notes: null,
          pipeline: null, hc: null, source_url: null,
          category: cat.name, direction_hint: cat.hint,
          relation: null, // 事实/关系分离（与 feishu 源同一纪律）
        });
      }
    }
  }
  return out;
}

// ============================================================================
// ② 驾驶舱源解析（Felix 项目池 CSV -> cockpit_facts 形状行）
// ============================================================================

const MEMBERSHIP_RULES = [
  [/共同参与|共同校准/, 'PARTICIPANT'],
  [/已参与|Felix已开展|Felix已/, 'PRIMARY_PM'],
  [/驾驶舱推荐|源表/, 'MENTIONED'],
  [/未加入|待判断/, 'UNCONFIRMED'],
];
const STAGE_RULES = [
  [/已参与|共同参与/, 'ACTIVE_ADVANCEMENT'],
  [/驾驶舱推荐|待判断/, 'NEW_VALIDATION'],
  [/未加入/, 'UNCONFIRMED'],
];
const PRIORITY_MAP = { P0: 'HIGH', P1: 'NORMAL', P2: 'STANDBY' };

/** 从「当前状态+关系依据」映射 membership_status（PRD §03 枚举）。 */
export function mapMembership(currentStatus, relationBasis) {
  const s = `${currentStatus || ''} ${relationBasis || ''}`;
  for (const [re, v] of MEMBERSHIP_RULES) if (re.test(s)) return v;
  return 'UNCONFIRMED';
}
/** 从「当前状态」映射 current_stage。 */
export function mapStage(currentStatus) {
  for (const [re, v] of STAGE_RULES) if (re.test(currentStatus || '')) return v;
  return 'UNCONFIRMED';
}

/** 从文本抽 HC 数字（「2-3 HC」「2–3 HC」「HC=1」「5 HC」）-> 总数（取区间上界）。 */
export function extractHc(text) {
  const t = text || '';
  const range = t.match(/(\d+)\s*[-–~]\s*(\d+)\s*HC/i); // 区间：2-3 HC
  if (range) return Number(range[2]);
  const eq = t.match(/HC\s*=\s*(\d+)/i);                // HC=1
  if (eq) return Number(eq[1]);
  const single = t.match(/(\d+)\s*HC/i);                // 5 HC
  if (single) return Number(single[1]);
  return null;
}

/**
 * 解析驾驶舱 CSV -> cockpit_facts 形状行数组。
 * 列：客户,职位,方向标签,优先级,当前状态,关系依据,岗位核心,下一步动作,来源
 */
export function parseCockpitCsv(text) {
  const rows = parseCsv(text);
  const out = [];
  let inData = false;
  for (const row of rows) {
    if ((row[0] || '').trim() === '客户') { inData = true; continue; } // 列头
    if (!inData) continue; // 标题/说明行
    const client = (row[0] || '').trim();
    const position = (row[1] || '').trim();
    if (!client || !position) continue;
    const directionTags = (row[2] || '').trim();
    const priorityRaw = (row[3] || '').trim();
    const currentStatus = (row[4] || '').trim();
    const relationBasis = (row[5] || '').trim();
    const jobCore = (row[6] || '').trim();
    const nextAction = (row[7] || '').trim();
    const source = (row[8] || '').trim();

    const sourceUrl = /^https?:\/\//.test(source) ? source : null;
    out.push({
      project_id: deriveProjectId(client, position),
      company: client, role: position,
      membership_status: mapMembership(currentStatus, relationBasis),
      current_stage: mapStage(currentStatus),
      stage_confidence: 0.5, // 规则回退置信度；LLM 会覆盖
      pipeline_snapshot: jobCore || null,
      next_action: nextAction || null,
      source_url: sourceUrl,
      priority: PRIORITY_MAP[priorityRaw] || null,
      notes: jobCore || null,
      hc: extractHc(`${position} ${directionTags}`),
      direction_tags: directionTags,
      current_status: currentStatus,
      relation_basis: relationBasis,
      raw: { client, position, directionTags, priority: priorityRaw, currentStatus, relationBasis, jobCore, nextAction, source },
    });
  }
  return out;
}

// ============================================================================
// ③ 分类：LLM 主路 + 确定性回退
// ============================================================================

const DIRECTION_RULES = [
  [/投放|效果营销|paid|acquisition|广告/i, 'PAID_ACQUISITION'],
  [/增长负责人|growth\s*lead|head\s*of\s*growth|增长操盘|cmo/i, 'GROWTH_LEADERSHIP'],
  [/gtm|go.?to.?market|商业化|产品市场/i, 'GTM_LEADERSHIP'],
  [/dtc|独立站|电商增长/i, 'DTC_GROWTH'],
  [/市场负责人|marketing|brand|品牌|\bpr\b|media|社媒/i, 'MARKETING_LEADERSHIP'],
  [/产品/, 'PRODUCT'],
  [/后端|前端|agent工程|研发|运维|工程/i, 'ENGINEERING'],
  [/uiux|设计|design/i, 'DESIGN'],
  [/运营|社群|达人|kol|创作者/i, 'OPERATIONS'],
  [/销售|商务|\bbd\b/i, 'SALES'],
  [/财务|融资|\bfa\b/i, 'FINANCE'],
];
const LEADERSHIP_RE = /负责人|lead|head|cmo|总监|leader|chief|vp|主管/i;

/** 确定性回退：从 role 文本 + hint 推方向。 */
export function classifyJobFallback(role, hint) {
  const text = `${role} ${hint || ''}`;
  for (const [re, dir] of DIRECTION_RULES) if (re.test(text)) return dir;
  // hint 兜底（role 文本没命中关键词时，按职能列 hint）
  if (hint === 'product') return 'PRODUCT';
  if (hint === 'growth') return 'OPERATIONS';
  if (hint === 'design') return 'DESIGN';
  if (hint === 'engineering') return 'ENGINEERING';
  return 'OTHER';
}

/** 分类市场岗 -> {project_id -> classification}。LLM 主路，失败/未配走回退。 */
export async function classifyJobs(marketRows) {
  const fallback = () => marketRows.map((r) => ({
    project_id: r.project_id,
    primary_direction: classifyJobFallback(r.role, r.direction_hint),
    secondary_directions: [],
    is_leadership: LEADERSHIP_RE.test(r.role),
    confidence: 0.5,
    matched_terms: [],
    classification_version: 'rules-v1',
    evidence: [{ source: 'keyword-rules', role: r.role }],
  }));

  if (!isLlmConfigured()) return new Map(fallback().map((c) => [c.project_id, c]));

  const system = `你是招聘职位方向分类器。把职位名分类到标准方向枚举，并判断是否带团队/负责人岗。
方向枚举与含义：
${DIRECTIONS.map((d) => `- ${d}：${DIRECTION_LABEL[d]}`).join('\n')}
只返回 JSON：{"results":[{"project_id":"...","primary_direction":"枚举之一","secondary_directions":["枚举"],"is_leadership":true/false,"confidence":0.0-1.0,"matched_terms":["命中的词"]}]}
confidence：方向很明确 0.9+，较明确 0.7，模糊 0.5。`;
  const user = JSON.stringify(marketRows.map((r) => ({
    project_id: r.project_id, role: r.role,
    category_hint: r.category, company_type: r.company_type,
  })));
  try {
    const out = await chatJson(system, user);
    const map = new Map(fallback().map((c) => [c.project_id, c])); // 先填回退兜底
    for (const r of (out.results || [])) {
      if (!r.project_id) continue;
      map.set(r.project_id, {
        project_id: r.project_id,
        primary_direction: DIRECTIONS.includes(r.primary_direction) ? r.primary_direction : 'OTHER',
        secondary_directions: (r.secondary_directions || []).filter((d) => DIRECTIONS.includes(d)),
        is_leadership: !!r.is_leadership,
        confidence: Number(r.confidence) || 0.5,
        matched_terms: r.matched_terms || [],
        classification_version: 'llm-v1',
        evidence: [{ source: 'llm', matched: r.matched_terms || [] }],
      });
    }
    return map;
  } catch (e) {
    process.emitWarning(`LLM 分类失败，走关键词回退：${e.message}`);
    return new Map(fallback().map((c) => [c.project_id, c]));
  }
}

/** 分类驾驶舱 -> {project_id -> {membership_status, current_stage, stage_confidence}}。LLM 主路。 */
export async function classifyCockpit(cockpitRows) {
  const fallback = () => cockpitRows.map((r) => ({
    project_id: r.project_id,
    membership_status: r.membership_status,
    current_stage: r.current_stage,
    stage_confidence: r.stage_confidence,
  }));

  if (!isLlmConfigured()) return new Map(fallback().map((c) => [c.project_id, c]));

  const system = `你是猎头项目驾驶舱分类器。根据「当前状态」和「关系依据」判断 membership_status 和 current_stage。
membership_status 枚举：PRIMARY_PM(本人已开展/主做), PARTICIPANT(共同参与/共同校准), MENTIONED(驾驶舱推荐/源表复制/提及), UNCONFIRMED(未加入/待判断)。
current_stage 枚举：ACTIVE_ADVANCEMENT(已参与/推进中), NEW_VALIDATION(待判断/新验证), UNCONFIRMED(未加入/未确认), RESULT_CLOSURE(结案/Offer阶段)。
只返回 JSON：{"results":[{"project_id":"...","membership_status":"枚举","current_stage":"枚举","stage_confidence":0.0-1.0}]}`;
  const user = JSON.stringify(cockpitRows.map((r) => ({
    project_id: r.project_id,
    当前状态: r.current_status, 关系依据: r.relation_basis, 岗位核心: r.pipeline_snapshot,
  })));
  try {
    const out = await chatJson(system, user);
    const map = new Map(fallback().map((c) => [c.project_id, c]));
    for (const r of (out.results || [])) {
      if (!r.project_id) continue;
      map.set(r.project_id, {
        project_id: r.project_id,
        membership_status: ['PRIMARY_PM', 'PARTICIPANT', 'MENTIONED', 'UNCONFIRMED']
          .includes(r.membership_status) ? r.membership_status : 'UNCONFIRMED',
        current_stage: r.current_stage || map.get(r.project_id).current_stage,
        stage_confidence: Number(r.stage_confidence) || 0.7,
      });
    }
    return map;
  } catch (e) {
    process.emitWarning(`LLM 驾驶舱分类失败，走规则回退：${e.message}`);
    return new Map(fallback().map((c) => [c.project_id, c]));
  }
}

// ============================================================================
// ④ 编排：解析 -> 分类 -> 落库
// ============================================================================

/**
 * 跑一次适配。返回汇总（与 runSync 同一 complete/errors 契约）。
 * dry_run=true 时只打印标准化 JSON，不落库。
 */
export async function runAdapter(db, {
  dry_run = false, marketCsv = DEFAULT_MARKET_CSV, cockpitCsv = DEFAULT_COCKPIT_CSV,
  consultant_id = 'felix',
} = {}) {
  const t0 = now();
  const marketRows = parseMarketCsv(readFileSync(marketCsv, 'utf8'));
  const cockpitRows = parseCockpitCsv(readFileSync(cockpitCsv, 'utf8'));

  const jobClasses = await classifyJobs(marketRows);
  const cockpitClasses = await classifyCockpit(cockpitRows);

  // 驾驶舱行也作为 job_facts 桩（项目 = 客户×职位），保证 cockpit_facts FK 成立。
  // 与市场行合并去重（同 project_id 优先市场的 fuller 字段，驾驶舱补 priority/notes）。
  const jobsByPid = new Map();
  for (const r of marketRows) {
    jobsByPid.set(r.project_id, { ...r, captured_at: t0 });
  }
  for (const c of cockpitRows) {
    if (jobsByPid.has(c.project_id)) {
      // 已有市场行：补驾驶舱带的 priority/notes（市场行这俩为 null）
      const ex = jobsByPid.get(c.project_id);
      if (!ex.priority && c.priority) ex.priority = c.priority;
      if (!ex.notes && c.notes) ex.notes = c.notes;
    } else {
      jobsByPid.set(c.project_id, {
        project_id: c.project_id, company: c.company, role: c.role,
        city: null, company_type: null, active_state: 'OPEN',
        priority: c.priority, notes: c.notes, pipeline: null,
        hc: c.hc, source_url: c.source_url, relation: null, captured_at: t0,
      });
    }
  }
  const jobs = [...jobsByPid.values()];

  if (dry_run) {
    return {
      sync_id: '(dry-run)', source: 'adapter', consultant_id, as_of: t0,
      rows: { market: marketRows.length, cockpit: cockpitRows.length, jobs: jobs.length },
      job_facts: jobs,
      job_classifications: [...jobClasses.values()],
      cockpit_facts: cockpitRows.map((c) => {
        const k = cockpitClasses.get(c.project_id);
        return {
          project_id: c.project_id, membership_status: k?.membership_status,
          current_stage: k?.current_stage, stage_confidence: k?.stage_confidence,
          pipeline_snapshot: c.pipeline_snapshot, next_action: c.next_action,
          source_url: c.source_url, raw: c.raw,
        };
      }),
      job_occupancy: cockpitRows.filter((c) => c.hc != null).map((c) => ({
        project_id: c.project_id, headcount_total: c.hc,
        filled_current: 0, reserved_current: 0, remaining_hc: c.hc,
        occupancy_status: 'OPEN', as_of: t0,
      })),
    };
  }

  // ---- 落库：复用 runSync 写 sync_runs + job_facts（事实/关系分离，relation=null）----
  const syncOut = runSync(db, {
    source: 'adapter', consultant_id, dry_run: false,
    payload: { as_of: t0, jobs },
  });

  // ---- 三张 PRD 1.2 新表（0008）----
  db.exec('BEGIN');
  try {
    const upsertClass = db.prepare(`INSERT INTO job_classifications
      (project_id, primary_direction, secondary_directions, is_leadership,
       role_semantic_confidence, matched_terms, excluded_terms, classification_version, evidence, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET
        primary_direction=excluded.primary_direction, secondary_directions=excluded.secondary_directions,
        is_leadership=excluded.is_leadership, role_semantic_confidence=excluded.role_semantic_confidence,
        matched_terms=excluded.matched_terms, excluded_terms=excluded.excluded_terms,
        classification_version=excluded.classification_version, evidence=excluded.evidence, updated_at=excluded.updated_at`);
    for (const c of jobClasses.values()) {
      upsertClass.run(c.project_id, c.primary_direction,
        JSON.stringify(c.secondary_directions), c.is_leadership ? 1 : 0,
        c.confidence, JSON.stringify(c.matched_terms), JSON.stringify([]),
        c.classification_version, JSON.stringify(c.evidence), now());
    }

    const upsertCockpit = db.prepare(`INSERT INTO cockpit_facts
      (project_id, membership_status, current_stage, stage_confidence, pipeline_snapshot,
       next_action, client_feedback_refs, weekly_report_refs, last_activity_at, cockpit_as_of,
       completeness, source_url, raw_json, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET
        membership_status=excluded.membership_status, current_stage=excluded.current_stage,
        stage_confidence=excluded.stage_confidence, pipeline_snapshot=excluded.pipeline_snapshot,
        next_action=excluded.next_action, cockpit_as_of=excluded.cockpit_as_of,
        completeness=excluded.completeness, source_url=excluded.source_url,
        raw_json=excluded.raw_json, updated_at=excluded.updated_at`);
    for (const c of cockpitRows) {
      const k = cockpitClasses.get(c.project_id);
      upsertCockpit.run(c.project_id, k?.membership_status || 'UNCONFIRMED',
        k?.current_stage || null, k?.stage_confidence || 0.5,
        c.pipeline_snapshot, c.next_action, JSON.stringify([]), JSON.stringify([]),
        null, t0, 'COCKPIT_CONTEXT', c.source_url, JSON.stringify(c.raw), now());
    }

    const upsertOcc = db.prepare(`INSERT INTO job_occupancy
      (project_id, headcount_total, filled_current, reserved_current, remaining_hc,
       offer_status, onboarding_status, occupancy_status, as_of, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET
        headcount_total=excluded.headcount_total, filled_current=excluded.filled_current,
        reserved_current=excluded.reserved_current, remaining_hc=excluded.remaining_hc,
        offer_status=excluded.offer_status, onboarding_status=excluded.onboarding_status,
        occupancy_status=excluded.occupancy_status, as_of=excluded.as_of, updated_at=excluded.updated_at`);
    for (const c of cockpitRows) {
      if (c.hc == null) continue;
      upsertOcc.run(c.project_id, c.hc, 0, 0, c.hc, null, null, 'OPEN', t0, now());
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return {
    sync_id: syncOut.sync_id, source: 'adapter', consultant_id, as_of: t0,
    complete: syncOut.complete, errors: syncOut.errors,
    rows: { market: marketRows.length, cockpit: cockpitRows.length,
            jobs: jobs.length, classifications: jobClasses.size,
            cockpit_facts: cockpitRows.length, occupancy: cockpitRows.filter((c) => c.hc != null).length },
    llm: isLlmConfigured() ? 'on' : 'off (规则回退)',
  };
}
