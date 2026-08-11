/** adapter.test.mjs - CSV->标准库格式 适配器纯函数测试（不依赖 LLM/网络）。
 * 覆盖：CSV 解析脏情况、市场源公司×岗展开、驾驶舱 membership/stage 映射、
 * HC 抽取、确定性方向分类回退、端到端 dry_run 形状。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { parseCsv } from '../src/csv.js';
import {
  parseMarketCsv, parseCockpitCsv, mapMembership, mapStage, extractHc,
  classifyJobFallback, classifyJobs, classifyCockpit, runAdapter,
  DEFAULT_MARKET_CSV, DEFAULT_COCKPIT_CSV,
} from '../src/adapter.js';

// ---- CSV 解析脏情况 ----
test('parseCsv：剥 BOM、引号内嵌换行/逗号、转义双引号、CRLF', () => {
  const text = '﻿公司,地点,类型\n"A\nB","上海,北京","说""话"""\r\n正常,深圳,科技\r\n';
  const rows = parseCsv(text);
  assert.equal(rows.length, 3);               // 表头 + 2 数据行
  assert.equal(rows[0][0], '公司');          // BOM 剥掉
  assert.equal(rows[1][0], 'A\nB');          // 引号内换行保留
  assert.equal(rows[1][1], '上海,北京');     // 引号内逗号保留
  assert.equal(rows[1][2], '说"话"');        // 转义双引号还原
});

test('parseCsv：丢弃全空行', () => {
  const rows = parseCsv('a,b\n,,\n,,\nc,d');
  assert.equal(rows.length, 2); // 中间两行全空被丢
  assert.deepEqual(rows[1], ['c', 'd']);
});

// ---- 市场源解析 ----
const MARKET_SAMPLE = `﻿公司,地点,公司类型,AI产品,运营,UIUX设计,研发or其他,,,,,,,,,,,
Goodnotes,上海,AI笔记,"C端产品经理 3-1+
增长产品经理 2-1 2-2",增长运营（内容向）,,,,,,,,,,,,,
TTC,北京,AI招聘,AI产品经理-P7,,,Agent研发,,,,,,,,,,,
公司,地点,公司类型,岗位,,,,,,,,,,,,,,
启承资本,北京,咨询,消费品牌战略,,,,,,,,,,,,,,
不活跃岗位,,,,,,,,,,,,,,,,,
Aether AI,上海,具身模型,,海外社媒-欧美,,,,,,,,,,,,,`;

test('parseMarketCsv：公司×职能列×岗展开，project_id 来自 deriveProjectId', () => {
  const rows = parseMarketCsv(MARKET_SAMPLE);
  // Goodnotes: AI产品列「C端产品经理 3-1+ / 增长产品经理 2-1 2-2」= 2 岗，运营列「增长运营」= 1 岗 = 3 岗
  const goodnotes = rows.filter((r) => r.company === 'Goodnotes');
  assert.equal(goodnotes.length, 3);
  const roles = goodnotes.map((r) => r.role).sort();
  assert.ok(roles.includes('C端产品经理 3-1+'));
  assert.ok(roles.includes('增长产品经理 2-1 2-2'));
  assert.ok(roles.includes('增长运营（内容向）'));
  // project_id 形如 P-FIX-XXXXXXXX
  assert.match(rows[0].project_id, /^P-FIX-[0-9A-F]{8}$/);
});

test('parseMarketCsv：单「岗位」列表头段也收岗（col3）', () => {
  const rows = parseMarketCsv(MARKET_SAMPLE);
  const qicheng = rows.find((r) => r.company === '启承资本');
  assert.ok(qicheng);
  assert.equal(qicheng.role, '消费品牌战略');
});

test('parseMarketCsv：「不活跃岗位」段之后 -> active_state=COOLING', () => {
  const rows = parseMarketCsv(MARKET_SAMPLE);
  const aether = rows.find((r) => r.company === 'Aether AI');
  assert.ok(aether);
  assert.equal(aether.active_state, 'COOLING');
  assert.equal(aether.role, '海外社媒-欧美'); // 运营列（col4）
  const ttc = rows.find((r) => r.company === 'TTC');
  assert.equal(ttc.active_state, 'OPEN'); // 不活跃段之前
});

test('parseMarketCsv：公司名去换行（"Machine\\n" -> "Machine"）', () => {
  const rows = parseMarketCsv('公司,地点,类型,AI产品\n"Mach\nine",上海,X,产品');
  assert.equal(rows[0].company, 'Machine');
});

// ---- 驾驶舱源解析 ----
const COCKPIT_SAMPLE = `Felix｜投放・增长・营销项目池,,,,,,,,,,,,,,,,,,,
原飞书表格仅作只读参考,,,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,,
客户,职位,方向标签,优先级,当前状态,关系依据,岗位核心,下一步动作,来源,,,,,,,,,,,
39AI,资深海外投放经理,海外投放 / 效果营销,P0,已参与,Felix已开展,海外效果投放,继续扩搜,驾驶舱与本地项目沉淀,,,,,,,,,,,
Tim合作,AI出海社区商务经理,生态增长,P1,共同参与,Felix与York共同校准,生态合作,获取反馈,群聊,,,,,,,,,,,
notteAI,DTC增长,AI产品增长,P0,驾驶舱推荐,源表Sheet1复制,北美DTC增长,确认预算,https://jxog8b3tny.feishu.cn/wiki/X,,,,,,,,,,,
ActionX,海外增长负责人 / CMO,AI产品,待判断,未加入,职位市场相关岗位,全球化增长,核查活跃度,TTC职位市场,,,,,,,,,,,
蝴蝶梦境,AI增长（2–3 HC）,AI增长,P2,驾驶舱推荐,源表Sheet1复制,乙女游戏增长,确认HC,https://example.com/x`;

test('parseCockpitCsv：跳标题/说明行，从「客户」列头后开始', () => {
  const rows = parseCockpitCsv(COCKPIT_SAMPLE);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].company, '39AI');
});

test('parseCockpitCsv：membership_status 映射四种枚举', () => {
  const rows = parseCockpitCsv(COCKPIT_SAMPLE);
  const byCo = Object.fromEntries(rows.map((r) => [r.company, r]));
  assert.equal(byCo['39AI'].membership_status, 'PRIMARY_PM');
  assert.equal(byCo['Tim合作'].membership_status, 'PARTICIPANT');
  assert.equal(byCo['notteAI'].membership_status, 'MENTIONED');
  assert.equal(byCo['ActionX'].membership_status, 'UNCONFIRMED');
});

test('parseCockpitCsv：current_stage 映射', () => {
  const rows = parseCockpitCsv(COCKPIT_SAMPLE);
  const byCo = Object.fromEntries(rows.map((r) => [r.company, r]));
  assert.equal(byCo['39AI'].current_stage, 'ACTIVE_ADVANCEMENT');
  assert.equal(byCo['ActionX'].current_stage, 'UNCONFIRMED');
  assert.equal(byCo['notteAI'].current_stage, 'NEW_VALIDATION');
});

test('parseCockpitCsv：priority P0/P1/P2 -> HIGH/NORMAL/STANDBY；source_url 仅取 http 链接', () => {
  const rows = parseCockpitCsv(COCKPIT_SAMPLE);
  const byCo = Object.fromEntries(rows.map((r) => [r.company, r]));
  assert.equal(byCo['39AI'].priority, 'HIGH');
  assert.equal(byCo['Tim合作'].priority, 'NORMAL');
  assert.equal(byCo['蝴蝶梦境'].priority, 'STANDBY');
  assert.equal(byCo['notteAI'].source_url, 'https://jxog8b3tny.feishu.cn/wiki/X');
  assert.equal(byCo['39AI'].source_url, null); // 「驾驶舱与本地项目沉淀」非 URL
});

test('parseCockpitCsv：pipeline_snapshot = 岗位核心；next_action = 下一步动作', () => {
  const rows = parseCockpitCsv(COCKPIT_SAMPLE);
  const a = rows.find((r) => r.company === '39AI');
  assert.equal(a.pipeline_snapshot, '海外效果投放');
  assert.equal(a.next_action, '继续扩搜');
});

// ---- HC 抽取 ----
test('extractHc：区间取上界、单值、无 HC 返回 null', () => {
  assert.equal(extractHc('AI增长（2–3 HC）'), 3);
  assert.equal(extractHc('AI增长（2-3 HC）'), 3);
  assert.equal(extractHc('HC=1'), 1);
  assert.equal(extractHc('5 HC'), 5);
  assert.equal(extractHc('没有HC信息'), null);
});

// ---- 确定性方向分类回退 ----
test('classifyJobFallback：投放->PAID_ACQUISITION、产品->PRODUCT、后端->ENGINEERING', () => {
  assert.equal(classifyJobFallback('资深海外投放经理', 'growth'), 'PAID_ACQUISITION');
  assert.equal(classifyJobFallback('AI产品经理', 'product'), 'PRODUCT');
  assert.equal(classifyJobFallback('Agent后端', 'engineering'), 'ENGINEERING');
  assert.equal(classifyJobFallback('UIUX设计', 'design'), 'DESIGN');
  assert.equal(classifyJobFallback('海外运营负责人', 'growth'), 'OPERATIONS');
});

test('classifyJobFallback：未命中关键词按 hint 兜底', () => {
  assert.equal(classifyJobFallback('神秘岗位', 'product'), 'PRODUCT');
  assert.equal(classifyJobFallback('神秘岗位', 'growth'), 'OPERATIONS');
});

// ---- LLM 未配置时走回退（classifyJobs / classifyCockpit 同步可跑）----
test('classifyJobs：未配 LLM 返回规则回退，每行一个分类', async () => {
  const rows = parseMarketCsv(MARKET_SAMPLE);
  const map = await classifyJobs(rows);
  assert.equal(map.size, rows.length);
  for (const c of map.values()) {
    assert.match(c.classification_version, /rules-v1/);
    assert.ok(typeof c.is_leadership === 'boolean');
  }
});

test('classifyCockpit：未配 LLM 返回规则回退', async () => {
  const rows = parseCockpitCsv(COCKPIT_SAMPLE);
  const map = await classifyCockpit(rows);
  assert.equal(map.size, rows.length);
  assert.equal(map.get(rows[0].project_id).membership_status, 'PRIMARY_PM');
});

// ---- 端到端 dry_run（用真实 CSV，若存在）----
test('runAdapter dry_run：真实 CSV -> 标准格式 JSON，形状完整', async () => {
  if (!existsSync(DEFAULT_MARKET_CSV) || !existsSync(DEFAULT_COCKPIT_CSV)) {
    return; // 无 CSV 环境（CI）跳过
  }
  const out = await runAdapter(null, { dry_run: true });
  assert.equal(out.source, 'adapter');
  assert.ok(out.rows.market > 0, '市场源应解析出 >0 个职位');
  assert.ok(out.rows.cockpit > 0, '驾驶舱源应解析出 >0 个项目');
  assert.ok(out.job_facts.length > 0);
  assert.ok(out.job_classifications.length > 0);
  assert.ok(out.cockpit_facts.length > 0);
  // job_facts 字段齐全
  const j = out.job_facts[0];
  for (const f of ['project_id', 'company', 'role', 'active_state']) {
    assert.ok(j[f] != null, `job_facts 缺字段 ${f}`);
  }
});
