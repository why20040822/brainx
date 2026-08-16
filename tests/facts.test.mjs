import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { runSync } from '../src/sync.js';
import { recommend } from '../src/recommend.js';
import { effectiveJob, updateFactOverrides } from '../src/facts.js';
import { createServer } from '../src/server.js';
import { signSession } from '../src/session.js';

const payload = (active_state = 'COOLING') => ({
  as_of: '2026-08-16T00:00:00.000Z',
  jobs: [{ project_id: 'P-MANUAL-FACT', company: '活跃项目公司', role: '增长负责人', city: '上海',
    pipeline: null, hc: null, active_state, priority: 'NORMAL', notes: '同步备注',
    source_url: null, relation: 'MY_JOB', captured_at: '2026-08-15T00:00:00.000Z' }],
});

test('事实覆盖：只影响当前顾问、保存后重算、同步源与旧推荐不被改写', () => {
  const db = openDb(':memory:');
  runSync(db, { source: 'test', consultant_id: 'felix', payload: payload() });
  const sourceBefore = db.prepare('SELECT active_state, pipeline, hc, notes FROM job_facts WHERE project_id=?').get('P-MANUAL-FACT');
  const firstRun = recommend(db, 'felix', { top: 10 });
  assert.equal(firstRun.blocked, false);
  assert.equal(firstRun.items.length, 0); // COOLING 被硬约束拦截

  const update = updateFactOverrides(db, 'felix', 'P-MANUAL-FACT', {
    changes: { active_state: 'OPEN', current_stage: 'INTERVIEW', pipeline_snapshot: '面试 2',
      remaining_hc: 1, next_action: '确认客户反馈', notes: 'Felix 手动核验为活跃项目' },
    idempotency_key: 'facts:test:1',
  });
  assert.equal(update.ok, true);
  const effective = effectiveJob(db, 'felix', 'P-MANUAL-FACT');
  assert.equal(effective.active_state, 'OPEN');
  assert.equal(effective.pipeline, '面试 2');
  assert.equal(effective.hc, 1);
  assert.equal(effective.current_stage, 'INTERVIEW');
  assert.equal(effective.fact_sources.active_state, 'MANUAL');
  assert.deepEqual(db.prepare('SELECT active_state, pipeline, hc, notes FROM job_facts WHERE project_id=?').get('P-MANUAL-FACT'), sourceBefore);

  const secondRun = recommend(db, 'felix', { top: 10 });
  const rec = secondRun.items.find((item) => item.job.project_id === 'P-MANUAL-FACT');
  assert.ok(rec);
  assert.ok(rec.score > 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM fact_override_events WHERE consultant_id=?').get('felix').n, 1);

  const duplicate = updateFactOverrides(db, 'felix', 'P-MANUAL-FACT', {
    changes: { active_state: 'OPEN' }, idempotency_key: 'facts:test:1',
  });
  assert.equal(duplicate.already, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM fact_override_events WHERE consultant_id=?').get('felix').n, 1);

  const other = effectiveJob(db, 'mia', 'P-MANUAL-FACT');
  assert.equal(other.active_state, 'COOLING');
  assert.equal(other.fact_sources.active_state, 'SYNC');

  const cleared = updateFactOverrides(db, 'felix', 'P-MANUAL-FACT', {
    clear_fields: ['active_state', 'pipeline_snapshot', 'remaining_hc'], idempotency_key: 'facts:test:2',
  });
  assert.equal(cleared.ok, true);
  const restored = effectiveJob(db, 'felix', 'P-MANUAL-FACT');
  assert.equal(restored.active_state, 'COOLING');
  assert.equal(restored.pipeline, null);
  assert.equal(restored.hc, null);
  db.close();
});

test('HTTP：PATCH 事实接口返回新推荐，详情返回来源和审计轨迹', async () => {
  const db = openDb(':memory:');
  runSync(db, { source: 'test', consultant_id: 'felix', payload: payload('OPEN') });
  recommend(db, 'felix', { top: 10 });
  const server = createServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const cookie = `brainx_session=${encodeURIComponent(signSession('felix', 'ou_felix'))}`;
  const patch = await fetch(`http://127.0.0.1:${port}/api/v1/opportunities/P-MANUAL-FACT/facts`, {
    method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes: { current_stage: 'OFFER', remaining_hc: 1 }, idempotency_key: 'facts:http:1' }),
  });
  assert.equal(patch.status, 200);
  const patchBody = await patch.json();
  assert.equal(patchBody.effective.current_stage, 'OFFER');
  assert.ok(patchBody.decision_run_id);

  const detail = await fetch(`http://127.0.0.1:${port}/api/v1/opportunities/P-MANUAL-FACT`, { headers: { Cookie: cookie } });
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.job.current_stage, 'OFFER');
  assert.equal(detailBody.fact_updates.fields.current_stage.source, 'MANUAL');
  assert.ok(detailBody.events.some((event) => event.event_type === 'FACT_UPDATED'));
  await new Promise((resolve) => server.close(resolve));
  db.close();
});
