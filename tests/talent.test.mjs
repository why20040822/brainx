/** talent.test.mjs — 人才库读写层 + 供给适配层（内存后端，无需 RDS）。
 *
 * 覆盖 README「下一步功能」：候选人同步进 talent 表、标签写入、匹配记录写入，
 * 以及旁路供给适配层不进入基础评分的纪律。
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  useMemoryBackend, resetBackend, upsertTalent, attachTags, getTalent,
  listTalents, upsertPosition, writeMatchRecord, listMatchesForPosition,
  talentBackendStatus,
} from '../src/talent.js';
import { talentSupplyForJob, readTalentSupply } from '../src/talent-supply.js';

beforeEach(() => { resetBackend(); useMemoryBackend(); });

test('upsertTalent：按 dedupeKey 幂等（同手机号命中更新而非重复插入）', async () => {
  const a = await upsertTalent({ name: '张三', phone: '13800000000', status: 'active' });
  assert.equal(a.created, true);
  const b = await upsertTalent({ name: '张三（改名）', phone: '13800000000', status: 'contacted' });
  assert.equal(b.created, false);
  assert.equal(b.id, a.id);
  const t = await getTalent(a.id);
  assert.equal(t.status, 'contacted');
});

test('attachTags：自动建标签字典并去重挂载', async () => {
  const { id } = await upsertTalent({ name: '李四' });
  await attachTags(id, [{ name: '海外投放', category: 'skill' }, { name: '海外投放', category: 'skill' }]);
  const t = await getTalent(id);
  assert.equal(t.tags.length, 1);
  assert.equal(t.tags[0].name, '海外投放');
});

test('匹配记录：写入幂等覆盖，按分数倒序列出', async () => {
  const t1 = await upsertTalent({ name: '候选A' });
  const t2 = await upsertTalent({ name: '候选B' });
  const pos = await upsertPosition({ title: '海外增长负责人' });
  await writeMatchRecord({ talentId: t1.id, positionId: pos.id, score: 0.4, detail: { d: 1 } });
  await writeMatchRecord({ talentId: t1.id, positionId: pos.id, score: 0.9, detail: { d: 2 } }); // 覆盖
  await writeMatchRecord({ talentId: t2.id, positionId: pos.id, score: 0.6, detail: {} });
  const matches = await listMatchesForPosition(pos.id);
  assert.equal(matches.length, 2); // t1 只保留一条
  assert.equal(matches[0].talent_id, t1.id);
  assert.equal(matches[0].score, 0.9);
});

test('供给适配层：开关关闭时返回 enabled:false（不进入基础评分）', async () => {
  delete process.env.BRAINX_TALENT_SUPPLY;
  const snap = await talentSupplyForJob({ project_id: 'P-1', company: '39AI', role: '海外投放经理' });
  assert.equal(snap.enabled, false);
});

test('供给适配层：开关开启时产出 TalentSupplySnapshot 并写匹配记录', async () => {
  process.env.BRAINX_TALENT_SUPPLY = '1';
  const cand = await upsertTalent({ name: '投放候选', summary: '资深海外投放经理 效果营销 获客' });
  await attachTags(cand.id, [{ name: '海外投放', category: 'intention' }]);
  const snap = await talentSupplyForJob({ project_id: 'P-39AI', company: '39AI', role: '资深海外投放经理' });
  assert.equal(snap.enabled, true);
  assert.equal(typeof snap.matchableTalentCount, 'number');
  assert.ok(['low', 'medium', 'high'].includes(snap.supplyDifficulty));
  assert.equal(snap.source, 'talent-supply-adapter');
  // 匹配记录已落人才库，可只读回放
  const read = await readTalentSupply({ project_id: 'P-39AI' }, snap.positionId);
  assert.equal(read.enabled, true);
  assert.equal(read.matchableTalentCount, snap.matchableTalentCount);
  delete process.env.BRAINX_TALENT_SUPPLY;
});

test('CSV 同步骨架：从岗位盘点表 UPSERT 候选画像并打意向标签', async () => {
  const { syncTalentsFromCsv } = await import('../src/talent.js');
  const out = await syncTalentsFromCsv(new URL('../公司岗位情况-Shanon - Sheet1.csv', import.meta.url).pathname);
  assert.ok(out.read > 0);
  assert.equal(out.inserted + out.updated, out.read);
  const list = await listTalents({ limit: 5 });
  assert.ok(list.length > 0);
});

test('后端状态：无凭据默认内存后端', async () => {
  const st = await talentBackendStatus();
  assert.equal(st.backend, 'memory');
});
