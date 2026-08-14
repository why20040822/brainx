/** ttcsdk/http.js — HTTP 层：超时/统一错误/JSON。server 侧调用无 CORS 限制（CORS 只约束浏览器）。 */
import { TTC_API_BASE } from './config.js';

export class TtcApiError extends Error {
  constructor(message, { status = null, code = null, authInvalid = false } = {}) {
    super(message);
    this.status = status; this.code = code; this.authInvalid = authInvalid;
  }
}

/** GET/POST JSON。jwt 必填（Bearer）。45s 超时与全仓一致。 */
export async function ttcRequest(jwt, method, path, body = undefined, fetchImpl = fetch) {
  const resp = await fetchImpl(`${TTC_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json',
               Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new TtcApiError(`ttc auth 失效（HTTP ${resp.status}）`, { status: resp.status, authInvalid: true });
  }
  if (!resp.ok) throw new TtcApiError(`ttc http ${resp.status}`, { status: resp.status });
  const d = await resp.json();
  // 业务层 code 非 0 且消息含登录/授权 → 同样视为凭据失效
  const msg = String(d?.msg || '');
  if (d?.code !== 0 && /登录|授权|token|jwt|auth/i.test(msg)) {
    throw new TtcApiError(`ttc 业务鉴权失败：${msg}`, { code: d.code, authInvalid: true });
  }
  if (d?.code !== 0) throw new TtcApiError(`ttc code=${d.code} ${msg}`.slice(0, 200), { code: d.code });
  return d.data;
}
