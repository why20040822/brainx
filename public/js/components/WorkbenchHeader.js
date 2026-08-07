/** WorkbenchHeader.js — 产品名/顾问/同步状态胶囊/同步按钮（PRD §3.2）。 */
import { REL_LABEL } from '../types.js';

const SYNC_LABEL = { READY: '已同步', RUNNING: '同步中', INCOMPLETE: '本次同步不完整',
  AUTH_EXPIRED: 'TTC 登录失效', ERROR: '同步失败', EMPTY: '尚未同步' };

export function renderHeader(el, { consultant_id, sync }, { onSync, onLogout }) {
  el.innerHTML = '';
  const brand = document.createElement('h1');
  brand.className = 'wb-brand';
  brand.textContent = 'Brain X';
  const actor = document.createElement('span');
  actor.className = 'wb-actor';
  actor.textContent = consultant_id;
  const spacer = document.createElement('span');
  spacer.className = 'spacer';

  const pill = document.createElement('span');
  pill.className = 'sync-pill';
  pill.setAttribute('role', 'status');
  const dot = document.createElement('span');
  dot.className = `sync-dot ${sync.state}`;
  const time = sync.updated_at ? new Date(sync.updated_at).toTimeString().slice(0, 5) : '';
  const txt = document.createElement('span');
  txt.textContent = `${SYNC_LABEL[sync.state] || sync.state}${time ? ' · ' + time : ''}`;
  pill.append(dot, txt);

  const syncBtn = document.createElement('button');
  syncBtn.className = 'btn btn-quiet';
  syncBtn.textContent = '同步';
  syncBtn.addEventListener('click', onSync);

  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'btn btn-quiet';
  logoutBtn.textContent = '退出';
  logoutBtn.addEventListener('click', onLogout);

  el.append(brand, actor, spacer, pill, syncBtn, logoutBtn);
}
