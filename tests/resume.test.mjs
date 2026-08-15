/** resume.test.mjs — 简历解析 + 简历→真实候选人入库（内存后端，无需 RDS）。 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseResumeText } from '../src/resume.js';
import {
  useMemoryBackend, resetBackend, ingestResume, syncTalentsFromResumes,
  getTalent, listResumes, listTalents,
} from '../src/talent.js';

beforeEach(() => { resetBackend(); useMemoryBackend(); });

const SAMPLE = `张伟
手机：13812345678
邮箱：zhangwei@example.com
求职意向：海外投放经理 / 效果营销
专业技能：Google Ads Facebook 投放 海外增长 获客
工作经历：某跨境电商 3 年海外效果投放`;

test('parseResumeText：抽出姓名/手机/邮箱/技能与意向标签', () => {
  const p = parseResumeText(SAMPLE, { fileName: 'zhangwei.txt' });
  assert.equal(p.name, '张伟');
  assert.equal(p.phone, '13812345678');
  assert.equal(p.email, 'zhangwei@example.com');
  assert.ok(p.tags.some((t) => t.category === 'skill'));
  assert.ok(p.tags.some((t) => t.category === 'intention'));
  assert.ok(p.summary.length > 0);
});

test('parseResumeText：空内容抛错', () => {
  assert.throws(() => parseResumeText('   '), /简历内容为空/);
});

test('ingestResume：入库真实候选人 + 存简历原文', async () => {
  const out = await ingestResume(SAMPLE, { fileName: 'zhangwei.txt' });
  assert.equal(out.created, true);
  assert.equal(out.name, '张伟');
  assert.ok(out.tags > 0);
  const t = await getTalent(out.id);
  assert.equal(t.phone, '13812345678');
  assert.ok(t.tags.length > 0);
  const resumes = await listResumes(out.id);
  assert.equal(resumes.length, 1);
  assert.ok(resumes[0].preview.includes('张伟'));
});

test('ingestResume：同人第二份简历不重复建候选人（按手机号去重）', async () => {
  const a = await ingestResume(SAMPLE, { fileName: 'v1.txt' });
  const b = await ingestResume(SAMPLE + '\n新增：带团队经验', { fileName: 'v2.txt' });
  assert.equal(b.created, false);
  assert.equal(b.id, a.id);
  const resumes = await listResumes(a.id);
  assert.equal(resumes.length, 2); // 候选人合并，但两份简历都留存
});

test('syncTalentsFromResumes：批量同步返回读/增/改统计', async () => {
  const out = await syncTalentsFromResumes([
    { text: SAMPLE, fileName: 'a.txt' },
    { text: '李娜\n手机：13900000000\n求职意向：品牌市场总监\n技能：市场策划 公关 内容', fileName: 'b.txt' },
    { text: '   ', fileName: 'empty.txt' }, // 空的被跳过
  ]);
  assert.equal(out.read, 2);
  assert.equal(out.inserted, 2);
  const list = await listTalents({ limit: 10 });
  assert.equal(list.length, 2);
});
