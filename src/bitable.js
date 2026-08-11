/** bitable.js — 职位盘点 Bitable 记录的字段解析层（bridge.js / sync.js 共用的唯一权威）。
 *
 * 实测标准字段（2026-08-10 field-list + 全量 31 记录扫描）：
 *   公司     select 单选 —— 客户名（"TTC"=内部行，过滤）
 *   职位     select 多选 —— 职能类别（产品/工程/运营增长/算法/销售/战略/投资/FA/移动端/infra），
 *            不是职位名！修正前被顿号拼接成假职位名（22/86 行），且职能勾选变化会让
 *            md5(公司|拼接串) 漂移产生重复行
 *   主做     user 多选 —— 关系权威列（当前 31/31 全空，未维护；仍解析入 raw_json 备用）
 *   地点     select 多选
 *   还做吗   select 多选 —— 实为「优先级+状态」：1重点高优(12)/有，正常招常年招(11)
 *            /无，待定(4)/新(4)。修正前原文塞进 pipeline 字段、优先级信号全丢
 *   文本     text —— 真实需求细节（P0/P1 岗位清单、客户文档链接）。修正前完全丢弃（0/86 入库）
 *   公司类型 select —— AI 2C 等（方向匹配素材，修正前丢弃）
 *
 * 粒度决策：一记录 = 公司 × 职能集合 → 展开为「公司 × 单职能」多行。
 * project_id 与 fixture 同一推导（md5(公司|职能)）：单职能公司行 ID 不变无缝续命，
 * 与 fixture 策展行同源同 ID 自然合并；旧复合行由 0007 退役（不再被重建）。
 */
import { createHash } from 'node:crypto';

export const BITABLE_BASE = 'RR5NbWHEfacz4jsRYMocy1qAnSh';
export const BITABLE_TABLE = 'tblsZBwtKIrIgtre';

/** 与 scripts/build_fixture.mjs 同一推导，保证同源公司合并到同一 project_id。 */
export const deriveProjectId = (company, role) =>
  'P-FIX-' + createHash('md5').update(`${company}|${role}`).digest('hex').slice(0, 8).toUpperCase();

/** 优先级枚举（还做吗 → 结构化）。STANDBY 映射 active_state=COOLING。 */
export const PRIORITY = { HIGH: 'HIGH', NEW: 'NEW', NORMAL: 'NORMAL', STANDBY: 'STANDBY' };
export const PRIORITY_LABEL = { HIGH: '重点高优', NEW: '新增', NORMAL: '正常招', STANDBY: '待定冷却' };

const PRIORITY_RULES = [
  [/重点|高优/, PRIORITY.HIGH],
  [/无|待定|暂停|关闭/, PRIORITY.STANDBY], // 先于 NORMAL 判（"无，待定"含逗号分隔的多值）
  [/^新$|新上|新增/, PRIORITY.NEW],
  [/正常招|常年招|^有$|有，/, PRIORITY.NORMAL],
];
export const mapPriority = (raw) => {
  for (const [re, p] of PRIORITY_RULES) if (re.test(raw || '')) return p;
  return null; // 未识别：不猜，留 null（评分按 0 加成，explain 不出优先级文案）
};

/** lark-cli 通道：值已是纯字符串数组。 */
export const flatLark = (v) => (Array.isArray(v) ? v.filter(Boolean).join('、') : (v ?? ''));

/** 直连 API 通道：富文本段 [{type:'text',text}] 无缝拼接；人员 [{name}] 与多选取名。 */
export const flatApi = (v) => {
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => x && typeof x === 'object' && 'text' in x)) {
      return v.map((x) => x.text ?? '').join('');
    }
    return v.map((x) => (x && typeof x === 'object' ? (x.text ?? x.name ?? '') : x))
      .filter(Boolean).join('、');
  }
  if (v && typeof v === 'object') return v.text ?? v.name ?? '';
  return v ?? '';
};

/** 多选字段统一成数组（lark-cli 与 API 通道同形后调用）。 */
const toList = (v, flat) => {
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? (x.name ?? x.text ?? '') : String(x ?? ''))).filter(Boolean);
  const s = flat(v);
  return s ? s.split('、').filter(Boolean) : [];
};

/**
 * 解析一条 Bitable 记录 → 0..n 个规范化职位行（公司=TTC → 0；职位多选 → 每职能一行）。
 * flat：通道对应的拍平函数（flatLark / flatApi）。
 * 行形状即 runSync payload 契约：priority/notes/company_type 为 0007 新列；
 * owner_names 只进 raw_json（主做列当前全空，未来落地后供关系细化，见 relations.js 头注）。
 */
export function parseBitableRecord(rec, recordId, flat) {
  const company = flat(rec['公司']);
  if (!company || company === 'TTC') return [];
  const roles = toList(rec['职位'], flat);
  const statusRaw = flat(rec['还做吗']);
  const priority = mapPriority(statusRaw);
  const active_state = priority === PRIORITY.STANDBY ? 'COOLING' : 'OPEN';
  const city = flat(rec['地点']) || null;
  const notes = flat(rec['文本']) || null;
  const companyType = flat(rec['公司类型']) || null;
  const ownerNames = toList(rec['主做'], flat);
  const base = {
    company, city,
    pipeline: null, // Bitable 无进展语义字段；「还做吗」已结构化为 priority，不再塞 pipeline
    hc: null,       // 飞书源无 HC（已实证），风险文案由 scorer 出
    active_state, priority, notes, company_type: companyType,
    owner_names: ownerNames,
    relation: null, // 桥接/盘点源不动关系（事实/关系分离纪律）
    source_url: `feishu://base/${BITABLE_BASE}?record=${recordId}`,
  };
  if (!roles.length) roles.push('职位待定');
  return roles.map((role) => ({ ...base, project_id: deriveProjectId(company, role), role }));
}
