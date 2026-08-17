// e2e-browser-check.mjs — 手动端到端验证脚本（不在 npm test 内）。
// 前提：Brain X 单地址服务跑在 127.0.0.1:3100（BRAINX_DEV_AUTH=1）。
// 如使用独立前端，可用 BRAINX_E2E_BASE 覆盖，例如 http://127.0.0.1:4320/。
// 用法：node tests/e2e-browser-check.mjs
// 流程：headless Chrome → 打开前端 → dev 登录 felix → 刷新 → 校验 connected 模式渲染
//       → 待接单区第一个职位：关注 → 接单（二次确认弹窗）→ 回写结果 → 刷新持久化
//       → 第二个职位：暂不考虑（原因枚举弹窗）→ 退出会话回退演示模式。
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = 9333;
const BASE = process.env.BRAINX_E2E_BASE || "http://127.0.0.1:3100/";

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${DEBUG_PORT}`,
  "--user-data-dir=/tmp/brainx-e2e-chrome", "--no-first-run", "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

let ws;
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const pending = new Map();
    let seq = 0;
    socket.onopen = () => resolve({
      send(method, params = {}) {
        const id = ++seq;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((res, rej) => pending.set(id, { res, rej }));
      },
      close: () => socket.close(),
    });
    socket.onerror = () => reject(new Error("ws error"));
    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };
  });
}

async function evaluate(expr, awaitPromise = false) {
  const r = await ws.send("Runtime.evaluate", {
    expression: expr, awaitPromise, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || "eval failed");
  return r.result.value;
}
const openPendingRow = (i) => evaluate(`(() => { const rows = [...document.querySelectorAll('.decision-zone.pending .decision-row')]; rows[${i}]?.querySelector('.decision-row-toggle')?.click(); return rows[${i}] ? rows[${i}].querySelector('.decision-title b')?.textContent : null; })()`);
const clickDrawerTab = (label) => evaluate(`(() => { const btns = [...document.querySelectorAll('.drawer-tabs button')]; const b = btns.find(x => x.textContent === '${label}'); b?.click(); return !!b; })()`);
const drawerChip = () => evaluate(`document.querySelector('.drawer-title .decision-state')?.textContent || ""`);
const sectionTitles = () => evaluate(`[...document.querySelectorAll('.decision-drawer .drawer-section h2')].map(h => h.textContent).join("|")`);
const modalButtons = () => evaluate(`[...document.querySelectorAll('.command-modal button')].map(b => b.textContent).join("|")`);
const closeDrawer = () => evaluate(`(() => { const b = document.querySelector('.decision-drawer .drawer-close'); b ? b.click() : window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); return true; })()`);

try {
  let version = null;
  for (let i = 0; i < 30; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json(); break; }
    catch { await sleep(300); }
  }
  if (!version) throw new Error("Chrome DevTools 未就绪");

  const tab = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(BASE)}`, { method: "PUT" })).json();
  ws = await connect(tab.webSocketDebuggerUrl);
  await ws.send("Runtime.enable");
  await ws.send("Page.enable");
  await sleep(4000);

  // 1) 未登录 → 演示模式回退
  const offlineText = await evaluate("document.body.innerText");
  console.log(`[1] 未登录回退演示模式: ${offlineText.includes("演示模式") ? "PASS" : "FAIL"}`);

  // 2) dev 登录 felix → connected
  await evaluate(`fetch('/api/v1/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consultant_id:'felix'})}).then(r=>r.status)`, true);
  await ws.send("Page.reload");
  await sleep(6000);
  const text = await evaluate("document.body.innerText");
  console.log(`[2] 连接标识: ${text.includes("BrainX 已连接") ? "PASS" : "FAIL"}`);
  console.log(`[2] 后端推荐数据（Rockflow）: ${text.includes("Rockflow") ? "PASS" : "FAIL"}`);
  console.log(`[2] 后端策略版本（baseline-1.0）: ${text.includes("baseline-1.0") ? "PASS" : "FAIL"}`);
  console.log(`[2] 双分区渲染: ${(text.includes("已接单区") && text.includes("待接单区")) ? "PASS" : "FAIL"}`);

  // 3) 待接单区第一个职位：打开 → 承接与结果 → 关注 → 接单（确认弹窗）→ 回写 → 刷新持久化
  const company = await openPendingRow(0);
  await sleep(1200);
  await clickDrawerTab("承接与结果");
  await sleep(600);
  console.log(`[3] 职位 ${company || "?"} 承接面板打开: ${(await sectionTitles()).includes("承接状态") ? "PASS" : "FAIL"}`);
  console.log(`[3] 初始允许动作（关注/接单/暂不考虑）: ${await evaluate(`[...document.querySelectorAll('.command-grid button')].map(b=>b.textContent.trim()).join("/")`)}`);

  await evaluate(`(() => { const b = [...document.querySelectorAll('.command-grid button')].find(x => x.textContent.trim() === '关注'); b?.click(); return !!b; })()`);
  await sleep(1200);
  console.log(`[3] 关注后状态（关注中）: ${(await drawerChip()).includes("关注中") ? "PASS" : "FAIL"}`);

  await evaluate(`(() => { const b = [...document.querySelectorAll('.command-grid button')].find(x => x.textContent.trim().startsWith('接单')); b?.click(); return !!b; })()`);
  await sleep(800);
  console.log(`[3] 接单二次确认弹窗: ${(await modalButtons()).includes("确认接单") ? "PASS" : "FAIL"}`);
  await evaluate(`(() => { const b = [...document.querySelectorAll('.command-modal button')].find(x => x.textContent === '确认接单'); b?.click(); return !!b; })()`);
  await sleep(1500);
  const afterAccept = await drawerChip();
  const titles3 = await sectionTitles();
  console.log(`[3] 接单后状态（已接单 + 可回写记录结果）: ${(afterAccept.includes("已接单") && titles3.includes("记录结果")) ? "PASS" : "FAIL"}`);

  await evaluate(`(() => { const b = [...document.querySelectorAll('.outcome-form button')].find(x => x.textContent === '记录'); b?.click(); return !!b; })()`);
  await sleep(1500);
  console.log(`[3] 结果回写后列表出现推荐采纳: ${(await evaluate("document.body.innerText")).includes("推荐采纳") ? "PASS" : "FAIL"}`);
  await closeDrawer();
  await sleep(400);

  // 4) 刷新持久化：该职位应留在已接单区（后端账本驱动）
  await ws.send("Page.reload");
  await sleep(6000);
  const acceptedZoneText = await evaluate(`document.querySelector('.decision-zone.accepted')?.innerText || ""`);
  console.log(`[4] 刷新后 ${company || "?"} 保留在已接单区: ${acceptedZoneText.includes(company) ? "PASS" : "FAIL"}`);

  // 5) 第二个职位：暂不考虑（原因枚举弹窗，枚举来自后端 /dismiss-reasons）
  const company2 = await openPendingRow(0);
  await sleep(1200);
  await clickDrawerTab("承接与结果");
  await sleep(600);
  await evaluate(`(() => { const b = [...document.querySelectorAll('.command-grid button')].find(x => x.textContent.trim() === '暂不考虑'); b?.click(); return !!b; })()`);
  await sleep(800);
  const modalBtns = await modalButtons();
  await evaluate(`(() => { const t = document.querySelector('.command-modal .filter-select-trigger'); t?.click(); return !!t; })()`);
  await sleep(400);
  const reasonOptions = await evaluate(`[...document.querySelectorAll('.command-modal .filter-select-menu button')].map(b => b.textContent).join("/")`);
  console.log(`[5] ${company2 || "?"} 暂不考虑弹窗（原因枚举来自后端）: ${(modalBtns.includes("记录原因") && reasonOptions.includes("当前没精力") && reasonOptions.includes("信息不完整")) ? "PASS" : "FAIL"}`);
  await evaluate(`(() => { const b = [...document.querySelectorAll('.command-modal button')].find(x => x.textContent === '记录原因'); b?.click(); return !!b; })()`);
  await sleep(1500);
  const dismissedChip = await drawerChip();
  const rewatch = await evaluate(`[...document.querySelectorAll('.command-grid button')].map(b => b.textContent.trim()).join("/")`);
  console.log(`[5] 暂不考虑后状态（暂不考虑 + 可重新关注）: ${(dismissedChip.includes("暂不考虑") && rewatch.includes("重新关注")) ? "PASS" : "FAIL"}`);

  // 5b) 重新关注（后端冷却期内应拒绝并提示）
  await evaluate(`(() => { const b = [...document.querySelectorAll('.command-grid button')].find(x => x.textContent.trim() === '重新关注'); b?.click(); return !!b; })()`);
  let toastText = "";
  for (let i = 0; i < 10; i++) {
    await sleep(200);
    toastText = await evaluate(`document.querySelector('.toast')?.textContent || ""`);
    if (toastText) break;
  }
  console.log(`[5] 冷却期内重新关注被后端拒绝（toast: ${toastText.trim() || "无"}) : ${(toastText.includes("冷却期") || toastText.includes("操作失败")) ? "PASS" : "FAIL"}`);

  // 6) 同步面板：连接态点击重新同步 → 触发 fixture 同步 + 新推荐
  await closeDrawer();
  await sleep(400);
  await evaluate(`document.querySelector('.sync-trigger')?.click()`);
  await sleep(600);
  const syncCaption = await evaluate(`[...document.querySelectorAll('.panel-caption')].map(p => p.textContent).join("|")`);
  console.log(`[6] 同步面板连接态文案: ${syncCaption.includes("已连接 Brain X 后端") ? "PASS" : "FAIL"}`);
  await evaluate(`(() => { const b = [...document.querySelectorAll('.drawer-actions button')].find(x => x.textContent.includes('重新同步')); b?.click(); return !!b; })()`);
  await sleep(4000);
  const syncState = await evaluate(`document.querySelector('.sync-trigger')?.textContent || ""`);
  console.log(`[6] 重新同步后回到已同步（Snapshot #）: ${/Snapshot #/.test(syncState) ? "PASS" : "FAIL"}`);

  // 6b) 职位雷达：后端候选池 + 驾驶舱导入过滤
  await closeDrawer();
  await sleep(400);
  await evaluate(`(() => { const b = [...document.querySelectorAll('.nav button')].find(x => x.textContent.includes('职位雷达')); b?.click(); return !!b; })()`);
  await sleep(1500);
  const radarText = await evaluate("document.body.innerText");
  const radarRowCount = await evaluate(`document.querySelectorAll('.data-table tbody tr').length`);
  const cockpitLabel = await evaluate(`(() => { const t = [...document.querySelectorAll('.filter-select-trigger')].find(x => x.textContent.includes('来源')); t?.click(); return true; })()`);
  await sleep(300);
  const sourceOptions = await evaluate(`[...document.querySelectorAll('.filter-select-menu button')].map(b => b.textContent).join("|")`);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  console.log(`[6b] 雷达显示后端数据池（${radarRowCount} 行，含驾驶舱导入过滤）: ${(radarRowCount > 50 && /驾驶舱导入 · [1-9]/.test(sourceOptions) && radarText.includes("Brain X")) ? "PASS" : "FAIL"}`);
  await evaluate(`(() => { const b = [...document.querySelectorAll('.data-table tbody .link')].find(x => x.textContent === '蝴蝶梦境' || x.closest('tr')?.textContent.includes('蝴蝶梦境')); if (b) return false; const rows = [...document.querySelectorAll('.data-table tbody tr')]; const row = rows.find(r => r.textContent.includes('蝴蝶梦境')); row?.querySelector('.link')?.click(); return !!row; })()`);
  await sleep(800);
  const radarDetail = await evaluate("document.body.innerText");
  console.log(`[6b] 雷达职位详情可打开（后端事实字段）: ${(radarDetail.includes("已导入字段") || radarDetail.includes("HC") || radarDetail.includes("职位信号轨道")) ? "PASS" : "FAIL"}`);
  await evaluate(`(() => { const b = document.querySelector('.back'); b?.click(); return !!b; })()`);
  await sleep(400);

  // 6c) 客户洞察：后端公司聚合
  await evaluate(`(() => { const b = [...document.querySelectorAll('.nav button')].find(x => x.textContent.includes('客户洞察')); b?.click(); return !!b; })()`);
  await sleep(1200);
  const clientsText = await evaluate("document.body.innerText");
  const clientRowCount = await evaluate(`document.querySelectorAll('.data-table tbody tr').length`);
  console.log(`[6c] 客户洞察显示后端聚合（${clientRowCount} 行，含活跃职位状态）: ${(clientRowCount > 20 && clientsText.includes("有活跃职位")) ? "PASS" : "FAIL"}`);

  // 7) 退出会话 → 演示模式
  await evaluate(`fetch('/api/v1/session',{method:'DELETE'}).then(r=>r.status)`, true);
  await ws.send("Page.reload");
  await sleep(4000);
  const afterLogout = await evaluate("document.body.innerText");
  console.log(`[7] 退出后回退演示模式: ${afterLogout.includes("演示模式") ? "PASS" : "FAIL"}`);
} catch (e) {
  console.error("E2E FAILED:", e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
}
