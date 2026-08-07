/** CommitmentSummary.js — 我的承接摘要 + 列表（PRD §6：主页面下方，非独立页）。 */
import { STATE_LABEL } from '../types.js';

export function CommitmentSummary({ model }) {
  const strip = document.createElement('div');
  strip.className = 'commit-strip';
  strip.innerHTML = `
    <span><span class="commit-num">${model.accepted_count}</span> <span class="commit-lbl">接单中</span></span>
    <span><span class="commit-num">${model.watched_count}<span class="muted">/${model.watched_limit}</span></span> <span class="commit-lbl">关注中</span></span>
    <span><span class="commit-num">${model.need_action_count}</span> <span class="commit-lbl">需要处理</span></span>`;
  return strip;
}

export function CommitmentList({ items, onOpen, onAction }) {
  const wrap = document.createElement('div');
  if (!items?.length) {
    wrap.innerHTML = '<p class="muted">暂无承接职位。从上方推荐里点「关注」开始。</p>';
    return wrap;
  }
  for (const c of items) {
    const row = document.createElement('div');
    row.className = 'commit-item';
    row.innerHTML = `<strong></strong><span class="muted"></span><span></span><span class="next"></span>`;
    row.querySelector('strong').textContent = c.role || c.project_id;
    row.querySelector('.muted').textContent = c.company || '';
    row.querySelectorAll('span')[2].textContent = STATE_LABEL[c.state] || c.state;
    row.querySelector('.next').textContent = c.next_action || '';
    const btnWrap = document.createElement('span');
    btnWrap.style.cssText = 'margin-left:auto;display:flex;gap:6px';
    const open = document.createElement('button');
    open.className = 'btn btn-quiet';
    open.textContent = '详情';
    open.addEventListener('click', () => onOpen(c.project_id));
    btnWrap.appendChild(open);
    if (c.state === 'WATCHED') {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = '取消关注';
      b.addEventListener('click', () => onAction('UNWATCH', c, b));
      btnWrap.appendChild(b);
    }
    if (c.state === 'ACCEPTED') {
      for (const [a, label] of [['RELEASE', '释放'], ['COMPLETE', '完成']]) {
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = label;
        b.addEventListener('click', () => onAction(a, c, b));
        btnWrap.appendChild(b);
      }
    }
    row.appendChild(btnWrap);
    wrap.appendChild(row);
  }
  return wrap;
}
