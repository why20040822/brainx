/** api-client.js — 唯一数据通道（PRD §9：组件不得直接 fetch/import fixture/读库）。
 * 401 统一跳 /login；业务状态不落 localStorage（§15 验收条）。
 */

async function req(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { location.href = '/login'; throw new Error('未登录'); }
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) {
    const e = new Error(data?.error?.message || `HTTP ${r.status}`);
    e.status = r.status; e.code = data?.error?.code; e.payload = data;
    throw e;
  }
  return data;
}

export const api = {
  workbench: () => req('GET', '/api/v1/workbench'),
  recommendations: (limit = 10) => req('GET', `/api/v1/recommendations?limit=${limit}`),
  runRecommend: () => req('POST', '/api/v1/recommendations/run'),
  opportunity: (id) => req('GET', `/api/v1/opportunities/${encodeURIComponent(id)}`),
  engage: (id, action, opts) =>
    req('POST', `/api/v1/opportunities/${encodeURIComponent(id)}/engagement`, { action, ...opts }),
  replay: (decisionId) => req('GET', `/api/v1/decisions/${encodeURIComponent(decisionId)}/replay`),
  syncRuns: (source = 'fixture', dryRun = false) => req('POST', '/api/v1/sync-runs', { source, dry_run: dryRun }),
  outcomes: (payload) => req('POST', '/api/v1/outcomes', payload),
  dismissReasons: () => req('GET', '/api/v1/dismiss-reasons'),
  logout: () => req('DELETE', '/api/v1/session'),
};

/** 幂等键（PRD §4.3：同一次操作手势重复点击用同一 key）。
 * key 生成后挂在按钮 dataset 上，in-flight 期间复用，成功后清除。 */
export function gestureKey(btnEl, scope) {
  if (!btnEl.dataset.idem) btnEl.dataset.idem = `web:${scope}:${crypto.randomUUID()}`;
  return btnEl.dataset.idem;
}
export function clearGesture(btnEl) { delete btnEl.dataset.idem; }
