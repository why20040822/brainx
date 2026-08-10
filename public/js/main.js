/** main.js — 页面编排（对应 PRD §13 workbench.tsx：只编排，不承载数据逻辑）。
 * 深链（补全文档 §18.5）：?open=opportunity:<pid> / ?open=replay:<did> / ?view=commitments|sync
 */
import { api, gestureKey, clearGesture } from './api-client.js';
import { renderHeader } from './components/WorkbenchHeader.js';
import { renderQueue } from './components/DecisionQueue.js';
import { renderDrawer, createDrawerController } from './components/OpportunityDrawer.js';
import { CommitmentSummary, CommitmentList } from './components/CommitmentSummary.js';
import { ReplayContent } from './components/ReplayPanel.js';

const $ = (id) => document.getElementById(id);
const live = (msg) => { $('live').textContent = msg; };
const drawer = createDrawerController();

let model = null;       // workbench 模型
let recs = [];          // 推荐列表（API 排序原样渲染，前端不重排）
let blocked = false;
let showAll = false;

async function refresh() {
  const [wb, r] = await Promise.all([api.workbench(), api.recommendations(10)]);
  model = wb;
  blocked = !!r.blocked;
  recs = r.items || [];
  renderAll();
}

function renderAll() {
  renderHeader($('wb-header'), { consultant_id: model.consultant_id, sync: model.sync,
    feishu_auth: model.feishu_auth }, {
    onSync: doSync, onLogout: doLogout,
  });
  renderQueue({
    queueEl: $('queue'), expandEl: $('expand-slot'), subEl: $('queue-sub'),
    items: recs, showAll, blocked,
    onOpen: openOpportunity, onAction: rowAction,
    onToggleAll: () => { showAll = !showAll; renderAll(); },
    onSync: doSync,
  });
  $('commit-strip').replaceChildren(CommitmentSummary({ model }));
  $('commit-list').replaceChildren(CommitmentList({
    items: model.commitments,
    onOpen: openOpportunity, onAction: rowAction,
  }));
  $('main').setAttribute('aria-busy', 'false');
}

/* ── 动作流（PRD §4.3 交互规则）── */
async function rowAction(action, recOrItem, btn) {
  const pid = recOrItem.job?.project_id || recOrItem.project_id;
  if (action === 'VIEW') return openOpportunity(pid);
  if (action === 'ACCEPT') return confirmAccept(pid, btn);
  if (action === 'DISMISS') return pickDismissReason(pid, btn);
  if (action === '__OUTCOME__') return submitOutcome(pid, arguments[3]);
  return doEngage(pid, action, btn, { optimistic: action === 'WATCH' || action === 'UNWATCH' });
}

async function doEngage(pid, action, btn, { optimistic = false, extra = {} } = {}) {
  const idempotency_key = gestureKey(btn, `${action}:${pid}`);
  btn.disabled = true;
  let rollback;
  if (optimistic) {
    const oldText = btn.textContent;
    btn.textContent = action === 'WATCH' ? '已关注 ✓' : '已取消';
    rollback = () => { btn.textContent = oldText; };
  }
  try {
    const out = await api.engage(pid, action, { idempotency_key, ...extra });
    live(out.already ? '操作已记录过（幂等去重）' : `${action} 成功，当前状态 ${out.state}`);
    clearGesture(btn);
    await refresh();
  } catch (e) {
    if (rollback) rollback(); // 乐观更新失败回滚
    if (e.status === 409 && e.payload?.state) {
      live(`状态冲突：${e.message}，已为你刷新`);
      await refresh();        // 非法状态：提示并刷新当前状态（§4.3）
    } else {
      live(`操作失败：${e.message}`);
    }
  } finally {
    btn.disabled = false;
  }
}

/* ACCEPT 二次确认（不允许乐观更新） */
function confirmAccept(pid, btn) {
  showModal({
    title: '确认接单？',
    body: '将记录 ACCEPTED 事件。接单后该职位进入你的交付列表。',
    okText: '确认接单', okPrimary: true,
    onOk: () => doEngage(pid, 'ACCEPT', btn, { extra: { confirm: true } }),
  });
}

/* DISMISS 必须选择原因（七枚举，§4.3） */
async function pickDismissReason(pid, btn) {
  const { items } = await api.dismissReasons();
  showModal({
    title: '暂不考虑的原因（必选）',
    bodyHTML: `<div class="reason-list">${items.map((r, i) =>
      `<label><input type="radio" name="reason" value="${r}" ${i ? '' : 'checked'}> ${r}</label>`).join('')}</div>`,
    okText: '提交', okPrimary: false,
    collect: () => document.querySelector('input[name="reason"]:checked')?.value,
    onOk: (reason) => reason && doEngage(pid, 'DISMISS', btn, { extra: { reason } }),
  });
}

async function submitOutcome(pid, payload) {
  try {
    await api.outcomes({ project_id: pid, idempotency_key: `web:outcome:${pid}:${crypto.randomUUID()}`, ...payload });
    live('结果已记录');
    await refresh();
  } catch (e) { live(`记录失败：${e.message}`); }
}

/* ── 抽屉 ── */
async function openOpportunity(recOrPid) {
  const pid = typeof recOrPid === 'string' ? recOrPid : recOrPid.job.project_id;
  // VIEW 事件（从推荐列表点入才记；承接列表点入也记——幂等键按分钟粒度防连击）
  api.engage(pid, 'VIEW', { idempotency_key: `view:${pid}:${Date.now() >> 16}` }).catch(() => {});
  const detail = await api.opportunity(pid);
  renderDrawer({
    drawerEl: $('drawer'), detail,
    onAction: rowAction,
    onReplay: openReplay,
    onClose: drawer.close,
  });
  drawer.open();
}

async function openReplay(decisionId) {
  const data = await api.replay(decisionId);
  const el = $('drawer');
  el.innerHTML = '';
  const close = document.createElement('button');
  close.className = 'btn btn-quiet drawer-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', '关闭回放');
  close.addEventListener('click', drawer.close);
  el.append(close, ReplayContent({ data }));
  drawer.open();
}

/* ── 模态（二次确认/原因选择；Esc 关闭；焦点管理）── */
let modalLastFocus = null;
function showModal({ title, body, bodyHTML, okText, okPrimary, onOk, collect }) {
  const mask = $('modal-mask'), modal = $('modal');
  modalLastFocus = document.activeElement;
  modal.innerHTML = `<h3 id="modal-title"></h3><div class="modal-body"></div>
    <div class="btn-row"><button type="button" class="btn" data-x="cancel">取消</button>
    <button type="button" class="btn ${okPrimary ? 'btn-primary' : ''}" data-x="ok"></button></div>`;
  modal.querySelector('h3').textContent = title;
  if (bodyHTML) modal.querySelector('.modal-body').innerHTML = bodyHTML;
  else modal.querySelector('.modal-body').textContent = body || '';
  modal.querySelector('[data-x=ok]').textContent = okText;
  const close = () => {
    mask.classList.remove('open'); modal.hidden = true;
    document.removeEventListener('keydown', onEsc, true);
    modalLastFocus?.focus?.();
  };
  const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onEsc, true);
  modal.querySelector('[data-x=cancel]').addEventListener('click', close);
  mask.addEventListener('click', close);
  modal.querySelector('[data-x=ok]').addEventListener('click', () => {
    const v = collect ? collect() : true;
    if (v == null) return;
    close(); onOk(v);
  });
  mask.classList.add('open'); modal.hidden = false;
  (modal.querySelector('[data-x=ok]')).focus();
}

/* ── 同步 / 退出 ── */
async function doSync() {
  live('同步中…');
  try {
    const out = await api.syncRuns('fixture');
    if (out.complete) {
      await api.runRecommend();
      live(`同步完成，${out.rows_read} 行，已生成新推荐`);
    } else {
      live(`同步不完整：${out.errors.length} 条错误，正式推荐已阻断`);
    }
  } catch (e) { live(`同步失败：${e.message}`); }
  await refresh();
}

async function doLogout() {
  await api.logout().catch(() => {});
  location.href = '/login';
}

/* ── 深链（§18.5）：每次打开都是实时渲染 ── */
function handleDeepLink() {
  const q = new URLSearchParams(location.search);
  const open = q.get('open') || '';
  if (open.startsWith('opportunity:')) openOpportunity(open.slice(12));
  else if (open.startsWith('replay:')) openReplay(open.slice(7));
  else if (q.get('view') === 'commitments') $('commitments').scrollIntoView();
  else if (q.get('view') === 'sync') live('同步状态见右上角胶囊；点「同步」立即重跑');
}

refresh().then(handleDeepLink).catch((e) => {
  if (e.message !== '未登录') {
    $('queue').innerHTML = `<div class="banner" role="alert"><strong>推荐服务失败</strong><br>
      Agent 暂时无法生成解释，仍可查看原始职位事实。</div>`;
  }
});

/* ── 实时更新（P2）：桥接器有变化 → SSE 推送 → 静默刷新 + 播报 ── */
(() => {
  const es = new EventSource('/api/v1/events');
  let pending = null;
  es.onmessage = (e) => {
    let d;
    try { d = JSON.parse(e.data); } catch { return; }
    if (d.type === 'hello') return;
    if (d.type === 'sync_error') { live(`桥接同步异常：${d.message || '未知'}（下轮自动重试）`); return; }
    if (d.type === 'sync' || d.type === 'recommend') {
      // 1s 去抖：sync 与 recommend 常成对到达，只刷一次
      clearTimeout(pending);
      pending = setTimeout(async () => {
        await refresh();
        live(d.type === 'sync'
          ? `数据已更新（新消息 ${d.new_messages ?? 0} 条，命中 ${d.matched ?? 0}）`
          : '推荐已刷新');
      }, 1000);
    }
  };
  es.onerror = () => live('实时连接断开，自动重连中…'); // EventSource 自带指数重连
})();
