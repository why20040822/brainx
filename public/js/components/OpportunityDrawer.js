/** OpportunityDrawer.js — 职位详情抽屉（PRD §4）+ 决策轨迹（DecisionTrail）。
 * a11y：focus trap、Esc 关闭、关闭后焦点回原行（§12）。
 */
import { REL_LABEL, ACTION_LABEL, BAND_LABEL, DIM_LABEL, STATE_LABEL } from '../types.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function DecisionTrail({ events }) {
  const wrap = document.createElement('div');
  wrap.innerHTML = '<h3>决策轨迹</h3>';
  if (!events?.length) {
    wrap.insertAdjacentHTML('beforeend', '<p class="muted">暂无事件</p>');
    return wrap;
  }
  for (const e of events) {
    const line = document.createElement('div');
    line.className = 'event-line';
    line.innerHTML = `<time>${esc((e.occurred_at || '').slice(5, 16).replace('T', ' '))}</time>`
      + `${esc(e.event_type)}${e.reason ? ' · ' + esc(e.reason) : ''}`;
    wrap.appendChild(line);
  }
  return wrap;
}

export function renderDrawer({ drawerEl, detail, onAction, onReplay, onClose }) {
  const j = detail.job;
  const rec = detail.latest_recommendation;
  drawerEl.innerHTML = `
    <button type="button" class="btn btn-quiet drawer-close" aria-label="关闭详情">✕</button>
    <h2 id="drawer-title">${esc(j.role)}</h2>
    <p class="muted" style="margin-top:0">${esc(j.company)}</p>
    <dl class="kv">
      <dt>project_id</dt><dd class="mono">${esc(j.project_id)}</dd>
      <dt>城市</dt><dd>${esc(j.city || '未知')}</dd>
      <dt>我的关系</dt><dd>${esc(REL_LABEL[j.relation] || j.relation)}</dd>
      <dt>Pipeline</dt><dd>${esc(j.pipeline || '未知')}</dd>
      <dt>HC</dt><dd>${j.hc == null ? '未知' : esc(j.hc)}</dd>
      <dt>状态</dt><dd>${esc(j.active_state)}</dd>
      <dt>承接状态</dt><dd>${esc(STATE_LABEL[detail.engagement_state] || detail.engagement_state)}</dd>
      <dt>来源</dt><dd>${j.source_url ? `<a href="${esc(j.source_url)}" target="_blank" rel="noreferrer">TTC 来源链接 ↗</a>` : '—'}</dd>
      <dt>最近更新</dt><dd class="mono">${esc(String(j.updated_at || j.captured_at || '').slice(0, 16).replace('T', ' '))}</dd>
    </dl>
    <div id="drawer-decision"></div>
    <div id="drawer-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0"></div>
    <div id="drawer-outcome"></div>
    <div id="drawer-trail"></div>`;

  // 决策依据（§4.2：必须事实依据，不是"AI 判断"）
  const dec = drawerEl.querySelector('#drawer-decision');
  if (rec) {
    const rows = (rec.breakdown || []).map((d) => `
      <div class="breakdown-row">
        <span>${esc(DIM_LABEL[d.dim] || d.dim)} <span class="muted">${Math.round(d.weight * 100)}%</span></span>
        <span class="track"><span class="fill" style="width:${d.score == null ? 0 : d.score}%"></span></span>
        <span class="val">${d.score == null ? '—' : d.score}</span>
      </div>`).join('');
    dec.innerHTML = `
      <h3>决策依据</h3>
      <p style="margin:4px 0"><strong class="mono" style="font-size:19px">${rec.score.toFixed(1)}</strong>
        分 · ${esc(BAND_LABEL[rec.confidence_band] || '')} · 证据覆盖 ${Math.round(rec.evidence_coverage * 100)}%</p>
      ${rows}
      <h3>推荐理由</h3>
      <ul>${rec.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <h3>风险</h3>
      <ul>${rec.risks.length ? rec.risks.map((r) => `<li>${esc(r)}</li>`).join('') : '<li class="muted">无显著风险</li>'}</ul>
      <h3>证据来源</h3>
      <ul>${rec.evidence_refs.map((e) => `<li><span class="muted">${esc(e.type)}</span> ${esc(e.excerpt)}</li>`).join('')}</ul>
      <button type="button" class="btn btn-quiet" id="btn-replay">查看回放 →</button>`;
    dec.querySelector('#btn-replay').addEventListener('click', () => onReplay(rec.decision_id));
  } else {
    dec.innerHTML = '<h3>决策依据</h3><p class="muted">该职位暂无推荐记录</p>';
  }

  // 操作（§4.3）
  const act = drawerEl.querySelector('#drawer-actions');
  const buttons = [
    ['WATCH', '关注', false], ['ACCEPT', '接单', true], ['DISMISS', '暂不考虑', false],
    ['UNWATCH', '取消关注', false], ['RELEASE', '释放', false], ['COMPLETE', '完成', false],
  ];
  for (const [action, label, primary] of buttons) {
    if (!detail.legal_actions?.includes(action)) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = primary ? 'btn btn-primary' : 'btn';
    b.textContent = label;
    b.addEventListener('click', () => onAction(action, detail, b));
    act.appendChild(b);
  }

  // 结果记录（Slice 5）
  const oc = drawerEl.querySelector('#drawer-outcome');
  if (detail.engagement_state === 'ACCEPTED') {
    oc.innerHTML = `<h3>记录结果</h3>
      <form id="outcome-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select name="stage" class="btn" aria-label="结果阶段">
          ${['推荐采纳', '面试', 'Offer', '入职', '关闭', '反馈'].map((s) => `<option>${s}</option>`).join('')}
        </select>
        <select name="rating" class="btn" aria-label="评分">
          <option value="">不打分</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n} 分</option>`).join('')}
        </select>
        <input name="note" class="btn" style="flex:1;min-width:120px" placeholder="备注（可选）" aria-label="备注">
        <button type="submit" class="btn btn-primary">提交</button>
      </form>`;
    oc.querySelector('#outcome-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      onAction('__OUTCOME__', detail, e.target.querySelector('button'), {
        stage: fd.get('stage'),
        value: { rating: fd.get('rating') ? Number(fd.get('rating')) : undefined, note: fd.get('note') || undefined },
      });
    });
  }

  drawerEl.querySelector('#drawer-trail').replaceChildren(DecisionTrail({ events: detail.events }));
  drawerEl.querySelector('.drawer-close').addEventListener('click', onClose);
}

/** 抽屉开关 + focus trap + Esc + 焦点还原（§12）。 */
export function createDrawerController() {
  const drawer = document.getElementById('drawer');
  const mask = document.getElementById('drawer-mask');
  let lastFocus = null;

  const focusables = () => drawer.querySelectorAll('button, a[href], input, select, [tabindex]:not([tabindex="-1"])');

  function onKeydown(e) {
    if (!drawer.classList.contains('open')) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') {
      const f = [...focusables()];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }
  }
  document.addEventListener('keydown', onKeydown);

  function open() {
    lastFocus = document.activeElement;
    mask.classList.add('open');
    drawer.classList.add('open');
    setTimeout(() => (drawer.querySelector('.drawer-close') || drawer).focus(), 30);
  }
  function close() {
    mask.classList.remove('open');
    drawer.classList.remove('open');
    if (lastFocus?.focus) lastFocus.focus();
  }
  mask.addEventListener('click', close);
  return { open, close, isOpen: () => drawer.classList.contains('open') };
}
