/** ttcsdk/job.js — 职位域 API（ATS 真 project_id / HC / Pipeline 的源头）。 */
import { ttcRequest } from './http.js';

/** 职位检索（POST search，单页）。返回该 JWT 持有者权限视图内的职位。 */
export const search = (jwt, query = {}, fetchImpl) =>
  ttcRequest(jwt, 'POST', '/api/crm/v1/job/search', { page: 1, ...query }, fetchImpl);

/** 全量拉取（cursor 分页，实测每页固定 10 条）。maxPages 防失控（100 页=1000 条上限）。 */
export async function searchAll(jwt, query = {}, fetchImpl) {
  const out = [];
  let cursor = '';
  for (let p = 0; p < 100; p++) {
    const d = await ttcRequest(jwt, 'POST', '/api/crm/v1/job/search',
      { page: 1, ...(cursor ? { cursor } : {}), ...query }, fetchImpl);
    const jobs = d?.jobs || [];
    out.push(...jobs);
    if (!d?.has_more) break;
    cursor = d.cursor;
  }
  return out;
}

/** TTC job → runSync payload 行（2026-08-14 实测字段驱动）。
 * need_blur=1 的公司用面向候选人名（company_name_for_c），守脱敏纪律。
 * status：1=OPEN（实测 tags 新职位/活跃）；0=COOLING；其余 UNKNOWN。
 * relation=null（桥接纪律）——主做归属走 owner_name，由 relations.js 推导。 */
export function toJobRow(j) {
  const blurred = j.need_blur === 1 || j.need_blur === true;
  const company = (blurred && j.company_name_for_c) ? j.company_name_for_c : (j.company_name || '');
  const steps = j.pipeline_info?.pipeline_step_count || {};
  const pipe = Object.entries(steps).map(([k, v]) => `${k}×${v}`).join(' ');
  return {
    project_id: j.unique_id,              // 真 ATS project_id（替换 P-FIX 占位）
    company, role: j.name || '职位待定',
    city: (j.cities || []).join('、') || null,
    pipeline: pipe || null,               // 真 Pipeline（"Sourcing×1 二面×2" 摘要）
    hc: j.head_count ?? null,             // 真 HC
    active_state: j.status === 1 ? 'OPEN' : j.status === 0 ? 'COOLING' : 'UNKNOWN',
    priority: null,                       // TTC priority 字段实测恒 0，无信号
    notes: j.analytics || j.description || null,
    company_type: null,                   // industry_tags 形态未稳定，暂不映射（raw_json 有全量）
    owner_name: j.managers?.[0]?.name || null,
    owner_unique_id: j.managers?.[0]?.unique_id || null,
    relation: null,
    source_url: `ttc://job/${j.unique_id}`,
    captured_at: j.update_time ? new Date(Number(j.update_time)).toISOString() : undefined,
    ttc: { company_unique_id: j.company_unique_id, cooperation: j.cooperation || '',
           status_tags: j.status_tags || [], group_chat_id: j.group_chat?.id || '',
           participants: (j.participants || []).map((p) => p.name) },
  };
}
