/** talent.js — 人才库读写层（README「下一步功能」接线）。
 *
 * 补全 README「未来人才侧接口」里承诺、但此前只有 schema 与连通自检、尚未接线的
 * 业务读写：候选人同步进 talent 表、标签写入、匹配记录写入。
 *
 * 设计约束（与项目既有纪律一致）：
 *   1) 双库并存、互不干扰：本模块只碰 MySQL 人才库（异步 API），绝不触碰 SQLite 决策库。
 *   2) 懒连接：不调用任何写入/读取函数就不会连 RDS，SQLite-only 的命令行入口不受影响。
 *   3) 无 RDS 回退：阿里云 RDS 走 IP 白名单，本地/沙箱常连不通。为了让功能可开发、可
 *      测试、可离线演示，未配置或连不通 MySQL 时自动降级到进程内内存库（memory store），
 *      读写语义与 MySQL 版一致（UPSERT 幂等、外键级联概念保留）。切回真库只需在 .env
 *      填 BRAINX_MYSQL_* 凭据 + 白名单，无需改调用方代码。
 *   4) 幂等：候选人按 (phone|email|name) 归一去重 UPSERT；标签按 (name,category) 字典去重；
 *      匹配记录按 (talent_id,position_id) 覆盖写。重复同步不产生脏数据。
 */
import { parseCsvFile } from './csv.js';
import { tokenize } from './scorer.js';
import { parseResumeText } from './resume.js';

// ---------------------------------------------------------------------------
// 后端选择：优先真 MySQL；未配置/连不通则回退内存库。
// ---------------------------------------------------------------------------
let _backend = null; // 缓存已选后端，避免每次调用重连
let _forcedMemory = false;

/** 测试/离线演示可强制内存库。 */
export function useMemoryBackend() { _forcedMemory = true; _backend = null; }
/** 复位（测试之间清状态）。 */
export function resetBackend() { _backend = null; _forcedMemory = false; MEM.reset(); }

async function backend() {
  if (_backend) return _backend;
  if (_forcedMemory) return (_backend = MEM);
  // 未填凭据 → 直接内存库（不抛错、不 import mysql 连接）
  if (!process.env.BRAINX_MYSQL_USER || !process.env.BRAINX_MYSQL_DATABASE) {
    _backend = MEM;
    _backend.degraded = 'NO_CREDENTIALS';
    return _backend;
  }
  // 有凭据 → 尝试连真库；连不通（白名单/网络）自动降级
  try {
    const db = await import('./db.js');
    await db.pingMysql();
    _backend = makeMysqlBackend(db);
    return _backend;
  } catch (e) {
    _backend = MEM;
    _backend.degraded = `MYSQL_UNREACHABLE: ${String(e.message).slice(0, 80)}`;
    return _backend;
  }
}

/** 当前后端状态（给 /health 与前端提示用；绝不出凭据本体）。 */
export async function talentBackendStatus() {
  const b = await backend();
  return { backend: b === MEM ? 'memory' : 'mysql', degraded: b.degraded || null };
}

// ---------------------------------------------------------------------------
// 公开业务 API（后端无关；内部委托给所选 backend）
// ---------------------------------------------------------------------------

const norm = (s) => String(s ?? '').trim();
/** 候选人归一键：手机 > 邮箱 > 姓名，用于跨源去重 UPSERT。 */
export function talentDedupeKey({ phone, email, name }) {
  return norm(phone) || norm(email).toLowerCase() || norm(name);
}

/** UPSERT 单个候选人，返回 { id, created }。幂等：同 dedupeKey 命中则更新。 */
export async function upsertTalent(input) {
  const b = await backend();
  const rec = {
    name: norm(input.name), phone: norm(input.phone) || null,
    email: norm(input.email) || null, status: input.status || 'active',
    summary: input.summary ?? null, createdBy: input.createdBy ?? null,
    lastActiveTime: input.lastActiveTime ?? null,
  };
  if (!rec.name) throw new Error('talent.name 必填');
  return b.upsertTalent(rec);
}

/** 给候选人挂标签（自动建标签字典项）。tags: [{name, category, source}]。返回挂上的 tag_id 数组。 */
export async function attachTags(talentId, tags = []) {
  const b = await backend();
  const ids = [];
  for (const t of tags) {
    const name = norm(t.name);
    if (!name) continue;
    const tagId = await b.upsertTag(name, t.category || 'skill');
    await b.linkTalentTag(talentId, tagId, t.source || 'auto');
    ids.push(tagId);
  }
  return ids;
}

/** 从 CSV 批量同步候选人进 talent 表（岗位盘点表：公司/岗位 → 候选来源画像）。
 *  这里把 CSV 的岗位单元格当作「意向标签」来源，姓名用「公司-方向」占位（真实场景
 *  应接简历解析产出真实候选人；此处提供可跑通的确定性 ingest 骨架）。 */
export async function syncTalentsFromCsv(csvPath, { createdBy = null } = {}) {
  const rows = parseCsvFile(csvPath);
  const result = { read: 0, inserted: 0, updated: 0, tagged: 0, items: [] };
  // 第一行表头；从第二行起，第 0 列公司名，其后单元格为岗位/方向文本
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const company = norm(cells[0]);
    if (!company) continue;
    const roleText = cells.slice(1).map(norm).filter(Boolean).join(' / ');
    if (!roleText) continue;
    result.read++;
    const name = `${company}·候选画像`;
    const up = await upsertTalent({
      name, status: 'active', summary: roleText, createdBy,
    });
    if (up.created) result.inserted++; else result.updated++;
    // 从岗位文本切出关键词做意向标签（复用决策库的 tokenize，方向词一致）
    const terms = [...tokenize(roleText)].slice(0, 8).map((name) => ({ name, category: 'intention', source: 'auto' }));
    const tagIds = await attachTags(up.id, terms);
    result.tagged += tagIds.length;
    result.items.push({ id: up.id, name, tags: tagIds.length });
  }
  return result;
}

/** 解析一份简历纯文本 → UPSERT 真实候选人（姓名/手机/邮箱/摘要）+ 挂技能与意向标签
 *  + 存简历原文（resume 表）。返回 { id, created, name, tags, resumeId }。 */
export async function ingestResume(rawText, { fileName = '', createdBy = null } = {}) {
  const parsed = parseResumeText(rawText, { fileName });
  const up = await upsertTalent({
    name: parsed.name, phone: parsed.phone, email: parsed.email,
    status: 'active', summary: parsed.summary, createdBy,
    lastActiveTime: new Date().toISOString(),
  });
  const tagIds = await attachTags(up.id, parsed.tags);
  const b = await backend();
  const resumeId = await b.saveResume({
    talentId: up.id, fileName: parsed.fileName, parsedContent: parsed.parsedContent,
  });
  return { id: up.id, created: up.created, name: parsed.name, tags: tagIds.length, resumeId,
    phone: parsed.phone, email: parsed.email };
}

/** 批量：从一组简历（[{text, fileName}]）同步真实候选人进库。 */
export async function syncTalentsFromResumes(resumes = [], { createdBy = null } = {}) {
  const result = { read: 0, inserted: 0, updated: 0, tagged: 0, items: [] };
  for (const r of resumes) {
    const text = typeof r === 'string' ? r : r.text;
    if (!text || !String(text).trim()) continue;
    result.read++;
    const out = await ingestResume(text, { fileName: r.fileName || '', createdBy });
    if (out.created) result.inserted++; else result.updated++;
    result.tagged += out.tags;
    result.items.push({ id: out.id, name: out.name, tags: out.tags });
  }
  return result;
}

/** 查候选人简历列表。 */
export async function listResumes(talentId) {
  const b = await backend();
  return b.listResumes(Number(talentId));
}

/** 分页列出候选人。 */
export async function listTalents({ limit = 20, offset = 0, status = null } = {}) {
  const b = await backend();
  return b.listTalents({ limit: Math.min(Number(limit) || 20, 100), offset: Number(offset) || 0, status });
}

/** 查候选人详情（含标签）。 */
export async function getTalent(id) {
  const b = await backend();
  return b.getTalent(Number(id));
}

/** 写入/覆盖一条人才×岗位匹配记录。detail 为各维度得分 JSON。 */
export async function writeMatchRecord({ talentId, positionId, score, detail }) {
  const b = await backend();
  return b.writeMatch({
    talentId: Number(talentId), positionId: Number(positionId),
    score: Number(score) || 0, detail: detail ?? null,
  });
}

/** 列出某岗位的匹配记录（分数倒序）。 */
export async function listMatchesForPosition(positionId) {
  const b = await backend();
  return b.listMatchesForPosition(Number(positionId));
}

/** UPSERT 岗位（供匹配写入前建岗位用）。 */
export async function upsertPosition({ title, description, requirements }) {
  const b = await backend();
  return b.upsertPosition({ title: norm(title), description: description ?? null, requirements: requirements ?? null });
}

// ---------------------------------------------------------------------------
// MySQL 后端（薄封装既有 withMysql；扩展 UPSERT / 标签 / 匹配）
// ---------------------------------------------------------------------------
function makeMysqlBackend(db) {
  const { withMysql } = db;
  return {
    degraded: null,
    async upsertTalent(rec) {
      return withMysql(async (conn) => {
        // 归一去重：先按 dedupeKey 命中
        const key = talentDedupeKey(rec);
        const [hit] = await conn.execute(
          `SELECT id FROM talent WHERE (phone IS NOT NULL AND phone=?) OR (email IS NOT NULL AND email=?) OR name=? LIMIT 1`,
          [rec.phone, rec.email, rec.name],
        );
        if (hit[0]) {
          await conn.execute(
            `UPDATE talent SET status=?, summary=COALESCE(?,summary), last_active_time=COALESCE(?,last_active_time) WHERE id=?`,
            [rec.status, rec.summary, rec.lastActiveTime, hit[0].id],
          );
          return { id: hit[0].id, created: false, key };
        }
        const [res] = await conn.execute(
          `INSERT INTO talent (name, phone, email, status, summary, created_by, last_active_time)
           VALUES (?,?,?,?,?,?,?)`,
          [rec.name, rec.phone, rec.email, rec.status, rec.summary, rec.createdBy, rec.lastActiveTime],
        );
        return { id: res.insertId, created: true, key };
      });
    },
    async upsertTag(name, category) {
      return withMysql(async (conn) => {
        await conn.execute(`INSERT IGNORE INTO tag (name, category) VALUES (?,?)`, [name, category]);
        const [rows] = await conn.execute(`SELECT id FROM tag WHERE name=? AND category=?`, [name, category]);
        return rows[0].id;
      });
    },
    async linkTalentTag(talentId, tagId, source) {
      return withMysql((conn) => conn.execute(
        `INSERT IGNORE INTO talent_tag (talent_id, tag_id, source) VALUES (?,?,?)`, [talentId, tagId, source]));
    },
    async listTalents({ limit, offset, status }) {
      return withMysql(async (conn) => {
        const where = status ? `WHERE status=?` : '';
        const args = status ? [status, limit, offset] : [limit, offset];
        const [rows] = await conn.execute(
          `SELECT * FROM talent ${where} ORDER BY last_active_time DESC, id DESC LIMIT ? OFFSET ?`, args);
        return rows;
      });
    },
    async getTalent(id) {
      return withMysql(async (conn) => {
        const [t] = await conn.execute(`SELECT * FROM talent WHERE id=?`, [id]);
        if (!t[0]) return null;
        const [tags] = await conn.execute(
          `SELECT g.id, g.name, g.category, tt.source FROM talent_tag tt JOIN tag g ON g.id=tt.tag_id WHERE tt.talent_id=?`, [id]);
        return { ...t[0], tags };
      });
    },
    async upsertPosition({ title, description, requirements }) {
      return withMysql(async (conn) => {
        const [hit] = await conn.execute(`SELECT id FROM position WHERE title=? LIMIT 1`, [title]);
        if (hit[0]) return { id: hit[0].id, created: false };
        const [res] = await conn.execute(
          `INSERT INTO position (title, description, requirements) VALUES (?,?,?)`, [title, description, requirements]);
        return { id: res.insertId, created: true };
      });
    },
    async writeMatch({ talentId, positionId, score, detail }) {
      return withMysql(async (conn) => {
        const [hit] = await conn.execute(
          `SELECT id FROM match_record WHERE talent_id=? AND position_id=? LIMIT 1`, [talentId, positionId]);
        const json = detail == null ? null : JSON.stringify(detail);
        if (hit[0]) {
          await conn.execute(`UPDATE match_record SET score=?, match_detail=? WHERE id=?`, [score, json, hit[0].id]);
          return { id: hit[0].id, created: false };
        }
        const [res] = await conn.execute(
          `INSERT INTO match_record (talent_id, position_id, score, match_detail) VALUES (?,?,?,?)`,
          [talentId, positionId, score, json]);
        return { id: res.insertId, created: true };
      });
    },
    async listMatchesForPosition(positionId) {
      return withMysql(async (conn) => {
        const [rows] = await conn.execute(
          `SELECT m.*, t.name AS talent_name FROM match_record m JOIN talent t ON t.id=m.talent_id
           WHERE m.position_id=? ORDER BY m.score DESC, m.id DESC`, [positionId]);
        return rows.map((r) => ({ ...r, match_detail: safeJson(r.match_detail) }));
      });
    },
    async saveResume({ talentId, fileName, parsedContent }) {
      return withMysql(async (conn) => {
        const [res] = await conn.execute(
          `INSERT INTO resume (talent_id, file_name, file_path, parsed_content) VALUES (?,?,?,?)`,
          [talentId, fileName, `inline://${fileName}`, parsedContent]);
        return res.insertId;
      });
    },
    async listResumes(talentId) {
      return withMysql(async (conn) => {
        const [rows] = await conn.execute(
          `SELECT id, file_name, upload_time, LEFT(parsed_content, 200) AS preview FROM resume WHERE talent_id=? ORDER BY id DESC`, [talentId]);
        return rows;
      });
    },
  };
}

const safeJson = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return s; } };

// ---------------------------------------------------------------------------
// 内存后端（无 RDS 回退；读写语义与 MySQL 版对齐）
// ---------------------------------------------------------------------------
const MEM = {
  degraded: 'MEMORY',
  _talents: new Map(), _tags: new Map(), _talentTags: [], _positions: new Map(), _matches: [],
  _seq: { talent: 0, tag: 0, position: 0, match: 0 },
  reset() {
    this._talents.clear(); this._tags.clear(); this._talentTags = [];
    this._positions.clear(); this._matches = [];
    this._seq = { talent: 0, tag: 0, position: 0, match: 0 };
    this.degraded = 'MEMORY';
  },
  async upsertTalent(rec) {
    const key = talentDedupeKey(rec);
    for (const t of this._talents.values()) {
      if (talentDedupeKey(t) === key) {
        t.status = rec.status;
        if (rec.summary != null) t.summary = rec.summary;
        if (rec.lastActiveTime != null) t.last_active_time = rec.lastActiveTime;
        return { id: t.id, created: false, key };
      }
    }
    const id = ++this._seq.talent;
    this._talents.set(id, { id, name: rec.name, phone: rec.phone, email: rec.email,
      status: rec.status, summary: rec.summary, created_by: rec.createdBy,
      last_active_time: rec.lastActiveTime, created_at: new Date().toISOString() });
    return { id, created: true, key };
  },
  async upsertTag(name, category) {
    const k = `${name}|${category}`;
    if (this._tags.has(k)) return this._tags.get(k).id;
    const id = ++this._seq.tag;
    this._tags.set(k, { id, name, category });
    return id;
  },
  async linkTalentTag(talentId, tagId, source) {
    if (!this._talentTags.some((x) => x.talent_id === talentId && x.tag_id === tagId))
      this._talentTags.push({ talent_id: talentId, tag_id: tagId, source });
  },
  async listTalents({ limit, offset, status }) {
    let arr = [...this._talents.values()];
    if (status) arr = arr.filter((t) => t.status === status);
    arr.sort((a, b) => (b.id - a.id));
    return arr.slice(offset, offset + limit);
  },
  async getTalent(id) {
    const t = this._talents.get(id);
    if (!t) return null;
    const tagById = new Map([...this._tags.values()].map((g) => [g.id, g]));
    const tags = this._talentTags.filter((x) => x.talent_id === id)
      .map((x) => ({ ...tagById.get(x.tag_id), source: x.source }));
    return { ...t, tags };
  },
  async upsertPosition({ title, description, requirements }) {
    for (const p of this._positions.values()) if (p.title === title) return { id: p.id, created: false };
    const id = ++this._seq.position;
    this._positions.set(id, { id, title, description, requirements });
    return { id, created: true };
  },
  async writeMatch({ talentId, positionId, score, detail }) {
    const hit = this._matches.find((m) => m.talent_id === talentId && m.position_id === positionId);
    if (hit) { hit.score = score; hit.match_detail = detail; return { id: hit.id, created: false }; }
    const id = ++this._seq.match;
    this._matches.push({ id, talent_id: talentId, position_id: positionId, score, match_detail: detail,
      created_at: new Date().toISOString() });
    return { id, created: true };
  },
  async listMatchesForPosition(positionId) {
    const byId = this._talents;
    return this._matches.filter((m) => m.position_id === positionId)
      .sort((a, b) => b.score - a.score)
      .map((m) => ({ ...m, talent_name: byId.get(m.talent_id)?.name ?? null }));
  },
};
