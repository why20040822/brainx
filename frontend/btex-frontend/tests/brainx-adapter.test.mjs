import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRadarPositionType,
  directionOf,
  eligibilityOf,
  factsOf,
  groupOf,
  mapClientRow,
  mapEvents,
  mapOutcomes,
  mapRadarRow,
  mapRecommendation,
  mapReplayData,
  mapSyncStatus,
} from "../app/brainx-api.ts";

const sampleRec = {
  decision_id: "d-1",
  rank: 1,
  action: "RECOMMEND_ACCEPT",
  score: 79.9,
  confidence_band: "HIGH",
  evidence_coverage: 0.85,
  reasons: ["关系：我是主 PM；有，正常招/常年招", "方向匹配 25 分：与画像关键词重合"],
  risks: ["HC 未知（飞书源无此字段，待 ATS 补齐）"],
  evidence_refs: [
    { type: "source", ref: "feishu://base/xxx", excerpt: "Rockflow/产品、工程、运营增长（多岗）" },
    { type: "sync", ref: "snap-1", excerpt: "快照 snap-1 · 2026-08-07" },
  ],
  breakdown: [
    { dim: "direction", weight: 0.25, score: 25 },
    { dim: "activity", weight: 0.2, score: 68 },
    { dim: "similarity", weight: 0.15, score: 36 },
    { dim: "capacity", weight: 0.15, score: 100 },
    { dim: "outcomes", weight: 0.15, score: null },
    { dim: "exploration", weight: 0.1, score: 50 },
  ],
  job: {
    project_id: "P-FIX-E5FC611B",
    company: "Rockflow",
    role: "产品、工程、运营增长（多岗）",
    city: "北京",
    pipeline: "有，正常招/常年招",
    hc: null,
    active_state: "OPEN",
    priority: null,
    notes: null,
    company_type: null,
    source_url: "feishu://base/RR5N/record",
    captured_at: "2026-08-07T08:40:00+08:00",
    relation: "PRIMARY_PM",
  },
};

test("maps a backend recommendation into a workbench decision job", () => {
  const job = mapRecommendation(sampleRec);
  assert.equal(job.id, "P-FIX-E5FC611B");
  assert.equal(job.company, "Rockflow");
  assert.equal(job.rank, 1);
  assert.equal(job.finalScore, 79.9);
  assert.equal(job.globalScore, 68); // activity 维
  assert.equal(job.explorationScore, 50); // exploration 维
  assert.equal(job.personalScore, 25); // direction 维
  assert.equal(job.evidenceCoverage, 85);
  assert.equal(job.group, "ACTIVE_ADVANCEMENT");
  assert.equal(job.eligibility, "ELIGIBLE");
  assert.equal(job.sourceMode, "MARKET_ONLY");
  assert.equal(job.scoreNotes.length, 2);
  assert.equal(job.evidence.length, 2);
  assert.equal(job.actions[0].kind, "advance");
});

test("treats null HC as UNKNOWN, never as 0", () => {
  const job = mapRecommendation(sampleRec);
  assert.equal(job.facts["剩余 HC"], "UNKNOWN");
  assert.equal(job.facts["职位关系"], "我是主 PM");
  assert.equal(job.facts["当前阶段"], "招聘中");
  assert.equal(job.facts["最近活动"], "2026-08-07");
  assert.match(job.recentSignal, /证据覆盖 85%/);
});

test("derives observe/verify for low-coverage recommendations", () => {
  const rec = {
    ...sampleRec,
    action: "OBSERVE",
    score: 41,
    evidence_coverage: 0.4,
    breakdown: [{ dim: "activity", weight: 0.2, score: 30 }],
    job: { ...sampleRec.job, hc: 2, relation: "TEAM_SHARED" },
  };
  const job = mapRecommendation(rec);
  assert.equal(job.group, "NEW_VALIDATION");
  assert.equal(job.eligibility, "VERIFY_REQUIRED");
  assert.equal(job.actions[0].kind, "verify");
});

test("blocks engagement for jobs owned by another consultant", () => {
  const rec = {
    ...sampleRec,
    job: { ...sampleRec.job, hc: 1, relation: "OTHER_CONSULTANT" },
  };
  const job = mapRecommendation(rec);
  assert.equal(job.eligibility, "VERIFY_REQUIRED");
  assert.equal(job.actions[0].id, "ownership");
  assert.equal(eligibilityOf("RECOMMEND_ACCEPT", "NOT_JOINED", 1, "OPEN"), "VERIFY_REQUIRED");
});

test("excludes closed or zero-HC jobs", () => {
  const rec = {
    ...sampleRec,
    job: { ...sampleRec.job, hc: 0, active_state: "CLOSED" },
  };
  const job = mapRecommendation(rec);
  assert.equal(job.group, "EXCLUDE");
  assert.equal(job.eligibility, "EXCLUDED");
  assert.equal(groupOf("RECOMMEND_WATCH", null, "COOLING"), "MAINTENANCE");
});

test("classifies role direction from role text", () => {
  assert.equal(directionOf("资深海外投放经理"), "paid");
  assert.equal(directionOf("海外增长负责人"), "growth");
  assert.equal(directionOf("市场总监 / Manager"), "marketing");
  assert.equal(directionOf("GTM Leader"), "marketing");
});

test("maps backend sync status, including reauth", () => {
  assert.equal(mapSyncStatus({ state: "READY", updated_at: "2026-08-14T03:48:21.361Z", rows_read: 60, rows_expected: 60, errors: [] }).state, "READY");
  assert.equal(mapSyncStatus({ state: "INCOMPLETE", errors: ["缺 project_id"] }).state, "INCOMPLETE");
  assert.equal(mapSyncStatus(null).state, "EMPTY");
  const reauth = mapSyncStatus({ state: "READY" }, { needs_reauth: true });
  assert.equal(reauth.state, "AUTH_EXPIRED");
});

test("maps events and outcomes with local display fields", () => {
  const events = mapEvents([
    { event_type: "RECOMMENDED", occurred_at: "2026-08-14T03:48:21.416Z", actor: "felix" },
    { event_type: "DISMISSED", occurred_at: "2026-08-14T04:00:00Z", reason: "当前没精力" },
  ]);
  assert.equal(events[0].type, "已推荐");
  assert.equal(events[1].reason, "当前没精力");

  const outcomes = mapOutcomes([
    { stage: "面试", observed_at: "2026-08-14T04:05:00Z", value: { rating: 4, note: "首轮验证" } },
  ]);
  assert.equal(outcomes[0].stage, "面试");
  assert.equal(outcomes[0].rating, 4);
  assert.equal(outcomes[0].note, "首轮验证");
});

test("maps frozen replay data without recomputation", () => {
  const replay = mapReplayData({
    decision_id: "d-1",
    recommendation: {
      rank: 2,
      policy_version: "baseline-1.0",
      created_at: "2026-08-14T03:48:21.416Z",
      reasons: ["关系：团队共享"],
      risks: ["HC 未知"],
      evidence_refs: [{ type: "sync", ref: "snap-1", excerpt: "快照 snap-1" }],
    },
    events: [{ event_type: "WATCHED", occurred_at: "2026-08-14T04:10:00Z" }],
    outcomes: [{ stage: "反馈", observed_at: "2026-08-14T04:12:00Z", value: { note: "已回写" } }],
  });
  assert.equal(replay.decisionId, "d-1");
  assert.equal(replay.policyVersion, "baseline-1.0");
  assert.equal(replay.rank, 2);
  assert.equal(replay.events[0].type, "已关注");
  assert.equal(replay.outcomes[0].note, "已回写");
});

test("facts keep UNKNOWN for missing fields instead of inventing values", () => {
  const facts = factsOf({ relation: "UNKNOWN" });
  assert.equal(facts["剩余 HC"], "UNKNOWN");
  assert.equal(facts["职位关系"], "UNKNOWN");
  assert.equal(facts["当前阶段"], "UNKNOWN");
});

test("maps backend radar rows without inventing operational metrics", () => {
  const row = mapRadarRow({
    project_id: "P-FIX-ABC",
    company: "蝴蝶梦境",
    role: "海外增长负责人",
    city: "上海",
    pipeline: "推荐 3 · 面试 1",
    hc: null,
    active_state: "OPEN",
    relation: "TEAM_SHARED",
    captured_at: "2026-08-12T00:00:00+08:00",
    cockpit: null,
  });
  assert.equal(row.id, "P-FIX-ABC");
  assert.equal(row.client, "蝴蝶梦境");
  assert.equal(row.status, "活跃");
  assert.equal(row.source, "市场信号");
  assert.equal(row.hc, null); // UNKNOWN 原样为 null，绝不写 0
  assert.equal(row.score, null);
  assert.equal(row.recommended, null);
  assert.equal(row.pm, "团队共享");
  assert.match(row.reason, /Pipeline/);
  assert.equal(row.positionType, "商业化");
});

test("maps cockpit radar rows as 驾驶舱导入 with cockpit context", () => {
  const row = mapRadarRow({
    project_id: "P-FIX-CPT",
    company: "39AI",
    role: "增长投放经理",
    active_state: "OPEN",
    relation: "PRIMARY_PM",
    hc: 1,
    cockpit: { membership_status: "PRIMARY_PM", current_stage: "ACTIVE_ADVANCEMENT", next_action: "回写信号" },
  });
  assert.equal(row.source, "驾驶舱导入");
  assert.equal(row.sourceColumn, "驾驶舱导入");
  assert.match(row.reason, /我主做/);
  assert.match(row.reason, /ACTIVE_ADVANCEMENT/);
  assert.equal(row.status, "活跃");
});

test("maps radar statuses from active_state without fabricating signals", () => {
  assert.equal(mapRadarRow({ project_id: "p1", active_state: "CLOSED", relation: "TEAM_SHARED" }).status, "已关闭");
  assert.equal(mapRadarRow({ project_id: "p2", active_state: "COOLING", relation: "TEAM_SHARED" }).status, "降温");
  assert.equal(mapRadarRow({ project_id: "p3", relation: "TEAM_SHARED" }).status, "待同步");
});

test("maps backend client rows honestly (null hc stays null, no invented metrics)", () => {
  const c = mapClientRow({
    company: "蝴蝶梦境", company_type: "跨境电商", job_count: 7, active_jobs: 7,
    hc_known: null, last_activity: "2026-08-12T00:00:00+08:00",
    relations: ["TEAM_SHARED"], states: ["OPEN"],
  });
  assert.equal(c.name, "蝴蝶梦境");
  assert.equal(c.state, "有活跃职位");
  assert.equal(c.hc, null); // 绝不写 0
  assert.equal(c.score, null);
  assert.equal(c.hires, null);
  assert.equal(c.r2i, "待后端");
  assert.match(c.feedback, /2026-08-12/);
  const other = mapClientRow({
    company: "X", relations: ["OTHER_CONSULTANT"], states: ["OPEN"],
    job_count: 2, active_jobs: 0,
  });
  assert.equal(other.state, "无活跃职位");
  assert.equal(other.risk, "其他顾问主做");
});

test("classifies radar position types from role text", () => {
  assert.equal(classifyRadarPositionType("算法工程师（大模型）"), "算法");
  assert.equal(classifyRadarPositionType("产品经理"), "产品");
  assert.equal(classifyRadarPositionType("海外投放经理"), "商业化");
  assert.equal(classifyRadarPositionType("前端开发"), "技术");
});
