/** bridge.js — 飞书桥接器（P2 + 按人改造 2026-08-10）：轮询 → 增量入库 → 变化检测。
 *
 * 职责切分（重要）：桥接器只刷新「事实」(job_facts)，**不动关系**(job_memberships)。
 * 关系是策展资产（fixture 种子 / 未来按顾问计算），payload 里 relation=null，
 * runSync 的 `if (j.relation)` 分支自然跳过——Felix 的 MY_JOB/PRIMARY_PM 不会被
 * 团队池语义冲掉。
 *
 * project_id 与 fixture 同一推导（P-FIX-<md5(公司|职位)[:8]>）→ 同源公司自动合并，
 * 待 ATS 导出后统一替换（补全文档 §17.2）。
 *
 * 按人改造（硬边界）：
 *   - 职位盘点 Bitable 是团队共享池：拉一次（优先任一有效用户令牌直连，无令牌回落
 *     lark-cli），job_facts 全团队共用。
 *   - 群消息是个人隐私边界：只用**每个顾问自己的令牌**、只读**他实际所在的群**
 *     （consultant_chats ∩ BRIDGE_CHATS）。无令牌/不是成员 = 一条都看不到，
 *     可见性归属写 job_message_visibility。绝不再用 Mia 身份替所有人拉。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { now } from './db.js';
import { runSync } from './sync.js';
import { getValidAccessToken, listUserChats, listChatMessages, listBitableRecords } from './feishu.js';

const BASE_TOKEN = 'RR5NbWHEfacz4jsRYMocy1qAnSh';
const TABLE_ID = 'tblsZBwtKIrIgtre';

/** L3 证据群：职位市场群 / ZP-订阅群 / FLX-职位优先级群 */
export const BRIDGE_CHATS = [
  { chat_id: 'oc_ac6d0f87f83a5b53efab63c87c6e9f49', name: '职位市场群' },
  { chat_id: 'oc_a56daa7bcbb36c27ae2d5de16f01abf1', name: 'ZP-订阅群' },
  { chat_id: 'oc_667758eb50ad4b1af86ae99d79859870', name: 'FLX-职位优先级群' },
];

/** 与 scripts/build_fixture.mjs 同一推导，保证同源公司合并到同一 project_id。 */
export const deriveProjectId = (company, role) =>
  'P-FIX-' + createHash('md5').update(`${company}|${role}`).digest('hex').slice(0, 8).toUpperCase();

const lark = (args) => {
  // timeout 防 lark-cli 挂死（实测会无限 hang 且自我复活拖垮整机）；45s 上限杀掉
  const out = execFileSync('lark-cli', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    timeout: 45000, killSignal: 'SIGKILL' });
  return JSON.parse(out.slice(out.indexOf('{')));
};

/** 职位盘点 Bitable → runSync payload（relation=null：桥接不碰关系）。lark-cli 通道。 */
export function fetchBitablePayload(execImpl = lark) {
  const d = execImpl(['base', '+record-list', '--base-token', BASE_TOKEN,
    '--table-id', TABLE_ID, '--page-size', '100', '--format', 'json']).data;
  const flat = (v) => (Array.isArray(v) ? v.filter(Boolean).join('、') : (v ?? ''));
  const jobs = [];
  for (let i = 0; i < d.data.length; i++) {
    const rec = Object.fromEntries(d.fields.map((c, j) => [c, d.data[i][j]]));
    const job = bitableJob(rec, d.record_id_list[i]);
    if (job) jobs.push(job);
  }
  return { as_of: now(), jobs };
}

/** 直连通道（用户令牌）：原生 API 的字段值是富文本段 [{type:'text',text}] / 人员 [{name}]。 */
const flatRaw = (v) => {
  if (Array.isArray(v)) {
    return v.map((x) => (x && typeof x === 'object' ? (x.text ?? x.name ?? '') : x))
      .filter(Boolean).join('、');
  }
  if (v && typeof v === 'object') return v.text ?? v.name ?? '';
  return v ?? '';
};

const bitableJob = (rec, recordId) => {
  const company = typeof rec['公司'] === 'string' ? rec['公司'] : flatRaw(rec['公司']);
  const role = flatRaw(rec['职位']) || '职位待定';
  if (!company || company === 'TTC') return null;
  return {
    project_id: deriveProjectId(company, role),
    company, role,
    city: flatRaw(rec['地点']) || null,
    pipeline: flatRaw(rec['还做吗']) || null,
    hc: null, // 飞书源无 HC（已实证），风险文案由 scorer 出
    active_state: /无|待定/.test(flatRaw(rec['还做吗'])) ? 'COOLING' : 'OPEN',
    relation: null, // 桥接器不动关系（见文件头注释）
    source_url: `feishu://base/${BASE_TOKEN}?record=${recordId}`,
  };
};

/** 直连通道（用户令牌）：与 fetchBitablePayload 产出同一 payload 形状。 */
export async function fetchBitablePayloadApi(token, fetchImpl = fetch) {
  const items = await listBitableRecords(token, BASE_TOKEN, TABLE_ID, fetchImpl);
  const jobs = [];
  for (const it of items) {
    const job = bitableJob(it.fields || {}, it.record_id);
    if (job) jobs.push(job);
  }
  return { as_of: now(), jobs };
}

/** 拉某群增量消息（游标之后；重叠由 message_id 主键去重）。lark-cli 通道（兼容保留）。
 * 冷启动（无游标）用 desc 拿最新一页建游标；有游标后 asc 向前走。 */
export function fetchNewMessages(db, chat_id, execImpl = lark, consultant_id = null) {
  const key = cursorKey(chat_id, consultant_id);
  const cur = db.prepare('SELECT checkpoint FROM bridge_cursor WHERE source=?').get(key);
  const args = ['im', '+chat-messages-list', '--chat-id', chat_id,
    '--order', cur ? 'asc' : 'desc', '--page-size', '50', '--no-reactions', '--format', 'json'];
  if (cur) args.push('--start', toIso(cur.checkpoint));
  const d = execImpl(args);
  const msgs = d?.data?.messages || [];
  return msgs.filter((m) => !m.deleted && m.message_id);
}

/** 直连通道（该顾问自己的令牌）：同形返回，游标按人隔离。 */
export async function fetchNewMessagesApi(db, consultant_id, chat_id, token, fetchImpl = fetch) {
  const cur = db.prepare('SELECT checkpoint FROM bridge_cursor WHERE source=?')
    .get(cursorKey(chat_id, consultant_id));
  return listChatMessages(token, chat_id, {
    order: cur ? 'asc' : 'desc',
    startCheckpoint: cur ? cur.checkpoint : '',
  }, fetchImpl);
}

/** 游标键：全局（lark-cli 兼容路径）'chat:oc_x'；按人 'chat:oc_x@mia'。 */
export const cursorKey = (chat_id, consultant_id = null) =>
  `chat:${chat_id}${consultant_id ? `@${consultant_id}` : ''}`;

/** lark-cli 时间 "2026-08-07 10:32" → ISO（--start 参数要 ISO 8601）。 */
const toIso = (s) => (s || '').replace(' ', 'T') + ':00+08:00';
const fromMsg = (m) => String(m.create_time || '').replace('T', ' ').slice(0, 16);

/** 公司名词典匹配：最长优先子串命中；同公司多岗时按 project_id 升序取确定性首条。
 * 返回 project_id 或 null。 */
export function matchJob(db, text) {
  if (!text) return null;
  const companies = db.prepare(`SELECT project_id, company FROM job_facts
    WHERE company IS NOT NULL AND company != ''
    ORDER BY LENGTH(company) DESC, project_id ASC`).all();
  const lower = text.toLowerCase();
  for (const c of companies) {
    if (c.company.length >= 2 && lower.includes(c.company.toLowerCase())) return c.project_id;
  }
  return null;
}

/** 入库消息（INSERT OR IGNORE 幂等），返回 { inserted, matched }。
 * consultant_id 提供时：为每条消息登记可见性（即使消息行已被其他顾问先入），
 * 游标按人推进。 */
export function ingestMessages(db, chat_id, messages, consultant_id = null) {
  const st = db.prepare(`INSERT OR IGNORE INTO job_messages
    (message_id, chat_id, sender_name, msg_type, text, sent_at, matched_project_id, ingested_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  const stVis = consultant_id ? db.prepare(`INSERT OR IGNORE INTO job_message_visibility
    (message_id, consultant_id, ingested_at) VALUES (?,?,?)`) : null;
  let inserted = 0, matched = 0, maxTs = '';
  db.exec('BEGIN');
  try {
    for (const m of messages) {
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      const pid = matchJob(db, text);
      const r = st.run(m.message_id, chat_id, m.sender?.name || m.sender?.id || '',
        m.msg_type || '', text.slice(0, 4000), fromMsg(m), pid, now());
      if (r.changes > 0) { inserted++; if (pid) matched++; }
      if (stVis) stVis.run(m.message_id, consultant_id, now());
      const ts = fromMsg(m);
      if (ts > maxTs) maxTs = ts;
    }
    if (maxTs) {
      db.prepare(`INSERT INTO bridge_cursor (source, checkpoint, updated_at) VALUES (?,?,?)
        ON CONFLICT(source) DO UPDATE SET checkpoint=excluded.checkpoint, updated_at=excluded.updated_at`)
        .run(cursorKey(chat_id, consultant_id), maxTs, now());
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { inserted, matched };
}

/** 刷新某顾问的群成员缓存，返回他所在的 chat_id 集合。 */
export async function refreshConsultantChats(db, consultant_id, token, fetchImpl = fetch) {
  const chats = await listUserChats(token, fetchImpl);
  const st = db.prepare(`INSERT INTO consultant_chats (consultant_id, chat_id, name, seen_at)
    VALUES (?,?,?,?)
    ON CONFLICT(consultant_id, chat_id) DO UPDATE SET name=excluded.name, seen_at=excluded.seen_at`);
  db.exec('BEGIN');
  try {
    for (const [chat_id, name] of chats) st.run(consultant_id, chat_id, name, now());
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return new Set(chats.keys());
}

/** 第一个持有有效令牌的顾问的 access_token（Bitable 团队池拉取用，身份不限定）。 */
async function firstValidToken(db, cids, fetchImpl) {
  for (const cid of cids) {
    const t = await getValidAccessToken(db, cid, fetchImpl);
    if (t) return t;
  }
  return null;
}

/**
 * 跑一轮桥接。consultant_ids：每人都落一条 sync_runs（快照按顾问隔离），
 * job_facts upsert 幂等（团队共享池）。
 * 消息：仅持有效令牌的顾问、仅其实际所在群；无令牌者进 skipped（下轮重试）。
 * 返回 { changed, syncs, new_messages, matched, skipped, errors }。
 * changed = 任一顾问 input_hash 与上轮不同，或有新消息 → 触发 SSE + 自动推荐。
 * api={fetchImpl} 可注入（测试不打真实网络）；api 为 null 时跳过全部直连通道
 * （纯 lark-cli 兼容模式，仅用于测试与应急）。
 */
export async function bridgeOnce(db, { consultant_ids, execImpl = lark, api = { fetchImpl: fetch } } = {}) {
  const cids = consultant_ids || ['felix'];
  const fetchImpl = api?.fetchImpl || fetch;
  const syncs = [];
  const errors = [];
  const skipped = [];
  let changed = false;

  // 1) 职位盘点（团队共享池）：优先用户令牌直连；无令牌回落 lark-cli（兼容期）
  let payload = null;
  if (api) {
    const token = await firstValidToken(db, cids, fetchImpl);
    if (token) {
      try { payload = await fetchBitablePayloadApi(token, fetchImpl); }
      catch (e) { errors.push(`bitable_api:${String(e.message).slice(0, 120)}`); }
    }
  }
  if (!payload) {
    try { payload = fetchBitablePayload(execImpl); }
    catch (e) { errors.push(`bitable_lark:${String(e.message).slice(0, 120)}`); }
  }
  if (payload) {
    for (const cid of cids) {
      const prev = db.prepare(`SELECT input_hash FROM sync_runs
        WHERE consultant_id=? AND source='bridge' ORDER BY started_at DESC LIMIT 1`).get(cid);
      const s = runSync(db, { source: 'bridge', consultant_id: cid, payload });
      if (!prev || prev.input_hash !== s.input_hash) changed = true;
      syncs.push({ consultant_id: cid, sync_id: s.sync_id, complete: s.complete,
                   rows: s.rows_read, errors: s.errors.length });
    }
  }

  // 2) 群消息：每个顾问用自己的令牌读自己所在的群（隔离的本意——无令牌=无消息）
  let newMessages = 0, matchedTotal = 0;
  if (api) {
    for (const cid of cids) {
      const token = await getValidAccessToken(db, cid, fetchImpl);
      if (!token) { skipped.push(cid); continue; }
      let chatIds;
      try { chatIds = await refreshConsultantChats(db, cid, token, fetchImpl); }
      catch (e) { errors.push(`chats:${cid}:${String(e.message).slice(0, 80)}`); skipped.push(cid); continue; }
      for (const chat of BRIDGE_CHATS.filter((c) => chatIds.has(c.chat_id))) {
        try {
          const msgs = await fetchNewMessagesApi(db, cid, chat.chat_id, token, fetchImpl);
          const { inserted, matched } = ingestMessages(db, chat.chat_id, msgs, cid);
          newMessages += inserted; matchedTotal += matched;
        } catch (e) { errors.push(`msgs:${cid}:${chat.chat_id.slice(0, 10)}`); }
      }
    }
  }
  if (newMessages > 0) changed = true;
  return { changed, syncs, new_messages: newMessages, matched: matchedTotal,
           skipped, errors, at: now() };
}

/** 常驻调度：服务器内 setInterval。有变化 → 按人定向 SSE + 每位顾问自动推荐（+ onRecommended 钩子）。
 * SSE 定向：事件带 consultant_id 时 bus 只发给该顾问的客户端（见 server.js）。 */
export function startBridge(db, bus, { intervalMs, recommendFn, consultantIdsFn, onRecommended } = {}) {
  const iv = intervalMs ?? Number(process.env.BRAINX_BRIDGE_INTERVAL_MS || 180000);
  let running = false;
  let prevSkipped = new Set(); // 只在「新进入无令牌状态」时提醒一次，避免每轮刷屏
  const tick = () => {
    if (running) return;
    running = true;
    (async () => {
      try {
        const cids = consultantIdsFn ? consultantIdsFn() : ['felix'];
        const out = await bridgeOnce(db, { consultant_ids: cids });
        if (out.changed) {
          for (const s of out.syncs) {
            bus?.emit({ type: 'sync', consultant_id: s.consultant_id, at: out.at,
                        new_messages: out.new_messages, matched: out.matched, syncs: [s] });
          }
          if (recommendFn) {
            for (const cid of cids) {
              try { recommendFn(cid); } catch { /* 阻断不致命 */ }
              try { onRecommended?.(cid); } catch { /* 推卡失败不影响桥接 */ }
              bus?.emit({ type: 'recommend', consultant_id: cid, at: now() });
            }
          }
        }
        // Bitable 两条通道都断了 = 全员事故，广播；个人令牌失效只提醒本人
        if (out.syncs.length === 0) {
          bus?.emit({ type: 'sync_error', message: '职位盘点拉取失败（API 与 lark-cli 均不可用）', at: now() });
        }
        const curSkipped = new Set(out.skipped);
        for (const cid of out.skipped) {
          if (prevSkipped.has(cid)) continue; // 已提醒过，等重登后自然恢复
          bus?.emit({ type: 'sync_error', consultant_id: cid,
                      message: '飞书授权待更新，重新登录后恢复实时同步', at: now() });
        }
        prevSkipped = curSkipped;
      } catch (e) {
        // 未预期异常：广播错误态，下一轮继续
        bus?.emit({ type: 'sync_error', message: String(e.message || e).slice(0, 200), at: now() });
      } finally { running = false; }
    })();
  };
  const timer = setInterval(tick, iv);
  timer.unref?.();
  const first = setTimeout(tick, 5000);
  first.unref?.();
  return { stop: () => { clearInterval(timer); clearTimeout(first); }, tick };
}
