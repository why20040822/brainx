#!/usr/bin/env node
/** 从真实飞书导出生成 Felix 职位 fixture。
 *
 * 数据源（fixtures/_sources/，2026-08-07 lark-cli 真实导出，禁止手编）：
 *  - zhipin_pandian_2026-08-07.json  职位盘点 Bitable 31 行（公司/职位/地点/主做/还做吗/文本/公司类型）
 *  - zp_digest_raw.json              ZP-职位/人才市场订阅群机器人日报（职位—顾问—城市—客户状态）
 *  - flx_priority_raw.json           FLX-职位优先级群 Felix 本人排序+主做标注
 *
 * project_id 为确定性占位（P-FIX-<md5前8>）：飞书可读范围无 project_id（已实证，
 * 见补全文档 §17.2），待 TalentMatch 导出后由 adapter 替换为真实 ID。去重/排序/
 * 状态机逻辑与 ID 来源无关，不受影响。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = (f) => JSON.parse(readFileSync(join(ROOT, 'fixtures/_sources', f), 'utf8'));

const pid = (company, role) =>
  'P-FIX-' + createHash('md5').update(`${company}|${role}`).digest('hex').slice(0, 8).toUpperCase();
const flat = (v) => Array.isArray(v) ? v.filter(Boolean).join('、') : (v ?? '');

// ── 1) 职位盘点 Bitable ─────────────────────────────────────
const pd = S('zhipin_pandian_2026-08-07.json').data;
const cols = pd.fields; // ['公司','职位','地点','主做','还做吗','文本','公司类型']
const pandianRows = pd.data.map((cells, i) => {
  const rec = Object.fromEntries(cols.map((c, j) => [c, cells[j]]));
  rec._record_id = pd.record_id_list[i];
  return rec;
});

// 还做吗 → active_state
const stateOf = (w) => {
  const s = flat(w);
  if (/无|待定/.test(s)) return 'COOLING';
  return 'OPEN'; // 重点高优 / 正常招 / 常年招 / 新
};

// ── 2) ZP 机器人日报：- **职位** — 顾问，城市/状态… ──────────
const zpMsgs = S('zp_digest_raw.json').data.messages || [];
const zpJobs = [];
for (const m of zpMsgs) {
  if (m.msg_type !== 'post') continue;
  const text = m.content || '';
  const re = /- \*\*(.+?)\*\* — ([^，,\n]+)[，,](.*)/g;
  let mm;
  while ((mm = re.exec(text))) {
    const [, role, owner, note] = mm;
    if (role.length > 30 || /汇总|内容/.test(role)) continue;
    const city = (note.match(/北京|上海|深圳|杭州|成都|remote|远程|中美/) || [''])[0];
    zpJobs.push({
      role: role.trim(), owner: owner.trim(), city,
      pipeline: note.trim().slice(0, 60),
      company: '', // 日报无公司列，留给 pandian/市场帖补
    });
  }
}

// ── 3) FLX 群 Felix 本人标注（2026-08-07 10:32 原文）────────
// 原文："当前排序：1、aha 广告销售 /运营-（frank主做争取面试+1）
//  2、雨林时代 /sigmaz/科漫-增长负责人（我当前主做 约面1人，带frank入门不做）
//  3、presence/蝴蝶梦境/39-AI- 千万级消耗投放（长期mapping搭建）"
const FLX_RELATIONS = [
  { match: ['雨林时代', 'sigmaz', '科漫'], role: '增长负责人', relation: 'MY_JOB', note: 'Felix 我当前主做，约面1人' },
  { match: ['presence', '蝴蝶梦境'], role: '千万级消耗投放', relation: 'MY_JOB', note: '长期mapping搭建' },
  { match: ['aha'], role: '广告销售/运营', relation: 'OTHER_CONSULTANT', note: 'frank主做' },
];
// 市场帖中 Felix 在协助的（FLX 群 10:40 原文：协助 rockflow 增长人选）
const FELIX_ASSIST = ['rockflow'];

// ── 4) 合成职位行 ───────────────────────────────────────────
const jobs = [];
const seen = new Set();
const push = (j) => {
  const id = pid(j.company, j.role);
  if (seen.has(id)) return;
  seen.add(id);
  jobs.push({
    project_id: id, company: j.company, role: j.role,
    city: j.city || null, pipeline: j.pipeline || null,
    hc: j.hc ?? null, active_state: j.active_state || 'OPEN',
    source_url: j.source_url || null,
    relation: j.relation || 'TEAM_SHARED', relation_note: j.relation_note || '',
    captured_at: j.captured_at || '2026-08-07T08:40:00+08:00',
    historical: j.historical || false,
  });
};

// 4a. Felix 关系行（FLX 群真实标注）
for (const r of FLX_RELATIONS) {
  push({
    company: r.match.join('/'), role: r.role, city: '北京',
    pipeline: r.note, relation: r.relation, relation_note: r.note,
    source_url: 'feishu://chat/oc_667758eb50ad4b1af86ae99d79859870',
  });
}
// Rockflow：Felix 协助中（真实），主做另有其人 → PRIMARY_PM 视角示例
push({
  company: 'Rockflow', role: '增长人选（喻新航线索）', city: '北京',
  pipeline: '面试跟进中（vakee 后续时间待 York 跟进）', relation: 'PRIMARY_PM',
  relation_note: 'FLX 群 10:40 协助记录', hc: 1,
});

// 4b. ZP 日报职位（真实标题+顾问+城市+客户状态）→ 对 Felix 均为他人主做
for (const z of zpJobs) {
  push({
    company: z.owner.replace(/\s/g, '') + '线', role: z.role, city: z.city || null,
    pipeline: z.pipeline || null, relation: 'OTHER_CONSULTANT',
    relation_note: `主做：${z.owner}`,
    source_url: 'feishu://chat/oc_a56daa7bcbb36c27ae2d5de16f01abf1',
  });
}

// 4c. 职位盘点行（真实公司池）→ 团队共享；两条「无，待定」作 COOLING/历史
let closedSeed = 0;
for (const r of pandianRows) {
  const company = flat(r['公司']);
  if (!company || company === 'TTC') continue; // TTC 自身行不算客户职位
  const cats = flat(r['职位']);
  const st = stateOf(r['还做吗']);
  const isFelixAssist = FELIX_ASSIST.some((a) => company.toLowerCase().includes(a));
  const historical = st === 'COOLING' && closedSeed < 2; // 两条历史关闭行（还做吗=无，待定 真实信号推导）
  if (historical) closedSeed += 1;
  push({
    company, role: cats ? `${cats}（多岗）` : '职位待定',
    city: flat(r['地点']) || null,
    pipeline: [flat(r['还做吗']), r['文本']].filter(Boolean).join(' · ') || null,
    active_state: historical ? 'CLOSED' : st,
    relation: isFelixAssist ? 'PRIMARY_PM' : 'TEAM_SHARED',
    relation_note: flat(r['主做']) ? `主做：${flat(r['主做'])}` : '团队池（职位盘点表无归属）',
    source_url: `feishu://base/RR5NbWHEfacz4jsRYMocy1qAnSh?record=${r._record_id}`,
    historical,
  });
}

// 4d. 一条 UNKNOWN 关系行（测硬约束：UNKNOWN 不进正式推荐）
push({
  company: '某具身智能公司', role: 'VLA 后训练工程师', city: '深圳',
  pipeline: '职位市场群帖子，未加入', relation: 'UNKNOWN', relation_note: '仅群帖提及',
  source_url: 'feishu://chat/oc_ac6d0f87f83a5b53efab63c87c6e9f49',
});

const fixture = {
  _provenance: {
    generated_by: 'scripts/build_fixture.mjs',
    sources: ['zhipin_pandian_2026-08-07.json', 'zp_digest_raw.json', 'flx_priority_raw.json'],
    note: '公司/职位/城市/主做/优先级全部来自 2026-08-07 飞书真实导出；'
        + 'project_id 为确定性占位（飞书无 project_id，待 TalentMatch 导出替换）；'
        + 'CLOSED 行由「还做吗=无，待定」真实信号推导，用于历史相似度与生命周期验证。',
  },
  exported_at: '2026-08-07T08:40:00+08:00',
  jobs,
};

writeFileSync(join(ROOT, 'fixtures/ttc_jobs_felix.json'), JSON.stringify(fixture, null, 2));
console.log(`fixture: ${jobs.length} 个职位（真实导出衍生）`);
const byRel = {};
for (const j of jobs) byRel[j.relation] = (byRel[j.relation] || 0) + 1;
console.log('关系分布:', byRel);
const byState = {};
for (const j of jobs) byState[j.active_state] = (byState[j.active_state] || 0) + 1;
console.log('状态分布:', byState);
