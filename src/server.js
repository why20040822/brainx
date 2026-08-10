/** server.js — HTTP API + 静态工作台（补全文档 §16 契约）。
 * 零框架 node:http。除 session/consultants/oauth 外全部要登录 Cookie。
 */
import './env.js';
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { runSync, latestSync, latestCompleteSnapshot } from './sync.js';
import { recommend, latestRun, loadConsultants } from './recommend.js';
import { engage, commitmentSummary, currentState, legalActions, DISMISS_REASONS } from './engagement.js';
import { replay, recordOutcome } from './replay.js';
import { buildDailyCard, buildSyncAlertCard, pushCard } from './push.js';
import { signSession, verifySession, cookieOf } from './session.js';
import { signState, verifyState, buildAuthorizeUrl, exchangeCode, oauthConfigured } from './oauth.js';
import { findByOpenId } from './roster.js';
import { startBridge } from './bridge.js';
import { makeAutoPush } from './autopush.js';
import { saveUserTokens, tokenStatus } from './feishu.js';
import { jobVisibleTo } from './visibility.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
               '.svg': 'image/svg+xml', '.png': 'image/png' };

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const err = (res, code, codeStr, message) => json(res, code, { error: { code: codeStr, message } });

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
      const rel = db.prepare(`SELECT relation, source, valid_from FROM job_memberships
        WHERE project_id=? AND consultant_id=? AND valid_to IS NULL`).get(id, cid);
      const eng = currentState(db, cid, id);
      const events = db.prepare(`SELECT event_type, occurred_at, actor, reason FROM decision_events
        WHERE project_id=? AND actor=? ORDER BY occurred_at, id`).all(id, cid);
      const rec = db.prepare(`SELECT * FROM recommendations WHERE project_id=? AND consultant_id=?
        ORDER BY created_at DESC LIMIT 1`).get(id, cid);
      const outs = db.prepare(`SELECT stage, value_json, observed_at FROM job_outcomes
        WHERE project_id=? AND consultant_id=? ORDER BY observed_at`).all(id, cid);
      json(res, 200, {
        job: { ...job, raw_json: undefined, relation: rel?.relation || 'UNKNOWN' },
        relation: rel || { relation: 'UNKNOWN' },
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
    // 静态文件（public/），/ → index.html，/login → login.html
    if (req.method === 'GET') {
      if (path === '/') path = '/index.html';
      if (path === '/login') path = '/login.html';
      const fp = normalize(join(PUBLIC, path));
      if (fp.startsWith(PUBLIC) && existsSync(fp) && statSync(fp).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
        return res.end(readFileSync(fp));
      }
    }
    err(res, 404, 'NOT_FOUND', `${req.method} ${path}`);
  });
  server.bus = bus; // 主块/测试用来广播桥接事件
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.BRAINX_PORT || 3000);
  // 只绑回环：工作台含未脱敏业务数据，不应对局域网暴露（BRAINX_HOST 显式覆盖除外）
  const host = process.env.BRAINX_HOST || '127.0.0.1';
  const db = openDb();
  const server = createServer(db);
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
}
