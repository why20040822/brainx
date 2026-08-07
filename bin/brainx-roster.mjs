#!/usr/bin/env node
/** brainx-roster — 从 FLX 群成员在线刷新顾问花名册（lark-cli user 身份）。
 * 用法：node bin/brainx-roster.mjs [--chat oc_xxx]（默认 FLX 职位优先级群）
 */
import '../src/env.js';
import { execFileSync } from 'node:child_process';
import { openDb } from '../src/db.js';
import { upsertMembers, listConsultants } from '../src/roster.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const chat = arg('chat', 'oc_667758eb50ad4b1af86ae99d79859870'); // FLX-职位优先级群

const out = execFileSync('lark-cli', ['im', 'chat.members', 'get', '--chat-id', chat, '--format', 'json'],
  { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const d = JSON.parse(out.slice(out.indexOf('{')));
const members = (d?.data?.items || d?.data?.data?.items || []).filter((m) => m.member_id_type === 'open_id');
if (!members.length) { console.error('未拉到群成员'); process.exit(1); }

const db = openDb();
const n = upsertMembers(db, members);
console.log(`upsert ${n} 人：`);
for (const c of listConsultants(db)) console.log(` ${c.consultant_id}\t${c.display_name}\t${c.open_id}`);
