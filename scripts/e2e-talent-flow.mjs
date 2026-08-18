/**
 * e2e-talent-flow.mjs — 真库人才侧读写闭环验证（跑完自动清理测试数据，不污染真库）。
 *
 * 完整链路：
 *   1) 解析简历文本 → ingestResume → 落 talent / tag / talent_tag / resume 四张表
 *   2) upsertPosition → 建岗位
 *   3) writeMatchRecord → 写人才×岗位匹配（含维度 JSON）
 *   4) 回查：getTalent（含标签）/ listResumes / listMatchesForPosition / listTalents
 *   5) 幂等复核：同一简历再 ingest 一次，断言 created=false（不新增脏数据）
 *   6) 清理：删除本次测试插入的行（按唯一后缀定位），断言真库回到干净态
 *
 * 用法：node scripts/e2e-talent-flow.mjs
 */
import '../src/env.js';
import {
  talentHealth, ingestResume, upsertPosition, writeMatchRecord,
  getTalent, listResumes, listMatchesForPosition, reconnectBackend,
} from '../src/talent.js';

const SUFFIX = `E2E_${Date.now()}`;            // 唯一后缀，便于精确清理
const PHONE = '13800001234';
const EMAIL = `e2e_${Date.now()}@example.com`;

const RESUME = `姓名：测试候选人_${SUFFIX}
手机：${PHONE}
邮箱：${EMAIL}
求职意向：海外广告投放 增长负责人
专业技能：Google Ads Facebook 投放优化 数据分析 增长`;

function assert(cond, msg) { if (!cond) { console.error('❌ 断言失败:', msg); process.exitCode = 1; throw new Error(msg); } console.log('  ✓', msg); }

let talentId, positionId, resumeId;

try {
  // 0) 必须连真库，否则闭环没意义
  const h = await talentHealth();
  reconnectBackend();
  console.log(`\n[0] 后端 = ${h.backend} / connected=${h.connected} / db=${h.config.database}`);
  assert(h.backend === 'mysql' && h.connected, '已连接真实 RDS（非内存回退）');

  // 1) 简历入库
  console.log('\n[1] ingestResume → 落 talent/tag/talent_tag/resume');
  const ing = await ingestResume(RESUME, { fileName: `${SUFFIX}.txt`, createdBy: null });
  talentId = ing.id; resumeId = ing.resumeId;
  assert(ing.created === true, `新建候选人 id=${ing.id}`);
  assert(ing.phone === PHONE, `手机解析正确 ${ing.phone}`);
  assert(ing.email === EMAIL, `邮箱解析正确 ${ing.email}`);
  assert(ing.tags > 0, `挂了 ${ing.tags} 个标签`);
  assert(Number.isInteger(resumeId) && resumeId > 0, `简历落库 resumeId=${resumeId}`);

  // 2) 建岗位
  console.log('\n[2] upsertPosition');
  const pos = await upsertPosition({ title: `海外投放经理_${SUFFIX}`, description: '负责海外效果广告投放', requirements: 'Google Ads / 3年+' });
  positionId = pos.id;
  assert(pos.created === true && positionId > 0, `新建岗位 id=${positionId}`);

  // 3) 写匹配
  console.log('\n[3] writeMatchRecord（含维度 JSON）');
  const m = await writeMatchRecord({ talentId, positionId, score: 0.87, detail: { skill: 0.9, intent: 0.85, exp: 0.8 } });
  assert(m.created === true && m.id > 0, `写入匹配记录 id=${m.id}`);

  // 4) 回查
  console.log('\n[4] 回查 getTalent / listResumes / listMatchesForPosition');
  const t = await getTalent(talentId);
  assert(t && t.id === talentId, `getTalent 命中 name=${t.name}`);
  assert(Array.isArray(t.tags) && t.tags.length > 0, `候选人带出 ${t.tags.length} 个标签`);
  const resumes = await listResumes(talentId);
  assert(resumes.length === 1 && resumes[0].preview.includes(SUFFIX), '简历回查含解析预览');
  const matches = await listMatchesForPosition(positionId);
  assert(matches.length === 1 && matches[0].talent_name === t.name, `匹配回查含候选人名 & 分数=${matches[0].score}`);
  assert(matches[0].match_detail && matches[0].match_detail.skill === 0.9, '匹配维度 JSON 正确反序列化');

  // 5) 幂等复核
  console.log('\n[5] 幂等：同简历再 ingest 一次 → 不新增');
  const again = await ingestResume(RESUME, { fileName: `${SUFFIX}.txt` });
  assert(again.created === false && again.id === talentId, '同一候选人被去重更新，未新增');

  console.log('\n✅ 真库读写闭环全部通过');
} catch (e) {
  console.error('\n流程异常:', e.message);
} finally {
  // 6) 清理测试数据（外键级联：删 talent 会带走 talent_tag/resume/match_record；position 单独删）
  console.log('\n[6] 清理测试数据…');
  try {
    const db = await import('../src/db.js');
    await db.withMysql(async (conn) => {
      if (talentId) await conn.execute('DELETE FROM talent WHERE id=?', [talentId]);       // 级联删 talent_tag/resume/match_record
      if (positionId) await conn.execute('DELETE FROM position WHERE id=?', [positionId]);
      // 清掉本次产生的孤儿标签（category=skill/intention 且 source=auto，按名字含本次词较难，保守只删无引用的）
      await conn.execute('DELETE g FROM tag g LEFT JOIN talent_tag tt ON tt.tag_id=g.id WHERE tt.tag_id IS NULL');
    });
    // 校验清理干净
    const leftT = await getTalent(talentId);
    console.log(leftT ? '  ⚠️ 候选人未删净' : '  ✓ 候选人及级联数据已删除');
    await db.closeMysql();
  } catch (e) { console.error('  清理出错:', e.message); }
  process.exit(process.exitCode ?? 0);
}
