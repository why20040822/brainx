/** ReplayPanel.js — 决策回放抽屉内容（PRD §7）：冻结快照 + 当时评分 + 后续事件与结果。 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function ReplayContent({ data }) {
  const r = data.recommendation;
  const run = data.run || {};
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h3>决策回放</h3>
    <dl class="kv">
      <dt>decision_id</dt><dd class="mono">${esc(String(data.decision_id).slice(0, 13))}…</dd>
      <dt>run_id</dt><dd class="mono">${esc(String(run.run_id || '').slice(0, 13))}…</dd>
      <dt>快照时间</dt><dd class="mono">${esc(String(run.created_at || '').slice(0, 16).replace('T', ' '))}</dd>
      <dt>策略版本</dt><dd>${esc(run.policy_version || r.policy_version || '')}</dd>
      <dt>当时排名</dt><dd>第 ${esc(r.rank)} 位 · ${esc(r.score)} 分 · ${esc(r.action)}</dd>
      <dt>当轮输入</dt><dd>${esc(run.candidate_count ?? '—')} 个候选职位</dd>
    </dl>
    <h3>当时评分维度</h3>
    ${(r.score_breakdown || []).map((d) => `
      <div class="breakdown-row">
        <span>${esc(d.dim)} <span class="muted">${Math.round(d.weight * 100)}%</span></span>
        <span class="track"><span class="fill" style="width:${d.score == null ? 0 : d.score}%"></span></span>
        <span class="val">${d.score == null ? '—' : d.score}</span>
      </div>`).join('')}
    <h3>当时推荐理由与风险</h3>
    <ul>${(r.reasons || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <ul>${(r.risks || []).map((x) => `<li class="muted">${esc(x)}</li>`).join('')}</ul>
    <h3>当时证据</h3>
    <ul>${(r.evidence_refs || []).map((e) => `<li><span class="muted">${esc(e.type)}</span> ${esc(e.excerpt)}</li>`).join('')}</ul>
    <h3>顾问操作</h3>
    ${(data.events || []).map((e) => `<div class="event-line"><time>${esc((e.occurred_at || '').slice(5, 16).replace('T', ' '))}</time>${esc(e.event_type)}${e.reason ? ' · ' + esc(e.reason) : ''}</div>`).join('') || '<p class="muted">无</p>'}
    <h3>后续结果</h3>
    ${(data.outcomes || []).map((o) => `<div class="event-line"><time>${esc((o.observed_at || '').slice(5, 10))}</time>${esc(o.stage)} ${o.value?.rating ? '· ' + o.value.rating + ' 分' : ''} ${o.value?.note ? '· ' + esc(o.value.note) : ''}</div>`).join('') || '<p class="muted">暂无结果记录</p>'}
    ${data.job_now ? `<p class="muted" style="margin-top:14px">职位现状：${esc(data.job_now.active_state)}（回放以上方冻结数据为准）</p>` : ''}`;
  return wrap;
}
