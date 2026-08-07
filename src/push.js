/** push.js — 飞书互动卡片构建与发送（补全文档 §18）。
 *
 * 硬约束：本地 127.0.0.1 收不到飞书回调 → 卡片按钮一律 URL 深链，
 * 操作只能发生在打开的工作台 UI 里。卡片 = 快照摘要；UI = 实时渲染。
 */
import { execFileSync } from 'node:child_process';
import { now, uuid } from './db.js';

const BASE_URL = process.env.BRAINX_BASE_URL || 'http://127.0.0.1:3000';

const REL_LABEL = { MY_JOB: '我的职位', PRIMARY_PM: '我主PM', TEAM_SHARED: '团队共享',
                    OTHER_CONSULTANT: '他人主做', NOT_JOINED: '未加入', UNKNOWN: '未知' };
const ACTION_LABEL = { RECOMMEND_ACCEPT: '建议接单', RECOMMEND_WATCH: '建议关注', OBSERVE: '观察' };
const TEMPLATE = { READY: 'green', RUNNING: 'blue', INCOMPLETE: 'orange', AUTH_EXPIRED: 'red', ERROR: 'red' };

const dim = (r, name) => {
  const d = (r.breakdown || []).find((x) => x.dim === name);
  return d && d.score != null ? d.score : '—';
};
const url = (u) => ({ url: u, pc_url: u, android_url: u, ios_url: u });
const btn = (text, u, type = 'default') =>
  ({ tag: 'button', text: { tag: 'plain_text', content: text }, type, multi_url: url(u) });

/** WorkbenchModel → 飞书 card schema 2.0 JSON（纯函数，可单测）。 */
export function buildDailyCard({ consultant_name, run, items, commitments, sync, snapshot_id }) {
  const state = sync?.complete ? 'READY' : 'INCOMPLETE';
  const els = [
    { tag: 'markdown', content: `**今天建议先看 ${Math.min(3, items.length)} 个职位**\n`
        + `${run?.candidate_count ?? items.length} 个候选 · ${state === 'READY' ? '数据完整' : '数据不完整'} · ${run?.policy_version || 'baseline-1.0'}` },
  ];
  const medals = ['1️⃣', '2️⃣', '3️⃣'];
  items.slice(0, 3).forEach((r, i) => {
    const j = r.job;
    els.push({ tag: 'markdown', content:
      `**${medals[i]} ${j.role}**\n${j.company}${j.city ? ' · ' + j.city : ''} · ${REL_LABEL[j.relation] || j.relation}\n`
      + `\`Fit ${dim(r, 'direction')}  Activity ${dim(r, 'activity')}  Evidence ${Math.round(r.evidence_coverage * 100)}\`\n`
      + `综合 **${r.score}** 分 · 置信${{ HIGH: '高', MEDIUM: '中', LOW: '低' }[r.confidence_band]} · ${ACTION_LABEL[r.action]}\n`
      + `理由：${r.reasons[1] || r.reasons[0]}\n⚠️ 风险：${r.risks[0] || '—'}` });
    els.push({ tag: 'action', actions: [
      btn('查看详情', `${BASE_URL}/?open=opportunity:${j.project_id}`, 'primary'),
      btn('回放', `${BASE_URL}/?open=replay:${r.decision_id}`),
    ] });
    if (i < Math.min(3, items.length) - 1) els.push({ tag: 'hr' });
  });
  const shared = items.filter((r) => r.job.relation === 'TEAM_SHARED').length;
  if (shared) els.push({ tag: 'markdown', content: `👀 团队共享观察 ${shared} 个（打开工作台查看）` });
  els.push({ tag: 'hr' });
  els.push({ tag: 'markdown', content:
    `我的承接：接单中 ${commitments.accepted_count} · 关注中 ${commitments.watched_count}/${commitments.watched_limit} · 需处理 ${commitments.need_action_count}` });
  els.push({ tag: 'action', actions: [btn('打开工作台', `${BASE_URL}/`, 'primary')] });
  els.push({ tag: 'note', elements: [{ tag: 'plain_text',
    content: `run: ${(run?.run_id || '').slice(0, 8)} · snapshot: ${(snapshot_id || '').slice(0, 8)} · ${run?.policy_version || ''}` }] });

  // 实测（2026-08-07, ErrCode 200861）：schema 2.0 已移除 action 标签 → 用 legacy v1 卡片，
  // markdown/hr/note/action/multi_url 全部支持，深链按钮行为一致。
  return { config: { wide_screen_mode: true },
    header: { template: TEMPLATE[state], title: { tag: 'plain_text',
      content: `Brain X · 今日职位决策 ${now().slice(5, 16).replace('T', ' ')}` } },
    elements: els };
}

/** 同步异常卡（文案与前端 PRD §10 逐字一致）。 */
export function buildSyncAlertCard(sync) {
  const state = sync.complete ? 'READY' : 'INCOMPLETE';
  const msgs = { INCOMPLETE: ['本次同步不完整', '为避免误导，暂不生成正式推荐'],
                 AUTH_EXPIRED: ['TTC 登录状态已失效', '请重新登录后再同步'],
                 ERROR: ['同步失败', '请检查数据源后重试'] };
  const [title, sub] = msgs[state] || msgs.INCOMPLETE;
  return { config: { wide_screen_mode: true },
    header: { template: TEMPLATE[state] || 'orange', title: { tag: 'plain_text', content: `Brain X · ${title}` } },
    elements: [
      { tag: 'markdown', content: `**${title}**\n${sub}\n读取 ${sync.rows_read}/${sync.rows_expected} 行` },
      { tag: 'action', actions: [btn('打开工作台处理', `${BASE_URL}/?view=sync`, 'primary')] },
    ] };
}

/** 重大变化提醒卡（P4）：Top1 易主 / ACCEPT 档新进 Top3。仅推顾问本人，绝不推群。 */
export function buildHeatingAlertCard({ change_label, item }) {
  const j = item.job;
  return { config: { wide_screen_mode: true },
    header: { template: 'red', title: { tag: 'plain_text',
      content: `Brain X · 重大变化提醒 ${now().slice(5, 16).replace('T', ' ')}` } },
    elements: [
      { tag: 'markdown', content: `**${change_label}**\n`
        + `**${j.role}**\n${j.company}${j.city ? ' · ' + j.city : ''} · ${REL_LABEL[j.relation] || j.relation}\n`
        + `综合 **${item.score}** 分 · ${ACTION_LABEL[item.action] || item.action}\n`
        + `理由：${item.reasons?.[1] || item.reasons?.[0] || '—'}` },
      { tag: 'action', actions: [
        btn('查看详情', `${BASE_URL}/?open=opportunity:${j.project_id}`, 'primary'),
        btn('打开工作台', `${BASE_URL}/`),
      ] },
      { tag: 'note', elements: [{ tag: 'plain_text',
        content: `run: ${(item.run_id || '').slice(0, 8)} · 自动推送（仅发本人）` }] },
    ] };
}

/** 推送（幂等：consultant+kind+run_id 唯一；SENT 重复 → SKIPPED_DUPLICATE；FAILED 可重发并更新原行）。 */
export function pushCard(db, { consultant_id, kind, run_id, card, target, send = false }) {
  const dup = db.prepare(`SELECT push_id, status FROM push_log
    WHERE consultant_id=? AND kind=? AND run_id IS ?`).get(consultant_id, kind, run_id ?? null);
  if (dup && dup.status !== 'FAILED') {
    // 唯一键（consultant+kind+run_id）即幂等保证：已成功的推送跳过，
    // 返回首次记录——该 run 在 push_log 中永远只有一条成功记录。
    return { ok: true, status: 'SKIPPED_DUPLICATE', push_id: dup.push_id };
  }
  let status = 'SENT', message_id = null, error = null;
  if (send) {
    try {
      // lark-cli 1.0.67 无 im messages create 打字命令 → 走 api 逃生舱（bot 身份，im:message:send_as_bot）。
      // 卡片 content 需要二次 stringify（Feishu 契约：content 是 JSON 字符串）。
      const out = execFileSync('lark-cli', ['api', 'POST', '/open-apis/im/v1/messages', '--as', 'bot',
        '--params', JSON.stringify({ receive_id_type: target.startsWith('oc_') ? 'chat_id' : 'open_id' }),
        '--data', JSON.stringify({ receive_id: target, msg_type: 'interactive',
                                   content: JSON.stringify(card) })],
        { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
      const d = JSON.parse(out.slice(out.indexOf('{')));
      // api 逃生舱可能直出 Feishu 响应（{code,data:{message_id}}）或包一层 {ok,data}
      const feishu = d?.data?.code != null ? d.data : d;
      if (feishu?.code !== 0 && feishu?.ok !== true) {
        throw new Error(feishu?.msg || feishu?.error?.message || JSON.stringify(d).slice(0, 200));
      }
      message_id = feishu?.data?.message_id || d?.data?.data?.message_id || null;
    } catch (e) { status = 'FAILED'; error = String(e.message || e).slice(0, 300); }
  } else {
    status = 'PREVIEW';
  }
  if (dup) {
    // 重发失败行：更新同一 push_id，保持唯一键语义与审计连续
    db.prepare(`UPDATE push_log SET card_json=?, target=?, message_id=?, status=?, error=?, created_at=?
      WHERE push_id=?`)
      .run(JSON.stringify(card), target, message_id, status, error, now(), dup.push_id);
    return { ok: status !== 'FAILED', push_id: dup.push_id, status, message_id, error };
  }
  const push_id = uuid();
  db.prepare(`INSERT INTO push_log (push_id, consultant_id, kind, run_id, card_json, target, message_id, status, error, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(push_id, consultant_id, kind, run_id ?? null, JSON.stringify(card), target, message_id, status, error, now());
  return { ok: status !== 'FAILED', push_id, status, message_id, error };
}
