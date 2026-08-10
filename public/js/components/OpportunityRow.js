/** OpportunityRow.js — 职位行 + 三段信号条（PRD §3.3）。前端只渲染 API 排序。 */
import { REL_LABEL, ACTION_LABEL, BAND_LABEL } from '../types.js';

export function SignalBar({ rec }) {
  const bar = document.createElement('div');
  bar.className = 'signal-bar';
  const dim = (name) => rec.breakdown?.find((d) => d.dim === name)?.score;
  const items = [
    ['Fit', dim('direction')],
    ['Activity', dim('activity')],
    ['Evidence', Math.round((rec.evidence_coverage || 0) * 100)],
  ];
  for (const [lbl, val] of items) {
    const item = document.createElement('span');
    item.className = 'signal-item';
    const pct = val == null ? 0 : Math.min(100, val);
    item.innerHTML = `<span class="lbl">${lbl}</span>
      <span class="signal-track"><span class="signal-fill ${val != null && val < 60 ? 'warn' : ''}" style="width:${pct}%"></span></span>
      <span class="mono">${val == null ? '—' : val}</span>`;
    bar.appendChild(item);
  }
  return bar;
}

export function OpportunityRow({ rec, expanded, onOpen, onAction }) {
  const j = rec.job;
  // 注意：外层不能是 <button>（按钮嵌套按钮是非法 HTML，浏览器重排 DOM 会产生幽灵事件）。
  // 用 article + role=button + 键盘支持，行动作仍是真实 <button>（PRD §12）。
  const row = document.createElement('article');
  row.className = 'opp-row';
  row.dataset.projectId = j.project_id;
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', `${j.role}，${j.company}，${rec.score} 分，查看详情`);

  const head = document.createElement('div');
  head.className = 'opp-head';
  head.innerHTML = `
    <span class="opp-role"></span>
    <span class="opp-meta"></span>
    <span class="rel-tag ${j.relation}"></span>
    <span class="opp-action-tag ${rec.action}"></span>
    <span class="opp-score"></span>`;
  head.querySelector('.opp-role').textContent = j.priority === 'HIGH' ? `🔥 ${j.role}` : j.role;
  head.querySelector('.opp-meta').textContent = `${j.company}${j.city ? ' · ' + j.city : ''}`;
  head.querySelector('.rel-tag').textContent = REL_LABEL[j.relation] || j.relation;
  head.querySelector('.opp-action-tag').textContent = ACTION_LABEL[rec.action] || rec.action;
  head.querySelector('.opp-score').textContent = rec.score.toFixed(1);

  row.appendChild(head);
  row.appendChild(SignalBar({ rec }));

  if (expanded) {
    const reason = document.createElement('p');
    reason.className = 'opp-reason';
    reason.textContent = `推荐理由：${rec.reasons[1] || rec.reasons[0] || ''}`;
    const risk = document.createElement('p');
    risk.className = 'opp-risk';
    risk.textContent = rec.risks[0] ? `风险：${rec.risks[0]}` : '';
    row.append(reason, risk);

    const actions = document.createElement('div');
    actions.className = 'opp-actions';
    for (const [action, label, primary] of [['VIEW', '查看', false], ['WATCH', '关注', false], ['ACCEPT', '接单', true]]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = primary ? 'btn btn-primary' : 'btn';
      b.textContent = label;
      b.addEventListener('click', (e) => { e.stopPropagation(); onAction(action, rec, b); });
      actions.appendChild(b);
    }
    row.appendChild(actions);
  }

  row.addEventListener('click', (e) => { if (!e.target.closest('button')) onOpen(rec); });
  row.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); onOpen(rec); }
  });
  return row;
}
