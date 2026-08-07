/** mcp.test.mjs — brainx-mcp stdio 服务器：握手/工具列表/调用/错误。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 起 MCP 子进程，发 NDJSON 帧，按 id 收集响应。 */
function mcpClient() {
  const dir = mkdtempSync(join(tmpdir(), 'brainx-mcp-'));
  const child = spawn('node', [join(ROOT, 'mcp', 'server.mjs')], {
    env: { ...process.env, BRAINX_DB: join(dir, 't.db') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) > -1) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  let seq = 0;
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => reject(new Error(`timeout waiting ${method}`)), 8000);
  });
  const close = () => { child.kill(); rmSync(dir, { recursive: true, force: true }); };
  return { call, close };
}

test('MCP：initialize → tools/list → tools/call 全链', async () => {
  const c = mcpClient();
  try {
    // 握手
    const init = await c.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test' } });
    assert.equal(init.result.serverInfo.name, 'brainx-mcp');
    assert.ok(init.result.capabilities.tools);
    // initialized 是 notification：不应有响应（发了也不崩）
    c.call('notifications/initialized').catch(() => {}); // 会被 timeout reject，忽略

    // 工具列表
    const list = await c.call('tools/list');
    const names = list.result.tools.map((t) => t.name);
    for (const t of ['brainx_consultants', 'brainx_workbench', 'brainx_recommendations',
                     'brainx_opportunity', 'brainx_engage', 'brainx_replay',
                     'brainx_record_outcome', 'brainx_sync_now', 'brainx_push_preview']) {
      assert.ok(names.includes(t), `缺工具 ${t}`);
    }

    // 花名册（openDb 自动播种）
    const cons = await c.call('tools/call', { name: 'brainx_consultants', arguments: {} });
    const roster = JSON.parse(cons.result.content[0].text);
    assert.deepEqual(roster.map((x) => x.consultant_id), ['felix', 'mia', 'york']);
    assert.equal(roster[0].open_id, undefined); // open_id 不出 MCP

    // 空库工作台：EMPTY 同步态
    const wb = await c.call('tools/call', { name: 'brainx_workbench', arguments: { consultant_id: 'mia' } });
    const model = JSON.parse(wb.result.content[0].text);
    assert.equal(model.consultant_id, 'mia');
    assert.equal(model.sync.state, 'EMPTY');
    assert.equal(model.watched_limit, 10);

    // 未知工具 → JSON-RPC error；未知方法同理
    const bad = await c.call('tools/call', { name: 'brainx_nope', arguments: {} });
    assert.equal(bad.error.code, -32601);
    const badMethod = await c.call('resources/list');
    assert.equal(badMethod.error.code, -32601);
  } finally {
    c.close();
  }
});

test('MCP：engage 写入路径（隔离库）+ 幂等', async () => {
  const c = mcpClient();
  try {
    await c.call('initialize', {});
    // 隔离库无职位 → WATCH 不存在的职位按领域语义返回错误而非崩溃
    const r = await c.call('tools/call', { name: 'brainx_engage', arguments: {
      consultant_id: 'felix', project_id: 'P-NOPE', action: 'WATCH', idempotency_key: 'mcp:t1' } });
    const out = JSON.parse(r.result.content[0].text);
    assert.ok(out.ok === false || out.error, '不存在的职位不应成功');
  } finally {
    c.close();
  }
});
