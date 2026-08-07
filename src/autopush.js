/** autopush.js — 重大变化自动推卡（P4）。
 *
 * 安全边界（与 Mia 的约定）：
 *   - 默认关闭：仅 BRAINX_PUSH_AUTO=1 时启用；
 *   - 只推顾问本人 open_id（机器人私聊），**绝不推群**——群推送需 Mia 显式确认，
 *     永远不进自动化路径。
 *
 * 「重大变化」定义（新一轮 vs 上一轮已完成推荐）：
 *   1. Top1 易主；
 *   2. Top3 内出现新的 RECOMMEND_ACCEPT 档职位（新进入或由低档晋升）。
 * 以 run_id 为幂等键（push_log 唯一键），同轮重复触发不会重发。
 */
import { buildHeatingAlertCard, pushCard } from './push.js';
import { loadConsultants } from './recommend.js';

const CHANGE_LABEL = {
  TOP1_CHANGED: '今日推荐 Top1 易主',
  ACCEPT_ENTERED_TOP3: '新职位进入「建议接单」档（Top3）',
};

/** 比较顾问最近两轮推荐，返回 { kind, run_id, project_id } 或 null。纯查询，可单测。 */
export function detectMaterialChange(db, consultant_id) {
  const runs = db.prepare(`SELECT run_id FROM decision_runs
    WHERE consultant_id=? AND status='COMPLETED'
    ORDER BY created_at DESC, run_id DESC LIMIT 2`).all(consultant_id);
  if (runs.length < 2) return null;
  const recsOf = (run_id) => db.prepare(`SELECT project_id, action FROM recommendations
    WHERE run_id=? AND consultant_id=? ORDER BY rank`).all(run_id, consultant_id);
  const cur = recsOf(runs[0].run_id);
  const prev = recsOf(runs[1].run_id);
  if (!cur.length) return null;
  if (cur[0]?.project_id !== prev[0]?.project_id) {
    return { kind: 'TOP1_CHANGED', run_id: runs[0].run_id, project_id: cur[0].project_id };
  }
  const entered = cur.slice(0, 3).find((r) => r.action === 'RECOMMEND_ACCEPT'
    && !prev.slice(0, 3).some((q) => q.project_id === r.project_id && q.action === 'RECOMMEND_ACCEPT'));
  if (entered) {
    return { kind: 'ACCEPT_ENTERED_TOP3', run_id: runs[0].run_id, project_id: entered.project_id };
  }
  return null;
}

/** 桥接器 onRecommended 钩子工厂。pushImpl 可注入（测试绝不打真实 lark-cli）。 */
export function makeAutoPush(db, { pushImpl = pushCard } = {}) {
  return (consultant_id) => {
    if (process.env.BRAINX_PUSH_AUTO !== '1') return { pushed: false, reason: 'disabled' };
    const change = detectMaterialChange(db, consultant_id);
    if (!change) return { pushed: false, reason: 'no_material_change' };
    const c = loadConsultants(db).find((x) => x.consultant_id === consultant_id);
    if (!c?.open_id) return { pushed: false, reason: 'no_open_id' };
    const rec = db.prepare(`SELECT r.*, j.company, j.role, j.city FROM recommendations r
      JOIN job_facts j ON j.project_id = r.project_id
      WHERE r.run_id=? AND r.project_id=? AND r.consultant_id=?`)
      .get(change.run_id, change.project_id, consultant_id);
    if (!rec) return { pushed: false, reason: 'rec_not_found' };
    const rel = db.prepare(`SELECT relation FROM job_memberships
      WHERE consultant_id=? AND project_id=? AND valid_to IS NULL`).get(consultant_id, change.project_id);
    const card = buildHeatingAlertCard({
      change_label: CHANGE_LABEL[change.kind] || change.kind,
      item: { run_id: change.run_id, score: rec.score, action: rec.action,
              reasons: JSON.parse(rec.reasons_json),
              job: { project_id: rec.project_id, company: rec.company, role: rec.role,
                     city: rec.city, relation: rel?.relation || 'UNKNOWN' } },
    });
    const out = pushImpl(db, { consultant_id, kind: 'HEATING_ALERT', run_id: change.run_id,
                               card, target: c.open_id, send: true });
    return { pushed: out.status !== 'FAILED', change, push: out };
  };
}
