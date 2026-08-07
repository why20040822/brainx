/** DecisionQueue.js — Top3 默认 / Top10 展开；空态与阻断横幅（PRD §3.3/§10）。 */
import { OpportunityRow } from './OpportunityRow.js';

export function renderQueue({ queueEl, expandEl, subEl, items, showAll, blocked, reason, onOpen, onAction, onToggleAll, onSync }) {
  queueEl.innerHTML = '';
  expandEl.innerHTML = '';

  if (blocked) {
    // 数据不完整：阻断正式推荐（§10 文案）
    queueEl.innerHTML = `<div class="banner" role="alert">
      <strong>本次同步不完整</strong><br>为避免误导，暂不生成正式推荐。</div>`;
    const b = document.createElement('button');
    b.className = 'btn btn-primary';
    b.textContent = '重新同步';
    b.addEventListener('click', onSync);
    queueEl.appendChild(b);
    subEl.textContent = '';
    return;
  }
  if (!items.length) {
    queueEl.innerHTML = `<div class="empty-state">
      <p><strong>当前没有可推荐职位</strong></p><p>建议先同步 TTC 职位数据</p></div>`;
    const b = document.createElement('button');
    b.className = 'btn btn-primary';
    b.textContent = '立即同步';
    b.addEventListener('click', onSync);
    queueEl.querySelector('.empty-state').appendChild(b);
    subEl.textContent = '';
    return;
  }

  const top3 = items.slice(0, 3);
  const rest = showAll ? items.slice(3, 10) : [];
  subEl.textContent = `${items.length} 个推荐职位 · 默认展示前 3 个`;
  for (const rec of top3) queueEl.appendChild(OpportunityRow({ rec, expanded: true, onOpen, onAction }));
  for (const rec of rest) queueEl.appendChild(OpportunityRow({ rec, expanded: true, onOpen, onAction }));

  if (items.length > 3) {
    const t = document.createElement('button');
    t.className = 'btn btn-quiet';
    t.textContent = showAll ? '收起 ▴' : `查看全部 Top ${Math.min(10, items.length)} →`;
    t.addEventListener('click', onToggleAll);
    expandEl.appendChild(t);
  }
}
