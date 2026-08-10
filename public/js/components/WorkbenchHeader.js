/** WorkbenchHeader.js — 产品名/顾问/同步状态胶囊/同步按钮（PRD §3.2）。 */
import { REL_LABEL } from '../types.js';

const SYNC_LABEL = { READY: '已同步', RUNNING: '同步中', INCOMPLETE: '本次同步不完整',
  AUTH_EXPIRED: 'TTC 登录失效', ERROR: '同步失败', EMPTY: '尚未同步' };

export function renderHeader(el, { consultant_id, sync, feishu_auth }, { onSync, onLogout }) {
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

  // 飞书数据授权未启用/已过期 → 醒目重登入口（按人桥接的凭据在登录时落库）
  let authLink = null;
  if (feishu_auth && (!feishu_auth.authorized || feishu_auth.needs_reauth)) {
    authLink = document.createElement('a');
    authLink.className = 'sync-pill auth-warn';
    authLink.href = '/api/v1/oauth/authorize';
    authLink.textContent = feishu_auth.needs_reauth ? '飞书授权已过期 · 点击重登' : '启用飞书实时同步 · 点击授权';
  }

  const syncBtn = document.createElement('button');
  syncBtn.className = 'btn btn-quiet';
  syncBtn.textContent = '同步';
  syncBtn.addEventListener('click', onSync);

  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'btn btn-quiet';
  logoutBtn.textContent = '退出';
  logoutBtn.addEventListener('click', onLogout);

  el.append(brand, actor, spacer, ...(authLink ? [authLink] : []), pill, syncBtn, logoutBtn);
}
