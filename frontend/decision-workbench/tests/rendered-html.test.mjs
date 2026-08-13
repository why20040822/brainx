import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (name) => readFile(new URL(name, root), "utf8");

test("keeps the supplied workbench shell and exposes three decision directions", async () => {
  const [page, workbench, css] = await Promise.all([
    source("app/page.tsx"),
    source("app/workbench.tsx"),
    source("app/globals.css"),
  ]);

  assert.match(page, /import DecisionWorkbench from "\.\/workbench"/);
  assert.match(workbench, /type DecisionDirection = "paid"\|"growth"\|"marketing"/);
  assert.match(workbench, /paid:\{label:"投放"/);
  assert.match(workbench, /growth:\{label:"增长负责人"/);
  assert.match(workbench, /marketing:\{label:"市场负责人"/);
  assert.match(workbench, /visible=jobs\.filter\(job=>job\.direction===direction\).*?slice\(0,3\)/);
  assert.match(css, /\.direction-tabs\{display:grid;grid-template-columns:repeat\(3/);
  assert.match(css, /\.btex-app\.decision-panel-open/);
});

test("uses the verified rerun snapshot and separates verification from formal Top 3", async () => {
  const workbench = await source("app/workbench.tsx");

  for (const id of ["JU87P01", "J3NBVPJ", "JPG4HAS", "JNDLIXO", "JPZ5RC5", "JVS2PHH", "J90P3H0", "JBWXJ7W", "JU2GCAC"]) {
    assert.match(workbench, new RegExp(`id:"${id}"`));
  }
  assert.match(workbench, /const verificationJobs:DecisionJob\[\]=\[/);
  assert.match(workbench, /"JS6ZVBW","Nooklab","DTC负责人","Offer 1 覆盖剩余 HC 1，入职未确认"/);
  assert.match(workbench, /eligibility:"VERIFY_REQUIRED"/);
  assert.match(workbench, /不占用正式 Top 3/);
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
});

test("preserves engagement, result recording, replay, sync and notifications", async () => {
  const [workbench, demo] = await Promise.all([
    source("app/workbench.tsx"),
    source("app/decision-demo.ts"),
  ]);

  assert.match(workbench, /function WorkbenchPanel/);
  assert.match(workbench, /function EngagementPanel/);
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

  assert.match(workbench, /const \[navOpen,setNavOpen\]=useState\(true\)/);
  assert.match(workbench, /function SidebarCommitments/);
  assert.match(workbench, /className="sidebar-commitments" aria-label="我的承接"/);
  assert.match(workbench, /onOpen=\{job=>openDecision\(job,"engagement"\)\}/);
  assert.match(workbench, /\{kind:"commitments"\}/);
  assert.match(workbench, /function CommitmentsPanel/);
  assert.doesNotMatch(workbench, /<section className="commitments">/);
  assert.match(css, /\.sidebar-commitments\{[^}]*border-top/);
  assert.match(css, /\.btex-app:not\(\.nav-open\) \.commitment-rail-toggle/);
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

test("the corrected package has one workbench implementation", async () => {
  const page = await source("app/page.tsx");
  assert.doesNotMatch(page, /PrototypeWorkbench|variant=/);
});
