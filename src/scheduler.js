/** scheduler.js — 每日两次定时推送（2026-08-14 用户指令：早 7 点、晚 7 点）。
 *
 * 规则：
 *   - 时点按 Asia/Shanghai（UTC+8，无 DST）07:00 与 19:00；窗口 [时点, +30min)。
 *     窗口外重启不补发（避免部署触发意外推送）。
 *   - 幂等：push_log 唯一键（consultant_id, kind='DAILY_TOP3', run_id=「日期#时段」），
 *     重启/重入不会重复发（与 pushCard 既有幂等同一机制）。
 *   - 对象：花名册 active 且有 open_id 的顾问；lark-cli --as bot 私聊（绝不推群）。
 *   - 开关：BRAINX_PUSH_SCHEDULE=0 关闭（默认开）。
 */
import { now } from './db.js';
import { latestRun } from './recommend.js';
import { latestSync, latestCompleteSnapshot } from './sync.js';
import { commitmentSummary } from './engagement.js';
import { buildDailyCard, pushCard } from './push.js';

const SLOTS = [7, 19]; //  CST 小时
const WINDOW_MS = 30 * 60 * 1000;

/** 当前 CST 的「今日日期#时段」与是否处于发射窗口（纯函数，可注入时钟测试）。 */
export function slotState(at = new Date()) {
  const cst = new Date(at.getTime() + 8 * 3600 * 1000); // 用 UTC 字段读 CST
  const day = cst.toISOString().slice(0, 10);
  for (const h of SLOTS) {
    const slotStart = Date.UTC(cst.getUTCFullYear(), cst.getUTCMonth(), cst.getUTCDate(), h, 0, 0) - 8 * 3600 * 1000;
    if (at.getTime() >= slotStart && at.getTime() < slotStart + WINDOW_MS) {
      return { inWindow: true, slotKey: `${day}#${String(h).padStart(2, '0')}00` };
    }
  }
  return { inWindow: false, slotKey: null };
}

/** 给一位顾问发今日卡（幂等：该时段已发则跳过）。返回 pushCard 结果或 null。 */
export function pushSlotFor(db, consultant_id, open_id, slotKey, { send = true } = {}) {
  const sync = latestSync(db, consultant_id);
  const snapshot = latestCompleteSnapshot(db, consultant_id);
  const run = latestRun(db, consultant_id);
  if (!run || !run.items.length) return null; // 无推荐不发
  const c = commitmentSummary(db, consultant_id);
  const name = db.prepare('SELECT display_name FROM consultants WHERE consultant_id=?')
    .get(consultant_id)?.display_name || consultant_id;
  const card = buildDailyCard({ consultant_name: name, run: run.run, items: run.items,
                                commitments: c, sync, snapshot_id: snapshot?.sync_id });
  return pushCard(db, { consultant_id, kind: 'DAILY_TOP3', run_id: slotKey, card,
                        target: open_id, send });
}

export function startScheduler(db, { log = console.log } = {}) {
  if (process.env.BRAINX_PUSH_SCHEDULE === '0') return { stop: () => {} };
  const tick = () => {
    try {
      const { inWindow, slotKey } = slotState();
      if (!inWindow) return;
      const consultants = db.prepare(`SELECT consultant_id, open_id FROM consultants
        WHERE active=1 AND open_id IS NOT NULL AND open_id != ''`).all();
      for (const c of consultants) {
        const out = pushSlotFor(db, c.consultant_id, c.open_id, slotKey, { send: true });
        if (out && out.status !== 'SKIPPED_DUPLICATE') {
          log(`[scheduler] ${slotKey} 已推送 ${c.consultant_id}: ${out.status}`);
        }
      }
    } catch (e) { log(`[scheduler] tick 异常: ${String(e.message || e).slice(0, 120)}`); }
  };
  const timer = setInterval(tick, 60 * 1000);
  timer.unref?.();
  return { stop: () => clearInterval(timer), tick };
}
