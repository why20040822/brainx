/** bridge.js — 飞书桥接器（P2）：lark-cli 轮询 → 增量入库 → 变化检测。
 *
 * 职责切分（重要）：桥接器只刷新「事实」(job_facts)，**不动关系**(job_memberships)。
 * 关系是策展资产（fixture 种子 / 未来按顾问计算），payload 里 relation=null，
 * runSync 的 `if (j.relation)` 分支自然跳过——Felix 的 MY_JOB/PRIMARY_PM 不会被
 * 团队池语义冲掉。
 *
 * project_id 与 fixture 同一推导（P-FIX-<md5(公司|职位)[:8]>）→ 同源公司自动合并，
 * 待 ATS 导出后统一替换（补全文档 §17.2）。
 *
 * lark-cli 全部走 user 身份已验证通道；execImpl 可注入（测试不打真实 CLI）。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { now } from './db.js';
import { runSync } from './sync.js';

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
  const out = execFileSync('lark-cli', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(out.slice(out.indexOf('{')));
};

/** 职位盘点 Bitable → runSync payload（relation=null：桥接不碰关系）。 */
export function fetchBitablePayload(execImpl = lark) {
  const d = execImpl(['base', '+record-list', '--base-token', BASE_TOKEN,
    '--table-id', TABLE_ID, '--page-size', '100', '--format', 'json']).data;
  const flat = (v) => (Array.isArray(v) ? v.filter(Boolean).join('、') : (v ?? ''));
  const jobs = [];
  for (let i = 0; i < d.data.length; i++) {
    const rec = Object.fromEntries(d.fields.map((c, j) => [c, d.data[i][j]]));
    const company = flat(rec['公司']);
    const role = flat(rec['职位']) || '职位待定';
    if (!company || company === 'TTC') continue;
    jobs.push({
      project_id: deriveProjectId(company, role),
      company, role,
      city: flat(rec['地点']) || null,
      pipeline: flat(rec['还做吗']) || null,
      hc: null, // 飞书源无 HC（已实证），风险文案由 scorer 出
      active_state: /无|待定/.test(flat(rec['还做吗'])) ? 'COOLING' : 'OPEN',
      relation: null, // 桥接器不动关系（见文件头注释）
      source_url: `feishu://base/${BASE_TOKEN}?record=${d.record_id_list[i]}`,
    });
  }
  return { as_of: now(), jobs };
}

/** 拉某群增量消息（游标之后；重叠由 message_id 主键去重）。
 * 冷启动（无游标）用 desc 拿最新一页建游标；有游标后 asc 向前走。 */
export function fetchNewMessages(db, chat_id, execImpl = lark) {
  const key = `chat:${chat_id}`;
  const cur = db.prepare('SELECT checkpoint FROM bridge_cursor WHERE source=?').get(key);
  const args = ['im', '+chat-messages-list', '--chat-id', chat_id,
    '--order', cur ? 'asc' : 'desc', '--page-size', '50', '--no-reactions', '--format', 'json'];
  if (cur) args.push('--start', toIso(cur.checkpoint));
  const d = execImpl(args);
  const msgs = d?.data?.messages || [];
  return msgs.filter((m) => !m.deleted && m.message_id);
}

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

/** 入库消息（INSERT OR IGNORE 幂等），返回 { inserted, matched }。 */
export function ingestMessages(db, chat_id, messages) {
  const st = db.prepare(`INSERT OR IGNORE INTO job_messages
    (message_id, chat_id, sender_name, msg_type, text, sent_at, matched_project_id, ingested_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  let inserted = 0, matched = 0, maxTs = '';
  db.exec('BEGIN');
  try {
    for (const m of messages) {
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      const pid = matchJob(db, text);
      const r = st.run(m.message_id, chat_id, m.sender?.name || m.sender?.id || '',
        m.msg_type || '', text.slice(0, 4000), fromMsg(m), pid, now());
      if (r.changes > 0) { inserted++; if (pid) matched++; }
      const ts = fromMsg(m);
      if (ts > maxTs) maxTs = ts;
    }
    if (maxTs) {
      db.prepare(`INSERT INTO bridge_cursor (source, checkpoint, updated_at) VALUES (?,?,?)
        ON CONFLICT(source) DO UPDATE SET checkpoint=excluded.checkpoint, updated_at=excluded.updated_at`)
        .run(`chat:${chat_id}`, maxTs, now());
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { inserted, matched };
}

/**
 * 跑一轮桥接。consultant_ids：每人都落一条 sync_runs（快照按顾问隔离），
 * job_facts upsert 幂等。返回 { changed, syncs, new_messages, matched }。
 * changed = 任一顾问 input_hash 与上轮不同，或有新消息 → 触发 SSE + 自动推荐。
 */
export function bridgeOnce(db, { consultant_ids, execImpl = lark } = {}) {
  const cids = consultant_ids || ['felix'];
  const payload = fetchBitablePayload(execImpl);
  const syncs = [];
  let changed = false;
  for (const cid of cids) {
    const prev = db.prepare(`SELECT input_hash FROM sync_runs
      WHERE consultant_id=? AND source='bridge' ORDER BY started_at DESC LIMIT 1`).get(cid);
    const s = runSync(db, { source: 'bridge', consultant_id: cid, payload });
    if (!prev || prev.input_hash !== s.input_hash) changed = true;
    syncs.push({ consultant_id: cid, sync_id: s.sync_id, complete: s.complete,
                 rows: s.rows_read, errors: s.errors.length });
  }
  let newMessages = 0, matchedTotal = 0;
  for (const chat of BRIDGE_CHATS) {
    const msgs = fetchNewMessages(db, chat.chat_id, execImpl);
    const { inserted, matched } = ingestMessages(db, chat.chat_id, msgs);
    newMessages += inserted; matchedTotal += matched;
  }
  if (newMessages > 0) changed = true;
  return { changed, syncs, new_messages: newMessages, matched: matchedTotal, at: now() };
}

/** 常驻调度：服务器内 setInterval。有变化 → bus 广播 + 每位顾问自动推荐（+ onRecommended 钩子）。 */
export function startBridge(db, bus, { intervalMs, recommendFn, consultantIdsFn, onRecommended } = {}) {
  const iv = intervalMs ?? Number(process.env.BRAINX_BRIDGE_INTERVAL_MS || 180000);
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    (async () => {
      try {
        const cids = consultantIdsFn ? consultantIdsFn() : ['felix'];
        const out = bridgeOnce(db, { consultant_ids: cids });
        if (out.changed) {
          bus?.emit({ type: 'sync', at: out.at, new_messages: out.new_messages,
                      matched: out.matched, syncs: out.syncs });
          if (recommendFn) {
            for (const cid of cids) {
              try { recommendFn(cid); } catch { /* 阻断不致命 */ }
              try { onRecommended?.(cid); } catch { /* 推卡失败不影响桥接 */ }
            }
            bus?.emit({ type: 'recommend', at: now() });
          }
        }
      } catch (e) {
        // lark-cli 授权过期/网络断开等：广播错误态，下一轮继续
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
