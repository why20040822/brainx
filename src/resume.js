/** resume.js — 零依赖简历解析：纯文本 → 结构化候选人字段 + 意向/技能标签。
 *
 * 替换 talent.js 里「公司·候选画像」的占位 ingest：从真实简历文本抽出候选人的
 * 姓名 / 手机 / 邮箱 / 技能 / 意向方向 / 摘要，产出可直接 upsert 进 talent 表的记录。
 *
 * 纪律：与项目零依赖一致——只用 node 原生正则 + 既有 csv/tokenize，不引第三方 NLP。
 * 支持中英文混排简历（真实猎头简历常见格式）。二进制简历（PDF/docx）先由上层转纯文本
 * 再喂进来（本模块只吃纯文本，保持零依赖；PDF 抽取属可选增强，不在核心路径）。
 */
import { tokenize } from './scorer.js';

const RE_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
// 中国大陆手机号（1 开头 11 位）+ 常见带分隔符写法
const RE_PHONE = /(?:\+?86[-\s]?)?(1[3-9]\d{9})\b|(1[3-9]\d)[-\s]?(\d{4})[-\s]?(\d{4})/;

// 简历常见分节标题（技能 / 求职意向），用于定向抽取。
const SKILL_HEADERS = ['技能', '专业技能', 'skills', '技术栈', '擅长'];
const INTENT_HEADERS = ['求职意向', '意向', '期望职位', '目标岗位', 'objective', 'target'];

const clean = (s) => String(s ?? '').replace(/[\r]/g, '').trim();

/** 从简历文本抽出姓名：优先「姓名：X」标签，否则取首个非空短行（<=12 字、无 @ 无数字堆）。 */
function extractName(text) {
  const tagged = text.match(/(?:姓\s*名|name)\s*[:：]\s*([^\n]{1,20})/i);
  if (tagged) return clean(tagged[1]).split(/\s{2,}/)[0];
  for (const raw of text.split('\n')) {
    const line = clean(raw);
    if (!line) continue;
    if (RE_EMAIL.test(line) || /\d{6,}/.test(line)) continue;
    if (line.length <= 12 && !/[，。,.:：]/.test(line)) return line;
    break; // 第一段有内容就停，避免误取正文
  }
  return '';
}

function extractPhone(text) {
  const m = text.match(RE_PHONE);
  if (!m) return null;
  if (m[1]) return m[1];
  if (m[2] && m[3] && m[4]) return `${m[2]}${m[3]}${m[4]}`;
  return null;
}

/** 抽取某组分节标题下的一段内容（到下一个空行或下一个标题）。 */
function sectionBody(text, headers) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i]).toLowerCase();
    const hit = headers.some((h) => line.startsWith(h.toLowerCase()) || line.replace(/[:：]/g, '') === h.toLowerCase());
    if (!hit) continue;
    // 同行冒号后内容
    const inline = clean(lines[i]).replace(/^[^:：]*[:：]\s*/, '');
    const collected = [];
    if (inline && inline !== clean(lines[i])) collected.push(inline);
    for (let j = i + 1; j < lines.length; j++) {
      const l = clean(lines[j]);
      if (!l) break;
      if ([...SKILL_HEADERS, ...INTENT_HEADERS].some((h) => l.toLowerCase().startsWith(h.toLowerCase()) && l.length < 16)) break;
      collected.push(l);
    }
    return collected.join(' ');
  }
  return '';
}

/** 把一段文本切成去重标签词（复用决策库 tokenize，方向词表一致）。 */
function toTags(text, category, limit = 10) {
  const seen = new Set();
  const out = [];
  for (const term of tokenize(text)) {
    if (seen.has(term)) continue;
    seen.add(term);
    out.push({ name: term, category, source: 'auto' });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 解析一份简历纯文本，返回可入库的结构化候选人：
 *   { name, phone, email, summary, tags:[{name,category,source}], parsedContent }
 */
export function parseResumeText(rawText, { fileName = '' } = {}) {
  const text = clean(rawText);
  if (!text) throw new Error('简历内容为空');
  const name = extractName(text) || clean(fileName).replace(/\.[^.]+$/, '') || '未命名候选人';
  const email = (text.match(RE_EMAIL) || [null])[0];
  const phone = extractPhone(text);

  const skillText = sectionBody(text, SKILL_HEADERS);
  const intentText = sectionBody(text, INTENT_HEADERS);

  const tags = [
    ...toTags(skillText || text, 'skill', 8),
    ...toTags(intentText, 'intention', 6),
  ];
  // 摘要：优先求职意向 + 技能，否则取正文前 120 字
  const summary = clean([intentText, skillText].filter(Boolean).join('；')) || text.slice(0, 120);

  return {
    name, phone, email: email ? email.toLowerCase() : null,
    summary, tags,
    parsedContent: text,
    fileName: clean(fileName) || `${name}.txt`,
  };
}
