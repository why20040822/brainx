import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (name) => readFile(new URL(name, root), "utf8");

test("keeps the supplied workbench shell and presents two balanced decision zones", async () => {
  const [page, workbench, css] = await Promise.all([
    source("app/page.tsx"),
    source("app/workbench.tsx"),
    source("app/globals.css"),
  ]);

  assert.match(page, /import DecisionWorkbench from "\.\/workbench"/);
  assert.match(workbench, /type DecisionDirection = "paid"\|"growth"\|"marketing"/);
  assert.match(workbench, /\["today","精选",Sparkles\]/);
  assert.match(workbench, /精选盘/);
  assert.match(workbench, /function PickTray/);
  assert.match(workbench, /function DecisionZone/);
  assert.match(workbench, /title="未接单"/);
  assert.match(workbench, /aria-label="精选盘"/);
  assert.match(css, /\.pick-tray/);
  assert.match(css, /\.btex-app\.panel-motion-open \.decision-drawer\{filter:none;transition:transform \.30s/);
  assert.match(css, /\.btex-app\.decision-panel-open/);
});

test("splits candidates by their live engagement state and keeps verification jobs pending", async () => {
  const workbench = await source("app/workbench.tsx");

  for (const id of ["JU87P01", "J3NBVPJ", "JPG4HAS", "JNDLIXO", "JPZ5RC5", "JVS2PHH", "J90P3H0", "JBWXJ7W", "JU2GCAC", "JX3S2YU"]) {
    assert.match(workbench, new RegExp(`id:"${id}"`));
  }
  assert.match(workbench, /const verificationJobs:DecisionJob\[\]=\[/);
  assert.match(workbench, /"JS6ZVBW","Nooklab","DTC负责人","Offer 1 覆盖剩余 HC 1，入职未确认"/);
  assert.match(workbench, /eligibility:"VERIFY_REQUIRED"/);
  assert.match(workbench, /const initialEngagement:Record<string,EngagementState>=\{"JU87P01":"ACCEPTED","JNDLIXO":"ACCEPTED","JVS2PHH":"ACCEPTED"/);
  assert.match(workbench, /const acceptedJobs=(?:activeDecisionJobs|jobs)\.filter\(job=>engagement\[job\.id\]==="ACCEPTED"\)/);
  assert.match(workbench, /const pendingJobs=\[\.\.\.jobs\.filter\(job=>engagement\[job\.id\]!=="ACCEPTED"\),\.\.\.verificationJobs\]/);
  assert.match(workbench, /const pendingShown=showVerification\?pendingJobs/);
  assert.match(workbench, /const isContext=activeJobId!==null&&pendingShown\.some/);
  assert.match(workbench, /isContext=\{isContext\}/);
  assert.match(workbench, /title="已确定"/);
  assert.match(workbench, /title="未接单"/);
  assert.match(workbench, /"剩余 HC":"UNKNOWN"/);
});

test("shows source context, three layers, final score, reasons and risks", async () => {
  const workbench = await source("app/workbench.tsx");

  assert.match(workbench, /type SourceMode = "COCKPIT_CONTEXT"\|"MARKET_ONLY"/);
  assert.match(workbench, /sourceMode:"COCKPIT_CONTEXT"/);
  assert.match(workbench, /sourceMode:"MARKET_ONLY"/);
  assert.match(workbench, /label="推进" value=\{job\.globalScore\}/);
  assert.match(workbench, /label="探索" value=\{job\.explorationScore\}/);
  assert.match(workbench, /label="个人" value=\{job\.personalScore\}/);
  assert.match(workbench, /label="最终" value=\{job\.finalScore\}/);
  assert.match(workbench, /DrawerSection title="风险与缺失"/);
  assert.match(workbench, /DrawerSection title="证据来源"/);
  assert.match(workbench, /brainx:edit-facts/);
  assert.match(workbench, /确认事实后，必须完成重新判断，分数才会更新/);
});

test("preserves engagement, result recording, replay, sync and notifications", async () => {
  const [workbench, demo] = await Promise.all([
    source("app/workbench.tsx"),
    source("app/decision-demo.ts"),
  ]);

  assert.match(workbench, /function WorkbenchPanel/);
  assert.match(workbench, /function EngagementPanel/);
  assert.match(workbench, /function engagementStateMessage/);
  assert.match(workbench, /if\(state==="RELEASED"\)return \["WATCH","DISMISS"\]/);
  assert.match(workbench, /if\(state==="DISMISSED"\)return \["WATCH"\]/);
  assert.match(workbench, /已从当前工作区释放；如需继续推进，可重新关注后再接单。/);
  assert.match(workbench, /DrawerSection title=\{canRecordOutcome\?"记录结果":"结果记录"\}/);
  assert.match(workbench, /function ReplayPanel/);
  assert.match(workbench, /function NotificationPanel/);
  assert.match(workbench, /const runSync=\(\)=>/);
  assert.match(workbench, /const recordOutcome=/);
  assert.match(workbench, /localStorage\.setItem\("decision-workbench"/);
  assert.match(demo, /export type EngagementState = "NEW"\|"RECOMMENDED"\|"VIEWED"\|"WATCHED"\|"ACCEPTED"/);
});

test("keeps my commitments in the left workspace and removes the bottom duplicate", async () => {
  const [workbench, css] = await Promise.all([
    source("app/workbench.tsx"),
    source("app/globals.css"),
  ]);

  assert.match(workbench, /const \[navOpen,setNavOpen\]=useState\(false\)/);
  assert.match(workbench, /\{kind:"commitments"\}/);
  assert.match(workbench, /function CommitmentsPanel/);
  assert.match(workbench, /className="mobile-commitment-trigger"/);
  assert.doesNotMatch(workbench, /<section className="commitments">/);
  assert.match(css, /\.mobile-commitment-trigger\{display:none\}/);
});

test("manual tuning adjusts soft layers without bypassing hard rules", async () => {
  const workbench = await source("app/workbench.tsx");

  assert.match(workbench, /useState\(\[60,25,15\]\)/);
  assert.match(workbench, /const names=\["项目推进","探索机会","个人适配"\]/);
  assert.match(workbench, /const canApply=total===100/);
  assert.match(workbench, /保存并生成新推荐/);
  assert.match(workbench, /不可调整：HC、已入职、职位关闭、项目归属与数据冲突规则/);
  assert.match(workbench, /job\.eligibility!=="ELIGIBLE"/);
  assert.match(workbench, /finalScore:seed\.final/);
  assert.doesNotMatch(workbench, /globalScore\s*\*|explorationScore\s*\*|personalScore\s*\*/);
});

test("imports cockpit positions into the radar without inventing operational facts", async () => {
  const [workbench, cockpit] = await Promise.all([
    source("app/workbench.tsx"),
    source("app/cockpit-radar-data.ts"),
  ]);

  assert.match(cockpit, /Generated from TTC驾驶舱全景图-副本 \(1\)\.xlsx/);
  assert.match(cockpit, /"company": "Nooklab"/);
  assert.match(workbench, /const cockpitRadarJobs:Job\[\]/);
  assert.match(workbench, /source:"驾驶舱导入" as const/);
  assert.match(workbench, /score:null,hc:null,feedback:"待接入"/);
  assert.match(workbench, /职位类型筛选/);
  assert.match(workbench, /全部职位类型/);
  assert.match(workbench, /CockpitJobDetail/);
  assert.match(workbench, /等待后端同步后再参与职位判断/);
});

test("the corrected package has one workbench implementation", async () => {
  const page = await source("app/page.tsx");
  assert.doesNotMatch(page, /PrototypeWorkbench|variant=/);
});
