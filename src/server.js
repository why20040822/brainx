/** server.js — HTTP API + 静态工作台（补全文档 §16 契约）。
 * 零框架 node:http。除 session/consultants/oauth 外全部要登录 Cookie。
 */
import './env.js';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { runSync, latestSync, latestCompleteSnapshot } from './sync.js';
import { recommend, latestRun, loadConsultants } from './recommend.js';
import { engage, commitmentSummary, currentState, legalActions, DISMISS_REASONS } from './engagement.js';
import { replay, recordOutcome } from './replay.js';
import { buildDailyCard, buildSyncAlertCard, pushCard } from './push.js';
import { signSession, verifySession, cookieOf } from './session.js';
import { signState, verifyState, buildAuthorizeUrl, exchangeCode, oauthConfigured } from './oauth.js';
import { findByOpenId, updateProfile } from './roster.js';
import { startBridge } from './bridge.js';
import { startScheduler } from './scheduler.js';
import { makeAutoPush } from './autopush.js';
import { saveUserTokens, tokenStatus } from './feishu.js';
import { jobVisibleTo } from './visibility.js';
import { relationOf } from './relations.js';
import { validateJwt, saveTtcToken, ttcAuthStatus } from './ttcsdk/auth.js';
import { quota as ttcQuota } from './ttcsdk/user.js';
import { TtcApiError } from './ttcsdk/http.js';
import { radarRows, clientRows } from './radar.js';
import { effectiveJob, effectiveFactPayload, updateFactOverrides } from './facts.js';
import { chatStream, isLlmConfigured } from './llm.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
               '.svg': 'image/svg+xml', '.png': 'image/png' };
const FRONTEND_DIR = join(ROOT, 'frontend', 'btex-frontend');
const FRONTEND_HOST = process.env.BRAINX_FRONTEND_HOST || '127.0.0.1';
const FRONTEND_PORT = Number(process.env.BRAINX_FRONTEND_PORT || 4321);

/** 目录穿越判定：必须带分隔符前缀——裸 startsWith(base) 会把兄弟目录
 * （public-x/… 前缀同为 /…/public）误判为内部（2026-08-10 框架修正）。 */
export const isPathInside = (base, fp) => fp === base || fp.startsWith(base + sep);

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const err = (res, code, codeStr, message) => json(res, code, { error: { code: codeStr, message } });

const proxyFrontend = (req, res, target) => {
  const targetPath = req.url === '/login' || req.url?.startsWith('/login?')
    ? `/${req.url.slice('/login'.length)}`
    : req.url || '/';
  const proxy = http.request({
    hostname: target.host,
    port: target.port,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: `${target.host}:${target.port}` },
  }, (upstream) => {
    res.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(res);
  });
  proxy.on('error', (e) => {
    if (!res.headersSent) err(res, 502, 'FRONTEND_UNAVAILABLE', `前端服务不可用：${e.message}`);
    else res.destroy(e);
  });
  req.pipe(proxy);
};

async function body(req) {
  let s = '';
  for await (const c of req) s += c;
  try { return JSON.parse(s || '{}'); } catch { return null; }
}

export function createServer(db = openDb(), deps = {}) {
  const exchange = deps.exchangeCode || exchangeCode;
  const devAuth = process.env.BRAINX_DEV_AUTH === '1';
  const auth = (req, res) => {
    const s = verifySession(cookieOf(req));
    if (!s) err(res, 401, 'UNAUTHORIZED', '未登录或会话已过期');
    return s?.consultant_id || null;
  };

  // SSE 广播总线：res → consultant_id；事件带 consultant_id 时只发给本人（定向隔离）
  const sseClients = new Map();
  const bus = {
    emit(obj) {
      const frame = `data: ${JSON.stringify(obj)}\n\n`;
      for (const [res, ccid] of [...sseClients]) {
        if (obj.consultant_id && obj.consultant_id !== ccid) continue;
        try { res.write(frame); } catch { sseClients.delete(res); }
      }
    },
    clientCount: () => sseClients.size,
  };

  const routes = {
    'GET /api/v1/consultants': (req, res) => {
      json(res, 200, { items: loadConsultants(db)
        .map((c) => ({ consultant_id: c.consultant_id, display_name: c.display_name })) });
    },
    // —— 飞书 OAuth 网页授权（多顾问登录的唯一正式入口）——
    'GET /api/v1/oauth/status': (req, res) => {
      json(res, 200, { configured: oauthConfigured(), dev_auth: devAuth });
    },
    'GET /api/v1/oauth/authorize': (req, res) => {
      if (!oauthConfigured()) {
        return err(res, 503, 'OAUTH_NOT_CONFIGURED',
          '缺 BRAINX_FEISHU_APP_SECRET（从 1Password 导出后 export 再启动服务）');
      }
      res.writeHead(302, { Location: buildAuthorizeUrl(signState()) });
      res.end();
    },
    'GET /api/v1/oauth/callback': async (req, res, cid, q) => {
      const fail = (code) => { res.writeHead(302, { Location: `/login?error=${code}` }); res.end(); };
      if (!verifyState(q.get('state'))) return fail('bad_state');
      const code = q.get('code');
      if (!code) return fail('no_code');
      let identity;
      try { identity = await exchange(code); }
      catch (e) { return fail('exchange_failed'); }
      const consultant = findByOpenId(db, identity.open_id);
      if (!consultant) return fail('not_in_roster'); // fail-closed：不在花名册 = 不是顾问
      // 按人桥接的凭据：把这次授权拿到的用户令牌对加密入库（失败不阻断登录，
      // 只是该顾问暂不能按人拉消息，下轮 sync_error 提醒重登）
      try { saveUserTokens(db, consultant.consultant_id, identity.open_id, identity.tokens); }
      catch (e) { console.error(`[oauth] 令牌入库失败 cid=${consultant.consultant_id}：${String(e.message).slice(0, 80)}`); }
      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': `brainx_session=${encodeURIComponent(signSession(consultant.consultant_id, identity.open_id))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`,
      });
      res.end();
    },
    // 开发者后门：仅 BRAINX_DEV_AUTH=1 时可用（离线演示），默认关闭
    'POST /api/v1/session': async (req, res) => {
      if (!devAuth) return err(res, 403, 'DEV_AUTH_OFF', '请使用飞书账号登录');
      const b = await body(req);
      const ok = loadConsultants(db).some((c) => c.consultant_id === b?.consultant_id);
      if (!ok) return err(res, 422, 'UNKNOWN_CONSULTANT', '未知顾问身份');
      res.writeHead(204, { 'Set-Cookie': `brainx_session=${encodeURIComponent(signSession(b.consultant_id))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800` });
      res.end();
    },
    'DELETE /api/v1/session': (req, res) => {
      res.writeHead(204, { 'Set-Cookie': 'brainx_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      res.end();
    },

    'POST /api/v1/assistant/chat': async (req, res, cid) => {
      const b = await body(req);
      const question = typeof b?.question === 'string' ? b.question.trim() : '';
      if (!question || question.length > 4000) return err(res, 422, 'INVALID_QUESTION', '问题不能为空且不能超过 4000 字');
      if (!isLlmConfigured()) return err(res, 503, 'LLM_NOT_CONFIGURED', 'DeepSeek 尚未配置，请联系管理员设置服务器环境变量');
      const requestedHistory = Array.isArray(b?.history) ? b.history : [];
      const history = requestedHistory.slice(-12).filter((m) =>
        m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
      const run = latestRun(db, cid);
      const sync = latestSync(db, cid);
      const commitments = commitmentSummary(db, cid);
      const selectedId = typeof b?.context?.opportunity_id === 'string' ? b.context.opportunity_id : null;
      const items = (run?.items || []).slice(0, 10).map((item) => ({
        project_id: item.job?.project_id, company: item.job?.company, role: item.job?.role,
        score: item.score, action: item.action, confidence_band: item.confidence_band,
        evidence_coverage: item.evidence_coverage, reasons: item.reasons, risks: item.risks,
      }));
      const selected = selectedId ? items.find((item) => item.project_id === selectedId) || null : null;
      const context = JSON.stringify({
        consultant_id: cid,
        page: typeof b?.context?.page === 'string' ? b.context.page.slice(0, 80) : 'today',
        selected_opportunity: selected,
        recommendations: items,
        sync: sync ? { state: sync.complete ? 'READY' : 'INCOMPLETE', updated_at: sync.completed_at, rows_read: sync.rows_read } : { state: 'EMPTY' },
        commitments: commitments.items?.slice(0, 20) || [],
      });
      const system = `你是 BrainX 工作台的只读业务助手。你只能依据提供的当前顾问可见上下文回答，不得编造事实，不得声称已经执行任何操作。你不能调用工具、SQL、Shell，也不能修改职位、承接、结果或画像。没有数据时明确说“当前后端没有这项数据”。回答使用简洁中文。当前上下文：${context}`;
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
      res.write(`event: meta\ndata: ${JSON.stringify({ ok: true, read_only: true })}\n\n`);
      try {
        await chatStream([{ role: 'system', content: system }, ...history, { role: 'user', content: question }], {
          signal: req.signal,
          onText: (text) => { if (!res.destroyed) res.write(`data: ${JSON.stringify({ text })}\n\n`); },
        });
        if (!res.destroyed) res.write('event: done\ndata: {}\n\n');
      } catch (e) {
        if (!res.destroyed) {
          const status = e?.status === 429 ? 429 : e?.status >= 500 ? 504 : 502;
          res.write(`event: error\ndata: ${JSON.stringify({ code: status === 429 ? 'LLM_RATE_LIMIT' : 'LLM_UNAVAILABLE', message: status === 429 ? 'DeepSeek 请求过于频繁，请稍后重试' : 'DeepSeek 暂时不可用，请稍后重试' })}\n\n`);
        }
      } finally { if (!res.destroyed) res.end(); }
    },

    'GET /api/v1/workbench': (req, res, cid) => {
      const sync = latestSync(db, cid);
      const run = latestRun(db, cid);
      const c = commitmentSummary(db, cid);
      json(res, 200, {
        consultant_id: cid,
        sync: sync ? { state: sync.complete ? 'READY' : 'INCOMPLETE', updated_at: sync.completed_at,
                       rows_read: sync.rows_read, rows_expected: sync.rows_expected,
                       errors: JSON.parse(sync.errors || '[]') } : { state: 'EMPTY', updated_at: null },
        feishu_auth: tokenStatus(db, cid), // {authorized, needs_reauth}——头胶囊提示重登
        ttc_auth: ttcAuthStatus(db, cid),  // TTC 系统托管状态（连接胶囊；绝不出 JWT 本体）
        current_policy_version: run?.run?.policy_version || null,
        watched_count: c.watched_count, watched_limit: c.watched_limit,
        accepted_count: c.accepted_count, cooldown_count: 0,
        need_action_count: c.need_action_count, commitments: c.items,
        today_top3: run ? run.items.slice(0, 3) : [],
        run_id: run?.run?.run_id || null,
      });
    },

    'GET /api/v1/recommendations': (req, res, cid, q) => {
      const limit = Math.min(Number(q.get('limit')) || 10, 50);
      const sync = latestSync(db, cid);
      const run = latestRun(db, cid);
      if (sync && !sync.complete) {
        return json(res, 200, { blocked: true, reason: '本次同步不完整，为避免误导，暂不生成正式推荐',
                                run_id: null, items: [] });
      }
      if (!run) return json(res, 200, { blocked: false, run_id: null, items: [], empty: true });
      json(res, 200, { blocked: false, run_id: run.run.run_id, snapshot_id: run.run.snapshot_id,
                       policy_version: run.run.policy_version, generated_at: run.run.created_at,
                       items: run.items.slice(0, limit) });
    },

    'POST /api/v1/recommendations/run': (req, res, cid) => {
      const out = recommend(db, cid, { top: 10 });
      json(res, out.blocked ? 409 : 200, out);
    },

    'POST /api/v1/sync-runs': async (req, res, cid) => {
      const b = await body(req);
      try {
        const out = runSync(db, { source: b?.source || 'fixture', consultant_id: cid, dry_run: !!b?.dry_run });
        json(res, 200, out);
      } catch (e) { err(res, 502, 'SYNC_FAILED', String(e.message).slice(0, 300)); }
    },

    'GET /api/v1/sync-runs/:id': (req, res, cid, q, id) => {
      const r = db.prepare('SELECT * FROM sync_runs WHERE sync_id=? AND consultant_id=?').get(id, cid);
      if (!r) return err(res, 404, 'NOT_FOUND', '同步批次不存在');
      json(res, 200, { ...r, errors: JSON.parse(r.errors || '[]') });
    },

    'GET /api/v1/opportunities/:id': (req, res, cid, q, id) => {
      const job = db.prepare('SELECT * FROM job_facts WHERE project_id=?').get(id);
      // fail-closed：与自己无任何关系的职位一律 404（不泄露存在性），事实明细不出库
      if (!job || !jobVisibleTo(db, cid, id)) return err(res, 404, 'NOT_FOUND', '职位不存在');
      const effective = effectiveJob(db, cid, id);
      const relRow = db.prepare(`SELECT relation, source, valid_from FROM job_memberships
        WHERE project_id=? AND consultant_id=? AND valid_to IS NULL`).get(id, cid);
      const rel = relationOf(db, cid, id); // 推导关系单一权威（relations.js）
      const eng = currentState(db, cid, id);
      const events = [
        ...db.prepare(`SELECT event_type, occurred_at, actor, reason FROM decision_events
          WHERE project_id=? AND actor=? ORDER BY occurred_at, id`).all(id, cid),
        ...db.prepare(`SELECT 'FACT_UPDATED' AS event_type, occurred_at, consultant_id AS actor,
          '人工修正项目事实并重新判断' AS reason FROM fact_override_events
          WHERE project_id=? AND consultant_id=? ORDER BY occurred_at, id`).all(id, cid),
      ].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
      const rec = db.prepare(`SELECT * FROM recommendations WHERE project_id=? AND consultant_id=?
        ORDER BY created_at DESC LIMIT 1`).get(id, cid);
      const outs = db.prepare(`SELECT stage, value_json, observed_at FROM job_outcomes
        WHERE project_id=? AND consultant_id=? ORDER BY observed_at`).all(id, cid);
      json(res, 200, {
        job: { ...effective, raw_json: undefined, relation: rel },
        fact_updates: effectiveFactPayload(db, cid, id),
        relation: { relation: rel, source: relRow?.source || null, valid_from: relRow?.valid_from || null },
        engagement_state: eng.state, legal_actions: legalActions(db, cid, id),
        events, outcomes: outs.map((o) => ({ ...o, value: JSON.parse(o.value_json) })),
        latest_recommendation: rec ? { decision_id: rec.decision_id, score: rec.score,
          action: rec.action, confidence_band: rec.confidence_band,
          evidence_coverage: rec.evidence_coverage,
          reasons: JSON.parse(rec.reasons_json), risks: JSON.parse(rec.risks_json),
          evidence_refs: JSON.parse(rec.evidence_refs_json),
          breakdown: JSON.parse(rec.breakdown_json), policy_version: rec.policy_version } : null,
      });
    },

    'PATCH /api/v1/opportunities/:id/facts': async (req, res, cid, q, id) => {
      const job = db.prepare('SELECT 1 FROM job_facts WHERE project_id=?').get(id);
      if (!job || !jobVisibleTo(db, cid, id)) return err(res, 404, 'NOT_FOUND', '职位不存在');
      const b = await body(req);
      if (!b) return err(res, 400, 'BAD_JSON', '请求体不是合法 JSON');
      try {
        const out = updateFactOverrides(db, cid, id, b);
        if (!out.ok) return err(res, out.status || 422, 'FACT_UPDATE_REJECTED', out.error);
        // 覆盖写入后生成新冻结推荐；旧 run / replay 行永不更新。
        const rec = out.already ? null : recommend(db, cid, { top: 10 });
        const latest = latestRun(db, cid);
        const item = latest?.items.find((r) => r.job?.project_id === id) || null;
        json(res, rec?.blocked ? 409 : 200, {
          ok: true, already: !!out.already, event_id: out.event_id,
          effective: effectiveJob(db, cid, id), fact_updates: effectiveFactPayload(db, cid, id),
          recommendation: item ? {
            decision_id: item.decision_id, run_id: latest.run.run_id, action: item.action,
            score: item.score, breakdown: item.breakdown, reasons: item.reasons,
            risks: item.risks, evidence_coverage: item.evidence_coverage,
          } : null,
          decision_run_id: latest?.run?.run_id || rec?.run_id || null,
          recompute: rec?.blocked ? { blocked: true, reason: rec.reason } : { blocked: false },
        });
      } catch (e) { err(res, 500, 'FACT_UPDATE_FAILED', String(e.message).slice(0, 300)); }
    },

    'POST /api/v1/opportunities/:id/engagement': async (req, res, cid, q, id) => {
      const b = await body(req);
      if (!b) return err(res, 400, 'BAD_JSON', '请求体不是合法 JSON');
      const out = engage(db, cid, id, b.action, b);
      json(res, out.ok ? 200 : (out.status || 409), out);
    },

    'GET /api/v1/decisions/:id/replay': (req, res, cid, q, id) => {
      // 回放只能看自己名下的推荐（冻结行含评分理由，跨人泄露 = 泄露他人决策上下文）
      const owner = db.prepare('SELECT consultant_id FROM recommendations WHERE decision_id=?').get(id);
      if (!owner || owner.consultant_id !== cid) return err(res, 404, 'NOT_FOUND', '决策不存在');
      const r = replay(db, id);
      if (!r) return err(res, 404, 'NOT_FOUND', '决策不存在');
      json(res, 200, r);
    },

    'POST /api/v1/outcomes': async (req, res, cid) => {
      const b = await body(req);
      if (!b?.project_id || !b?.stage) return err(res, 400, 'BAD_REQUEST', '缺 project_id/stage');
      const out = recordOutcome(db, cid, b);
      json(res, out.ok ? 200 : (out.status || 400), out);
    },

    'GET /api/v1/dismiss-reasons': (req, res) => json(res, 200, { items: DISMISS_REASONS }),

    // 职位雷达与客户洞察（fail-closed 可见性；只呈现事实，不补造运营指标）
    'GET /api/v1/radar': (req, res, cid) => json(res, 200, { items: radarRows(db, cid) }),
    'GET /api/v1/clients': (req, res, cid) => json(res, 200, { items: clientRows(db, cid) }),

    // 我的档案（方向画像）：只许读/改自己；保存后下一轮 recommend 即生效
    'GET /api/v1/profile': (req, res, cid) => {
      const c = loadConsultants(db).find((x) => x.consultant_id === cid);
      json(res, 200, { consultant_id: cid, display_name: c?.display_name || cid,
        profile_keywords: c?.profile_keywords || [], profile_note: c?.profile_note || '',
        feishu_auth: tokenStatus(db, cid) });
    },
    'PUT /api/v1/profile': async (req, res, cid) => {
      const b = await body(req);
      if (!b) return err(res, 400, 'BAD_JSON', '请求体不是合法 JSON');
      const out = updateProfile(db, cid, b);
      json(res, out.ok ? 200 : (out.status || 400), out);
    },

    // TTC 系统凭据托管（轻无感：~60 天粘贴一次自己的 ottin-jwt-token-v2）。
    // 只许本人；JWT 先本地校验再活验证（调一次 user/quota）才落库；永不回显。
    'GET /api/v1/ttc/connect': (req, res, cid) => json(res, 200, ttcAuthStatus(db, cid)),
    'PUT /api/v1/ttc/connect': async (req, res, cid) => {
      const b = await body(req);
      const jwt = String(b?.jwt || '').trim();
      if (!jwt) return err(res, 400, 'EMPTY', '没收到 JWT');
      if (jwt.length > 8192) return err(res, 400, 'TOO_LONG', '长度异常，确认只复制了 token 值');
      let meta;
      try { meta = validateJwt(jwt); } catch (e) { return err(res, 422, 'BAD_JWT', e.message); }
      try { await ttcQuota(jwt); } catch (e) {
        if (e instanceof TtcApiError && e.authInvalid) {
          return err(res, 401, 'TTC_AUTH_INVALID', 'JWT 无效或已失效——回 TTC 系统（app.ttcadvisory.com）重新登录后再复制');
        }
        return err(res, 502, 'TTC_UNREACHABLE', '连不上 TTC 接口，稍后再试');
      }
      saveTtcToken(db, cid, jwt, meta);
      json(res, 200, { ok: true, ...ttcAuthStatus(db, cid) });
    },
    'DELETE /api/v1/ttc/connect': (req, res, cid) => {
      db.prepare('DELETE FROM ttc_tokens WHERE consultant_id=?').run(cid);
      json(res, 200, { ok: true, connected: false });
    },

    // SSE：桥接器有变化时推 sync/recommend/sync_error；25s 心跳保活
    'GET /api/v1/events': (req, res, cid) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
                           'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', consultant_id: cid,
        at: new Date().toISOString() })}\n\n`);
      sseClients.set(res, cid);
      const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch { /* closed */ } }, 25000);
      req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
    },

    'POST /api/v1/push/preview': (req, res, cid) => {
      const sync = latestSync(db, cid);
      const snapshot = latestCompleteSnapshot(db, cid);
      const run = latestRun(db, cid);
      const c = commitmentSummary(db, cid);
      const name = loadConsultants(db).find((x) => x.consultant_id === cid)?.display_name || cid;
      const card = sync && !sync.complete
        ? buildSyncAlertCard(sync)
        : buildDailyCard({ consultant_name: name, run: run?.run, items: run?.items || [],
                           commitments: c, sync, snapshot_id: snapshot?.sync_id });
      json(res, 200, { card });
    },

    'POST /api/v1/push/send': async (req, res, cid) => {
      const b = await body(req);
      const sync = latestSync(db, cid);
      const snapshot = latestCompleteSnapshot(db, cid);
      const run = latestRun(db, cid);
      const c = commitmentSummary(db, cid);
      const name = loadConsultants(db).find((x) => x.consultant_id === cid)?.display_name || cid;
      const kind = sync && !sync.complete ? 'SYNC_ALERT' : 'DAILY_TOP3';
      const card = kind === 'SYNC_ALERT'
        ? buildSyncAlertCard(sync)
        : buildDailyCard({ consultant_name: name, run: run?.run, items: run?.items || [],
                           commitments: c, sync, snapshot_id: snapshot?.sync_id });
      const target = b?.target || process.env.BRAINX_PUSH_TARGET || '';
      if (!target) return err(res, 400, 'NO_TARGET', '缺推送目标（chat_id/open_id 或 BRAINX_PUSH_TARGET）');
      const out = pushCard(db, { consultant_id: cid, kind, run_id: run?.run?.run_id || null,
                                 card, target, send: true });
      json(res, out.ok ? 200 : 502, out);
    },
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let path = u.pathname;
    // 动态段匹配：/api/v1/opportunities/:id/engagement 等
    let handler = routes[`${req.method} ${path}`];
    let dynId = null;
    if (!handler) {
      for (const key of Object.keys(routes)) {
        const [m, p] = key.split(' ');
        if (m !== req.method || !p.includes(':id')) continue;
        const rx = new RegExp('^' + p.replace(':id', '([^/]+)') + '$');
        const mm = rx.exec(path);
        if (mm) { handler = routes[key]; dynId = decodeURIComponent(mm[1]); break; }
      }
    }
    if (handler) {
      const open = ['GET /api/v1/consultants', 'POST /api/v1/session', 'DELETE /api/v1/session',
                    'GET /api/v1/oauth/status', 'GET /api/v1/oauth/authorize', 'GET /api/v1/oauth/callback'];
      const cid = open.includes(`${req.method} ${path}`) ? null : auth(req, res);
      if (open.includes(`${req.method} ${path}`) || cid) {
        try { return await handler(req, res, cid, u.searchParams, dynId); }
        catch (e) { return err(res, 500, 'INTERNAL', String(e.message).slice(0, 300)); }
      }
      return;
    }
    if (deps.frontendTarget && !path.startsWith('/api/')) {
      return proxyFrontend(req, res, deps.frontendTarget);
    }
    // 静态文件（public/），/ → index.html，/login → login.html
    if (req.method === 'GET') {
      if (path === '/') path = '/index.html';
      if (path === '/login') path = '/login.html';
      const fp = normalize(join(PUBLIC, path));
      if (isPathInside(PUBLIC, fp) && existsSync(fp) && statSync(fp).isFile()) {
        // no-cache：零构建前端没有指纹文件名，不加缓存头时旧 tab 会长期显示旧界面
        //（2026-08-11 实锤：部署新代码后用户浏览器仍渲染重启前加载的旧 JS）
        res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream',
                             'Cache-Control': 'no-cache, must-revalidate' });
        return res.end(readFileSync(fp));
      }
    }
    err(res, 404, 'NOT_FOUND', `${req.method} ${path}`);
  });
  server.bus = bus; // 主块/测试用来广播桥接事件
  server.frontendTarget = deps.frontendTarget || null;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.BRAINX_PORT || 3000);
  // 只绑回环：工作台含未脱敏业务数据，不应对局域网暴露（BRAINX_HOST 显式覆盖除外）
  const host = process.env.BRAINX_HOST || '127.0.0.1';
  const db = openDb();
  const frontendTarget = process.env.BRAINX_FRONTEND_OFF === '1'
    ? null
    : { host: FRONTEND_HOST, port: FRONTEND_PORT };
  const server = createServer(db, { frontendTarget });
  let frontendProcess = null;
  if (frontendTarget && existsSync(join(FRONTEND_DIR, 'package.json'))) {
    frontendProcess = spawn('npm', ['run', 'start', '--', '--host', FRONTEND_HOST, '--port', String(FRONTEND_PORT)], {
      cwd: FRONTEND_DIR,
      env: { ...process.env, PORT: String(FRONTEND_PORT), HOSTNAME: FRONTEND_HOST },
      stdio: 'inherit',
    });
    frontendProcess.on('error', (e) => console.error(`[frontend] 启动失败：${e.message}`));
    frontendProcess.on('exit', (code, signal) => {
      if (code !== 0 && signal !== 'SIGTERM') console.error(`[frontend] 已退出 code=${code} signal=${signal || '-'}`);
    });
    console.log(`前端服务: http://${FRONTEND_HOST}:${FRONTEND_PORT}（由 Brain X 代理）`);
  } else if (frontendTarget) {
    console.warn(`[frontend] 未找到 ${FRONTEND_DIR}，回退到 public/`);
  }
  const shutdown = () => {
    if (frontendProcess && !frontendProcess.killed) frontendProcess.kill('SIGTERM');
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.listen(port, host, () => console.log(`Brain X 工作台: http://${host}:${port}`));
  // 桥接常驻：BRAINX_BRIDGE_INTERVAL_MS（默认 180s）；BRAINX_BRIDGE_OFF=1 关闭
  if (process.env.BRAINX_BRIDGE_OFF !== '1') {
    startBridge(db, server.bus, {
      recommendFn: (cid) => recommend(db, cid, { top: 10 }),
      consultantIdsFn: () => loadConsultants(db).map((c) => c.consultant_id),
      onRecommended: makeAutoPush(db), // 重大变化自动推卡；BRAINX_PUSH_AUTO=1 才真发
    });
    console.log(`桥接器已启动（间隔 ${Number(process.env.BRAINX_BRIDGE_INTERVAL_MS || 180000) / 1000}s）`);
  }
  // 定时推送：每天 07:00 / 19:00（CST）给每位顾问发 Top3 卡；BRAINX_PUSH_SCHEDULE=0 关闭
  startScheduler(db);
  console.log('定时推送已启动（07:00 / 19:00 CST）');
}
