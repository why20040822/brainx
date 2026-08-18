// brainx-api.ts — Brain X 后端（btex/brainx）HTTP 适配层。
// 前端唯一数据通道：页面不得直接 fetch /api；全部请求与映射集中在这里。
// 后端契约见 brainx/src/server.js 与 README「后端接入」章节。
//
// 纯函数映射器（map*/of*）不依赖浏览器环境，供 tests/brainx-adapter.test.mjs 直接单测。
// 请求函数只在浏览器端调用；SSR（npm run build）期间不会触发任何网络请求。
import type {
  DecisionEvent,
  EngagementCommand,
  EngagementState,
  Notification,
  Outcome,
  SyncStatus,
} from "./decision-demo";

// —— 与 workbench.tsx 的 DecisionJob 结构一致的映射结果（结构类型，避免循环依赖）——
export type BrainxDirection = "paid" | "growth" | "marketing";
export type BrainxGroup =
  | "RESULT_CLOSURE" | "ACTIVE_ADVANCEMENT" | "NEW_VALIDATION" | "MAINTENANCE" | "EXCLUDE";
export type BrainxEligibility = "ELIGIBLE" | "VERIFY_REQUIRED" | "BLOCKED" | "EXCLUDED";
export type BrainxDecisionAction = {
  id: string; label: string;
  kind: "verify" | "advance" | "watch" | "skip";
  detail: string;
};
export type ManualFactField =
  | "active_state" | "current_stage" | "pipeline_snapshot"
  | "remaining_hc" | "next_action" | "notes";
export type BrainxFactField = {
  value: string | number | null;
  effective_value: string | number | null;
  source: "SYNC" | "MANUAL" | "UNKNOWN";
  updated_at: string | null;
};
export type BrainxFactFields = Partial<Record<ManualFactField, BrainxFactField>>;
export type BrainxJob = {
  id: string; rank: number; company: string; role: string;
  direction: BrainxDirection; sourceMode: "COCKPIT_CONTEXT" | "MARKET_ONLY";
  group: BrainxGroup; eligibility: BrainxEligibility;
  globalScore: number | string; explorationScore: number | string;
  personalScore: number | string; finalScore: number | string;
  evidenceCoverage: number | null;
  recommendation: string; recentSignal: string;
  facts: Record<string, string>; scoreNotes: string[];
  factFields?: BrainxFactFields;
  risks: string[]; evidence: string[]; actions: BrainxDecisionAction[];
  brainxLegal?: EngagementCommand[]; brainxDecisionId?: string;
};

export type BrainxSnapshot = {
  jobs: BrainxJob[];
  engagement: Record<string, EngagementState>;
  events: Record<string, DecisionEvent[]>;
  outcomes: Record<string, Outcome[]>;
  legal: Record<string, EngagementCommand[]>;
  sync: SyncStatus;
  auth: { consultant: string; authorized: boolean; needsReauth: boolean };
  notifications: Notification[];
  dismissReasons: string[];
  runId: string | null;
  snapshotId: string | null;
  policyVersion: string | null;
  profileKeywords: string[];
};

export type BrainxReplay = {
  decisionId: string;
  snapshotAt: string;
  policyVersion: string;
  rank: number;
  reasons: string[];
  risks: string[];
  evidence: string[];
  events: DecisionEvent[];
  outcomes: Outcome[];
};

export type BrainxErrorPayload = { error?: { code?: string; message?: string } } & Record<string, unknown>;

type BackendEvidenceRef = { type?: string; ref?: string; excerpt?: string };
type BackendBreakdown = { dim: string; weight: number; score: number | null };
type BackendJob = {
  project_id: string; company?: string; role?: string; city?: string | null;
  pipeline?: string | null; hc?: number | null; active_state?: string | null;
  priority?: string | null; notes?: string | null; company_type?: string | null;
  current_stage?: string | null; pipeline_snapshot?: string | null; next_action?: string | null;
  fact_sources?: Partial<Record<ManualFactField, string>>;
  fact_updated_at?: Partial<Record<ManualFactField, string | null>>;
  source_url?: string | null; captured_at?: string | null; relation?: string | null;
};
export type BackendRecommendation = {
  decision_id: string; rank: number; action: string; score: number;
  confidence_band: string; evidence_coverage: number;
  reasons: string[]; risks: string[]; evidence_refs: BackendEvidenceRef[];
  breakdown?: BackendBreakdown[]; job: BackendJob;
};
export type BackendSync = {
  state: string; updated_at?: string | null; rows_read?: number | null;
  rows_expected?: number | null; errors?: string[];
};
export type BackendCommitment = {
  project_id: string; state: EngagementState; state_since?: string | null;
  company?: string | null; role?: string | null; active_state?: string | null; next_action?: string | null;
};
export type BackendWorkbench = {
  consultant_id: string; sync: BackendSync; feishu_auth?: { authorized?: boolean; needs_reauth?: boolean };
  ttc_auth?: Record<string, unknown>; current_policy_version?: string | null;
  watched_count?: number; watched_limit?: number; accepted_count?: number; cooldown_count?: number;
  need_action_count?: number; commitments?: BackendCommitment[]; today_top3?: BackendRecommendation[];
  run_id?: string | null;
};
export type BackendRecommendations = {
  blocked: boolean; reason?: string; run_id?: string | null; snapshot_id?: string | null;
  policy_version?: string | null; generated_at?: string; items: BackendRecommendation[]; empty?: boolean;
};
export type BackendOpportunity = {
  job: BackendJob & { raw_json?: never }; fact_updates?: BrainxFactFields;
  relation: { relation: string | null; source?: string | null; valid_from?: string | null };
  engagement_state: EngagementState; legal_actions: EngagementCommand[];
  events: BackendEvent[]; outcomes: BackendOutcome[]; latest_recommendation: BackendLatestRecommendation | null;
};
export type BackendEvent = { event_type: string; occurred_at?: string; actor?: string; reason?: string | null };
export type BackendOutcome = { stage: string; observed_at?: string; value?: { rating?: number; note?: string } | null };
export type BackendLatestRecommendation = {
  decision_id: string; score: number; action: string; confidence_band?: string;
  evidence_coverage?: number; reasons: string[]; risks: string[]; evidence_refs: BackendEvidenceRef[];
  breakdown?: BackendBreakdown[]; policy_version?: string; created_at?: string;
};
export type BackendReplay = {
  decision_id: string; run?: { run_id: string; snapshot_id: string; policy_version: string; created_at: string; candidate_count: number } | null;
  recommendation: BackendLatestRecommendation & { project_id: string; rank: number; score_breakdown?: BackendBreakdown[] };
  job_now?: { company?: string; role?: string; active_state?: string; note?: string } | null;
  events: BackendEvent[]; outcomes: BackendOutcome[];
};
export type BackendProfile = { consultant_id: string; display_name: string; profile_keywords: string[]; profile_note: string; feishu_auth?: { authorized?: boolean; needs_reauth?: boolean } };
export type BackendRadarRow = BackendJob & { engagement_state?: EngagementState; cockpit?: { membership_status?: string | null; current_stage?: string | null; stage_confidence?: string | null; pipeline_snapshot?: string | null; next_action?: string | null; cockpit_as_of?: string | null; completeness?: string | null; source_url?: string | null } | null };
export type BackendClientRow = { company: string; company_type?: string | null; job_count?: number; active_jobs?: number; hc_known?: number | null; last_activity?: string | null; relations?: string[]; states?: string[] };
export type BackendDismissReasons = { items: string[] };
export type BackendSessionStatus = { configured: boolean; dev_auth: boolean };
export type BackendSseEvent = { type?: "hello" | "sync" | "recommend" | "sync_error"; message?: string; consultant_id?: string; at?: string };
export type BackendConsultants = { items: { consultant_id: string; display_name: string }[] };
export type BackendEngagementResponse = { ok: boolean; already?: boolean; event_id?: string; state: EngagementState; legal_actions: EngagementCommand[] };
export type BackendRecommendationRun = { blocked?: boolean; reason?: string; run_id?: string | null; items?: BackendRecommendation[] };
export type BackendOutcomeResponse = { ok: boolean; already?: boolean; outcome_id?: string | number };
export type BackendProfileUpdate = { ok: boolean; consultant_id: string; profile_keywords?: string[]; profile_note?: string };
export type AssistantMessage = { role: "user" | "assistant"; content: string };
export type AssistantContext = { page: string; opportunity_id?: string | null };
export type AssistantChatOptions = { question: string; history: AssistantMessage[]; context: AssistantContext; signal?: AbortSignal };

export class BrainxApiError extends Error {
  status: number;
  code: string | undefined;
  payload: BrainxErrorPayload | undefined;
  kind: "AUTH" | "CONFLICT" | "VALIDATION" | "UNAVAILABLE" | "HTTP";
  constructor(message: string, status = 0, code?: string, payload?: BrainxErrorPayload) {
    super(message);
    this.status = status;
    this.code = code;
    this.payload = payload;
    this.kind = status === 401 || status === 403 ? "AUTH"
      : status === 409 ? "CONFLICT"
      : status === 400 || status === 422 ? "VALIDATION"
      : status >= 500 ? "UNAVAILABLE" : "HTTP";
  }
}

// —— 词典（与后端 src/*.js 的枚举对齐，前端仅用于展示标签，不做业务判断）——
export const RELATION_LABELS: Record<string, string> = {
  MY_JOB: "我的职位",
  PRIMARY_PM: "我是主 PM",
  TEAM_SHARED: "团队共享",
  OTHER_CONSULTANT: "其他顾问主做",
  NOT_JOINED: "未加入",
  UNKNOWN: "UNKNOWN",
};

export const ACTIVE_STATE_LABELS: Record<string, string> = {
  OPEN: "招聘中",
  COOLING: "冷却期",
  CLOSED: "已关闭",
  COMPLETED: "已完成",
};

export const PRIORITY_LABELS: Record<string, string> = {
  HIGH: "高", NEW: "新", NORMAL: "普通", STANDBY: "待命",
};

export const BACKEND_ACTION_LABELS: Record<string, string> = {
  RECOMMEND_ACCEPT: "建议接单",
  RECOMMEND_WATCH: "建议关注",
  OBSERVE: "先观察验证",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  VIEWED: "已查看",
  RECOMMENDED: "已推荐",
  WATCHED: "已关注",
  ACCEPTED: "已接单",
  DISMISSED: "暂不考虑",
  RELEASED: "已释放",
  COMPLETED: "已完成",
  EXPIRED: "已过期",
};

export const FALLBACK_DISMISS_REASONS = [
  "无资源", "不符合方向", "客户/职位质量不足", "当前没精力", "已有其他顾问推进", "信息不完整", "其他",
];

// 后端 scorer.js 固定六维权重（判断策略页只读展示；前端不得重算排序）
export const BACKEND_WEIGHTS: { dim: string; label: string; weight: string }[] = [
  { dim: "direction", label: "职位方向匹配", weight: "25%" },
  { dim: "activity", label: "项目活跃度与 Pipeline", weight: "20%" },
  { dim: "similarity", label: "与历史项目相似度", weight: "15%" },
  { dim: "capacity", label: "当前承接容量", weight: "15%" },
  { dim: "outcomes", label: "历史行为与交付结果", weight: "15%" },
  { dim: "exploration", label: "探索额度", weight: "10%" },
];

// —— 幂等键（PRD §4.3）：同一手势复用同一 key，in-flight 期间不清除 ——
export function makeIdempotencyKey(scope: string): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `web:${scope}:${uuid}`;
}

// —— 时间显示（后端 ISO → 本地短格式；纯展示）——
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// —— 派生规则：只做展示分组/资格标签，真正的排序与权限一律以后端为准 ——
export function directionOf(role: string): BrainxDirection {
  const r = String(role || "").toLowerCase();
  if (/投放|广告|优化师|\bsem\b|performance|paid/i.test(r)) return "paid";
  if (/市场|营销|品牌|公关|gtm|marketing|brand|cm/i.test(r)) return "marketing";
  return "growth";
}

export function eligibilityOf(action: string, relation: string, hc: number | null, activeState: string): BrainxEligibility {
  if (hc === 0 || activeState === "CLOSED" || activeState === "COMPLETED") return "EXCLUDED";
  if (relation === "NOT_JOINED" || relation === "OTHER_CONSULTANT" || relation === "UNKNOWN") return "VERIFY_REQUIRED";
  if (action === "OBSERVE") return "VERIFY_REQUIRED";
  return "ELIGIBLE";
}

export function groupOf(action: string, hc: number | null, activeState: string): BrainxGroup {
  if (hc === 0 || activeState === "CLOSED" || activeState === "COMPLETED") return "EXCLUDE";
  if (action === "OBSERVE") return "NEW_VALIDATION";
  if (action === "RECOMMEND_WATCH") return "MAINTENANCE";
  return "ACTIVE_ADVANCEMENT";
}

export function actionsOf(action: string, relation: string): BrainxDecisionAction[] {
  if (relation === "OTHER_CONSULTANT" || relation === "NOT_JOINED") {
    return [{ id: "ownership", label: "确认项目归属", kind: "verify", detail: "确认是否允许承接，或先与其他顾问沟通认领" }];
  }
  if (action === "RECOMMEND_ACCEPT") {
    return [{ id: "advance", label: "进入项目推进", kind: "advance", detail: "接单后按客户反馈窗口持续回写信号" }];
  }
  if (action === "RECOMMEND_WATCH") {
    return [{ id: "watch", label: "加入观察", kind: "watch", detail: "保留本周提醒，评估后再接单" }];
  }
  return [{ id: "verify", label: "核验关键事实", kind: "verify", detail: "补齐 HC 与阶段事实后再判断" }];
}

export function factsOf(
  job: { relation?: string; active_state?: string; current_stage?: string | null; hc?: number | null; captured_at?: string; pipeline?: string | null; pipeline_snapshot?: string | null; city?: string; priority?: string | null; company_type?: string | null; next_action?: string | null; notes?: string | null },
): Record<string, string> {
  const facts: Record<string, string> = {
    "职位关系": RELATION_LABELS[job.relation || ""] || job.relation || "UNKNOWN",
    "数据来源": "职位市场",
    "职位状态": ACTIVE_STATE_LABELS[job.active_state || ""] || job.active_state || "UNKNOWN",
    "当前阶段": job.current_stage || ACTIVE_STATE_LABELS[job.active_state || ""] || job.active_state || "UNKNOWN",
    // UNKNOWN 是未知事实：后端 hc=null 时原样展示 UNKNOWN，绝不写成 0
    "剩余 HC": job.hc == null ? "UNKNOWN" : String(job.hc),
    "最近活动": job.captured_at ? String(job.captured_at).slice(0, 10) : "UNKNOWN",
    "历史 Pipeline": job.pipeline_snapshot || job.pipeline || "暂无记录",
  };
  if (job.city) facts["城市"] = job.city;
  if (job.priority) facts["优先级"] = PRIORITY_LABELS[job.priority] || job.priority;
  if (job.company_type) facts["客户类型"] = job.company_type;
  if (job.next_action) facts["下一步动作"] = job.next_action;
  if (job.notes) facts["备注"] = job.notes;
  return facts;
}

function factFieldsOf(job: {
  active_state?: string; current_stage?: string | null; pipeline?: string | null;
  pipeline_snapshot?: string | null; hc?: number | null; next_action?: string | null;
  notes?: string | null; fact_sources?: Partial<Record<ManualFactField, string>>;
  fact_updated_at?: Partial<Record<ManualFactField, string | null>>;
}): BrainxFactFields {
  const valueOf: Record<ManualFactField, string | number | null> = {
    active_state: job.active_state || null,
    current_stage: job.current_stage || null,
    pipeline_snapshot: job.pipeline_snapshot ?? job.pipeline ?? null,
    remaining_hc: job.hc ?? null,
    next_action: job.next_action || null,
    notes: job.notes || null,
  };
  return Object.fromEntries(Object.entries(valueOf).map(([field, value]) => [field, {
    value,
    effective_value: value,
    source: (job.fact_sources?.[field as ManualFactField] || (value == null ? "UNKNOWN" : "SYNC")) as BrainxFactField["source"],
    updated_at: job.fact_updated_at?.[field as ManualFactField] || null,
  }])) as BrainxFactFields;
}

function breakdownDim(
  breakdown: { dim: string; weight: number; score: number | null }[] | undefined | null,
  dim: string,
): number | string {
  const found = breakdown?.find((b) => b.dim === dim);
  if (!found || found.score == null) return "—";
  return found.score;
}

/** 后端推荐项（/recommendations 或 /workbench.today_top3 的元素）→ 前端 DecisionJob。 */
export function mapRecommendation(rec: BackendRecommendation): BrainxJob {
  const job = rec.job;
  const relation = job.relation || "UNKNOWN";
  const coveragePct = Math.round((rec.evidence_coverage ?? 0) * 100);
  return {
    id: job.project_id,
    rank: rec.rank,
    company: job.company || "未知客户",
    role: job.role || "未知职位",
    direction: directionOf(job.role || ""),
    sourceMode: "MARKET_ONLY", // 后端 job_facts 来自职位市场源（Bitable 盘点 / fixture 导出）
    group: groupOf(rec.action, job.hc ?? null, job.active_state || ""),
    eligibility: eligibilityOf(rec.action, relation, job.hc ?? null, job.active_state || ""),
    globalScore: breakdownDim(rec.breakdown, "activity"),
    explorationScore: breakdownDim(rec.breakdown, "exploration"),
    personalScore: breakdownDim(rec.breakdown, "direction"),
    finalScore: rec.score,
    evidenceCoverage: coveragePct,
    recommendation: rec.reasons[0] || rec.risks[0] || BACKEND_ACTION_LABELS[rec.action] || rec.action,
    recentSignal: `${BACKEND_ACTION_LABELS[rec.action] || rec.action} · 证据覆盖 ${coveragePct}%`,
    facts: factsOf(job),
    factFields: factFieldsOf(job),
    scoreNotes: rec.reasons || [],
    risks: rec.risks || [],
    evidence: (rec.evidence_refs || []).map((e) => e.excerpt || e.ref || e.type || "快照记录"),
    actions: actionsOf(rec.action, relation),
  };
}

/** 后端 workbench.sync → 前端 SyncStatus。RUNNING 是本地瞬时态；AUTH_EXPIRED 由飞书授权推导。 */
export function mapSyncStatus(
  sync: { state: string; updated_at?: string | null; rows_read?: number | null; rows_expected?: number | null; errors?: string[] } | null | undefined,
  feishuAuth?: { needs_reauth?: boolean } | null,
): SyncStatus {
  if (feishuAuth?.needs_reauth) return { state: "AUTH_EXPIRED", updatedAt: null, errors: [] };
  const s = sync || { state: "EMPTY" };
  const state = s.state === "READY" ? "READY" : s.state === "INCOMPLETE" ? "INCOMPLETE" : "EMPTY";
  return {
    state,
    updatedAt: s.updated_at ? formatClock(s.updated_at) : null,
    rowsRead: s.rows_read ?? undefined,
    rowsExpected: s.rows_expected ?? undefined,
    errors: s.errors || [],
  };
}

export function mapEvents(
  events: { event_type: string; occurred_at?: string; actor?: string; reason?: string | null }[] | null | undefined,
): DecisionEvent[] {
  return (events || []).map((e) => ({
    id: `${e.event_type}:${e.occurred_at || ""}`,
    type: EVENT_TYPE_LABELS[e.event_type] || e.event_type,
    at: formatClock(e.occurred_at),
    reason: e.reason || undefined,
  }));
}

export function mapOutcomes(
  outcomes: { stage: string; observed_at?: string; value?: { rating?: number; note?: string } | null }[] | null | undefined,
): Outcome[] {
  return (outcomes || []).map((o) => ({
    id: `out:${o.stage}:${o.observed_at || ""}`,
    stage: o.stage as Outcome["stage"],
    rating: o.value?.rating,
    note: o.value?.note,
    at: formatClock(o.observed_at),
  }));
}

export function buildNotifications(
  wb: {
    sync?: { state?: string; updated_at?: string | null } | null;
    need_action_count?: number;
    today_top3?: { job?: { project_id?: string; company?: string } }[];
  },
  recs: { items?: { job?: { project_id?: string; company?: string } }[] },
): Notification[] {
  const notes: Notification[] = [];
  const syncState = wb.sync?.state;
  if (syncState === "READY") {
    notes.push({ id: "brainx-sync-ok", kind: "SYNC_ALERT", title: "同步状态正常", detail: "当前完整快照已进入本轮职位判断", read: false });
  } else if (syncState === "INCOMPLETE") {
    notes.push({ id: "brainx-sync-incomplete", kind: "SYNC_ALERT", title: "本次同步不完整", detail: "为避免误导，暂不生成正式推荐", read: false });
  }
  const top3 = (wb.today_top3 || recs.items || []).slice(0, 3);
  if (top3.length) {
    const names = top3.map((t) => t.job?.company).filter(Boolean).join("、");
    notes.push({
      id: "brainx-daily-top3", kind: "DAILY_TOP3", title: "今日 Top 3 已生成",
      detail: `${names || "今日推荐"} 等待判断`, jobId: top3[0].job?.project_id, read: false,
    });
  }
  if (wb.need_action_count && wb.need_action_count > 0) {
    notes.push({ id: "brainx-commit", kind: "COMMITMENT", title: `${wb.need_action_count} 个承接需要处理`, detail: "关注超过 7 天未推进，或接单后未回写结果", read: false });
  }
  return notes;
}

/** 后端 /decisions/:id/replay 响应 → 前端回放面板数据。 */
export function mapReplayData(r: BackendReplay): BrainxReplay {
  return {
    decisionId: r.decision_id,
    snapshotAt: formatClock(r.recommendation.created_at),
    policyVersion: r.recommendation.policy_version || "—",
    rank: r.recommendation.rank ?? 0,
    reasons: r.recommendation.reasons || [],
    risks: r.recommendation.risks || [],
    evidence: (r.recommendation.evidence_refs || []).map((e) => e.excerpt || e.ref || e.type || "快照记录"),
    events: mapEvents(r.events),
    outcomes: mapOutcomes(r.outcomes),
  };
}

// —— 职位雷达 / 客户洞察（GET /api/v1/radar、/api/v1/clients）——
// 纪律：只呈现事实；后端没有的运营指标（评分/转化/招聘意愿）一律 null/待后端，不补造。

export type RadarPositionType = "技术" | "产品" | "运营" | "算法" | "设计" | "商业化";
export type RadarJobStatus = "待同步" | "活跃" | "降温" | "已关闭";

export type RadarJob = {
  id: string;
  name: string;
  client: string;
  industry: string;
  city: string;
  pm: string;
  status: RadarJobStatus;
  score: number | null;
  hc: number | null;
  feedback: string;
  recommended: number | null;
  interview: number | null;
  offer: number | null;
  reason: string;
  salary: string;
  source: "市场信号" | "驾驶舱导入";
  positionType: RadarPositionType;
  sourceColumn?: string;
};

export type RadarClient = {
  name: string;
  industry: string;
  state: string;
  active: number;
  hc: number | null;
  feedback: string;
  r2i: string;
  i2o: string;
  hires: number | null;
  intent: string;
  score: number | null;
  risk: string;
};

/** 岗位方向分类（与 workbench 的 classifyCockpitRole 同一套规则，供雷达映射用）。 */
export function classifyRadarPositionType(role: string): RadarPositionType {
  const value = String(role || "").replace(/\s+/g, " ").trim();
  if (/设计|UI\s*\/?\s*UX|视觉/i.test(value)) return "设计";
  if (/算法|大模型|机器学习|深度学习|研究|Research|MLE|VLM|NLP|RAG|LLM/i.test(value)) return "算法";
  if (/运营|社群|社区|助理|财务|FA\b|KOL/i.test(value)) return "运营";
  if (/产品(经理|负责人|总监|设计|策略|运营|市场|增长|商业化|&)|\bPM\b|Product/i.test(value)) return "产品";
  if (/增长|市场|投放|销售|商务|品牌|GTM|售前|招聘|HR|BD|营销|内容|CMO/i.test(value)) return "商业化";
  if (/工程|研发|开发|前端|后端|全栈|运维|测试|架构|技术|CTO|iOS|Android|Engineer/i.test(value)) return "技术";
  if (/产品/i.test(value)) return "产品";
  return "商业化";
}

function radarStatusOf(activeState: string | null | undefined): RadarJobStatus {
  if (activeState === "OPEN") return "活跃";
  if (activeState === "COOLING") return "降温";
  if (activeState === "CLOSED" || activeState === "COMPLETED") return "已关闭";
  return "待同步";
}

/** 后端 /radar 行 → 雷达表格行。 */
export function mapRadarRow(r: BackendRadarRow): RadarJob {
  const cockpit = r.cockpit || null;
  const relationLabel = RELATION_LABELS[r.relation || ""] || r.relation || "团队共享";
  let reason: string;
  if (cockpit) {
    const statusLabel = { PRIMARY_PM: "我主做", PARTICIPANT: "参与", MENTIONED: "被提及", UNCONFIRMED: "待确认" }[cockpit.membership_status || ""] || cockpit.membership_status || "待确认";
    reason = `驾驶舱 · ${statusLabel} · ${cockpit.current_stage || "阶段待确认"}${cockpit.next_action ? ` · ${cockpit.next_action}` : ""}`;
  } else if (r.pipeline) {
    reason = `Pipeline · ${r.pipeline}`;
  } else {
    reason = "市场信号 · 待后端同步";
  }
  return {
    id: r.project_id,
    name: r.role || "未知职位",
    client: r.company || "未知客户",
    industry: r.company_type || "未标注业务方向",
    city: r.city || "待确认",
    pm: relationLabel,
    status: radarStatusOf(r.active_state),
    score: null, // 雷达不做评分展示；评分以后端推荐为准
    hc: r.hc ?? null, // UNKNOWN 原样为 null，绝不写 0
    feedback: r.captured_at ? String(r.captured_at).slice(0, 10) : "待接入",
    recommended: null,
    interview: null,
    offer: null,
    reason,
    salary: "待同步",
    source: cockpit ? "驾驶舱导入" : "市场信号",
    positionType: classifyRadarPositionType(r.role || ""),
    sourceColumn: cockpit ? "驾驶舱导入" : undefined,
  };
}

/** 后端 /clients 行 → 客户洞察行。 */
export function mapClientRow(c: BackendClientRow): RadarClient {
  const relations = c.relations || [];
  const states = c.states || [];
  let risk = "运营指标待后端接入";
  if (relations.includes("OTHER_CONSULTANT")) risk = "其他顾问主做";
  else if (states.includes("COOLING")) risk = "有职位进入冷却期";
  return {
    name: c.company,
    industry: c.company_type || "未标注业务方向",
    state: (c.active_jobs ?? 0) > 0 ? "有活跃职位" : "无活跃职位",
    active: c.active_jobs ?? 0,
    hc: c.hc_known ?? null, // UNKNOWN 原样为 null，绝不写 0
    feedback: c.last_activity ? String(c.last_activity).slice(0, 10) : "—",
    r2i: "待后端",
    i2o: "待后端",
    hires: null,
    intent: "待确认",
    score: null,
    risk,
  };
}

/** 拉取雷达与客户洞察（浏览器端）。 */
export async function getRadar(): Promise<{ items: BackendRadarRow[] }> {
  return brainxFetch<{ items: BackendRadarRow[] }>("/api/v1/radar");
}
export async function getClients(): Promise<{ items: BackendClientRow[] }> {
  return brainxFetch<{ items: BackendClientRow[] }>("/api/v1/clients");
}

export type ManualFactUpdate = {
  changes?: Partial<Record<ManualFactField, string | number>>;
  clear_fields?: ManualFactField[];
  idempotency_key: string;
};

export async function updateOpportunityFacts(id: string, update: ManualFactUpdate): Promise<{
  ok: boolean; already?: boolean; event_id?: string; decision_run_id?: string | null;
  recompute?: { blocked?: boolean; reason?: string };
  recommendation?: { decision_id?: string; score?: number; action?: string } | null;
}> {
  return brainxFetch(`/api/v1/opportunities/${encodeURIComponent(id)}/facts`, { method: "PATCH", body: update });
}

// —— HTTP 客户端（浏览器端专用；401 抛 BrainxApiError 由调用方决定回退/登录）——
// 边界层返回任意 JSON 载荷：形状由各映射函数收敛为强类型，这里保留原样。
export async function brainxFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method || "GET";
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  let data: T | BrainxErrorPayload | null = null;
  try { data = await res.json(); } catch { /* 非 JSON 响应体 */ }
  if (!res.ok) {
    // 两种错误信封：err() 的 {error:{code,message}} 与领域函数的 {error:"字符串"}（如 engage 409）
    const raw = (data as BrainxErrorPayload | null)?.error;
    const message = raw && typeof raw === "object"
      ? raw.message
      : typeof raw === "string" ? raw : `HTTP ${res.status}`;
    const code = raw && typeof raw === "object" ? raw.code : undefined;
    throw new BrainxApiError(message, res.status, code, data as BrainxErrorPayload);
  }
  return data as T;
}

/** 只读助手的流式接口；响应内容不经过 JSON 客户端封装，避免吞掉 SSE 增量。 */
export async function streamAssistant(
  options: AssistantChatOptions,
  onText: (text: string) => void,
  onError: (message: string) => void,
): Promise<void> {
  const res = await fetch("/api/v1/assistant/chat", {
    method: "POST", credentials: "same-origin", signal: options.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: options.question, history: options.history, context: options.context }),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { const data = await res.json(); message = data?.error?.message || data?.error || message; } catch { /* text fallback */ }
    throw new BrainxApiError(String(message), res.status);
  }
  if (!res.body) throw new BrainxApiError("助手没有返回内容", 502);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const data = JSON.parse(line.slice(5).trim()) as { text?: string; message?: string };
          if (data.text) onText(data.text);
          if (data.message) onError(data.message);
        } catch { /* ignore malformed provider frame */ }
      }
      if (done) break;
    }
  } finally { reader.releaseLock(); }
}

/** 读取完整工作台快照：概览 + 推荐 + 逐职位详情（承接态/允许动作/事件/结果）+ 画像。
 *  会话未登录（401）时抛错，由调用方进入离线回退。 */
export async function getSnapshot(): Promise<BrainxSnapshot> {
  const [wb, recs, profile, dismiss] = await Promise.all([
    brainxFetch<BackendWorkbench>("/api/v1/workbench"),
    brainxFetch<BackendRecommendations>("/api/v1/recommendations?limit=10"),
    brainxFetch<BackendProfile>("/api/v1/profile"),
    brainxFetch<BackendDismissReasons>("/api/v1/dismiss-reasons").catch(() => ({ items: FALLBACK_DISMISS_REASONS })),
  ]);

  const jobs = (recs.items || []).map(mapRecommendation) as BrainxJob[];
  const engagement: Record<string, EngagementState> = {};
  const events: Record<string, DecisionEvent[]> = {};
  const outcomes: Record<string, Outcome[]> = {};
  const legal: Record<string, EngagementCommand[]> = {};

  const details = await Promise.all(
    jobs.map((j) => brainxFetch<BackendOpportunity>(`/api/v1/opportunities/${encodeURIComponent(j.id)}`).catch(() => null)),
  );
  jobs.forEach((job, i) => {
    const d = details[i];
    const decisionId = d?.latest_recommendation?.decision_id || recs.items[i]?.decision_id;
    job.brainxDecisionId = decisionId;
    if (!d) return;
    engagement[job.id] = d.engagement_state as EngagementState;
    events[job.id] = mapEvents(d.events);
    outcomes[job.id] = mapOutcomes(d.outcomes);
    legal[job.id] = (d.legal_actions || []).filter((a: string) => a !== "VIEW") as EngagementCommand[];
    job.brainxLegal = legal[job.id];
  });

  // 承接中但不在本轮 Top10 的职位（侧栏“我的承接”需要），用伪条目补进列表
  for (const c of wb.commitments || []) {
    if (engagement[c.project_id]) continue;
    jobs.push({
      id: c.project_id, rank: 99, company: c.company || "未知客户", role: c.role || "未知职位",
      direction: directionOf(c.role || ""), sourceMode: "MARKET_ONLY",
      group: "MAINTENANCE", eligibility: "ELIGIBLE",
      globalScore: "—", explorationScore: "—", personalScore: "—", finalScore: "—",
      evidenceCoverage: null,
      recommendation: c.next_action || "承接中职位",
      recentSignal: "",
      facts: { "职位关系": "团队共享", "数据来源": "职位市场", "当前阶段": "UNKNOWN", "剩余 HC": "UNKNOWN", "最近活动": "UNKNOWN", "历史 Pipeline": "暂无记录" },
      scoreNotes: [], risks: [], evidence: [], actions: [], brainxLegal: [],
    });
    engagement[c.project_id] = c.state as EngagementState;
    events[c.project_id] = [];
    outcomes[c.project_id] = [];
    legal[c.project_id] = [];
  }

  return {
    jobs,
    engagement,
    events,
    outcomes,
    legal,
    sync: mapSyncStatus(wb.sync, wb.feishu_auth),
    auth: {
      consultant: profile.display_name || wb.consultant_id || "顾问",
      authorized: !!profile.feishu_auth?.authorized,
      needsReauth: !!profile.feishu_auth?.needs_reauth,
    },
    notifications: buildNotifications(wb, recs),
    dismissReasons: dismiss.items || FALLBACK_DISMISS_REASONS,
    runId: wb.run_id || null,
    snapshotId: recs.snapshot_id || null,
    policyVersion: recs.policy_version || wb.current_policy_version || null,
    profileKeywords: profile.profile_keywords || [],
  };
}

/** 重取单个职位详情（承接动作/结果回写成功后刷新本地视图）。 */
export async function fetchJobDetail(id: string): Promise<{
  engagementState: EngagementState;
  legal: EngagementCommand[];
  events: DecisionEvent[];
  outcomes: Outcome[];
  decisionId: string | null;
}> {
  const d = await brainxFetch<BackendOpportunity>(`/api/v1/opportunities/${encodeURIComponent(id)}`);
  return {
    engagementState: d.engagement_state as EngagementState,
    legal: (d.legal_actions || []).filter((a: string) => a !== "VIEW") as EngagementCommand[],
    events: mapEvents(d.events),
    outcomes: mapOutcomes(d.outcomes),
    decisionId: d.latest_recommendation?.decision_id || null,
  };
}

/** SSE 订阅（/api/v1/events）；返回带 close 的句柄。 */
export function connectSSE(onEvent: (event: BackendSseEvent) => void): { close: () => void } {
  if (typeof window === "undefined" || !("EventSource" in window)) return { close: () => {} };
  const es = new EventSource("/api/v1/events");
  es.onmessage = (e) => {
    try { onEvent(JSON.parse(e.data)); } catch { /* 心跳/非 JSON 帧忽略 */ }
  };
  return { close: () => es.close() };
}
