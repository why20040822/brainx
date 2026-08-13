"use client";

import { ArrowRight, Check, ChevronRight, CircleHelp, Menu, PanelRight, ShieldCheck, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import "./showcase.css";

type View = "today" | "signal" | "trace";

const views: Record<View, { label: string; eyebrow: string; title: string; summary: string; rows: [string, string, string, string][]; note: string }> = {
  today: {
    label: "今日判断", eyebrow: "TODAY / PRIORITY", title: "今天先做这 3 个职位", summary: "已先处理关闭、入职、HC 与项目重复，再按当前可推进性排序。",
    rows: [["01", "39‑AI · 资深海外投放经理", "高动能推进", "推进 82"], ["02", "上海蝴蝶梦境 · 资深广告优化师", "需要核验", "探索 95"], ["03", "Aha.AI · B2B 投放专员", "已查看", "个人 71"]], note: "9 个有效机会 · 3 个待核验 · 2 个承接中",
  },
  signal: {
    label: "关键事实", eyebrow: "SIGNAL / EVIDENCE", title: "判断先回到事实", summary: "未知、缺失与已确认信息分开表达，避免把历史或推测当成现在。",
    rows: [["HC", "39‑AI · 剩余 HC", "已确认", "1 个"], ["!", "上海蝴蝶梦境 · 项目归属", "待核验", "不占 Top 3"], ["→", "科漫智能 · 客户反馈", "24 小时内", "可推进"]], note: "每一条推荐都有事实来源与有效时间",
  },
  trace: {
    label: "判断轨迹", eyebrow: "TRACE / REPLAY", title: "当时为什么这样判断", summary: "快照冻结当下的排名、证据与规则；后续动作只作为之后发生的信息。",
    rows: [["01", "08.11 · 推荐快照", "Policy v1.2", "Final 80"], ["02", "确认 Offer 状态", "已记录", "08.12"], ["03", "接单并推进", "承接中", "下一步"]], note: "当前事实不会改写历史判断",
  },
};

export default function BtexShowcase() {
  const [view, setView] = useState<View>("today");
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const active = views[view];
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); setHelpOpen(false); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);

  return <main className="btex-showcase" id="top">
    <header className="btex-showcase-nav">
      <a className="btex-showcase-brand" href="#top"><span>∞</span><b>B‑tex</b></a>
      <nav aria-label="展示页导航"><a href="#product">产品</a><a href="#principles">判断原则</a><a href="#scope">当前范围</a></nav>
      <a className="nav-cta" href="/">打开工作台 <ArrowRight /></a>
      <button className="mobile-menu" type="button" onClick={() => setMenuOpen(true)} aria-label="打开菜单"><Menu /></button>
    </header>

    <section className="launch" id="product">
      <div className="launch-copy"><p className="launch-kicker">B‑TEX / JOB DECISION WORKBENCH</p><h1>让职位判断，<br />直接变成下一步。</h1><p className="launch-description">B‑tex 把职位、客户与项目事实归在一处。它不要求你记住所有线索，而是在需要决定的时候给出清晰、可解释、可以执行的下一步。</p><div className="launch-actions"><a className="primary-launch" href="/">进入职位决策台 <ArrowRight /></a><button className="quiet-launch" type="button" onClick={() => setHelpOpen(true)}>它如何判断 <CircleHelp /></button></div><p className="launch-caption"><i />当前为前端演示版 · 本地状态与交互已可用</p></div>
      <section className="workbench-frame" aria-label="B-tex 工作台预览">
        <div className="frame-topbar"><span className="frame-user"><i>∞</i> Felix</span><span className="frame-snapshot">Snapshot #1842 · 11:28</span><span className="frame-status"><i />已同步</span></div>
        <div className="frame-content"><aside className="frame-rail" aria-hidden="true"><i>⌘</i><i className="selected">⊞</i><i>〽</i><i>◌</i><i>⌁</i></aside><div className="frame-main"><div className="frame-heading"><div><small>{active.eyebrow}</small><h2>{active.title}</h2><p>{active.note}</p></div><button type="button" onClick={() => setHelpOpen(true)} aria-label="说明"><CircleHelp /></button></div><div className="frame-switch" role="tablist" aria-label="预览内容">{(Object.keys(views) as View[]).map(item => <button type="button" role="tab" aria-selected={view === item} className={view === item ? "active" : ""} onClick={() => setView(item)} key={item}>{views[item].label}</button>)}</div><p className="frame-summary">{active.summary}</p><div className="frame-list">{active.rows.map(row => <article key={row[0] + row[1]}><b>{row[0]}</b><span><strong>{row[1]}</strong><small>{row[2]}</small></span><em>{row[3]}</em><ChevronRight /></article>)}</div></div></div>
      </section>
    </section>

    <section className="principles" id="principles"><div className="section-intro"><p>01 / THE DECISION</p><h2>少一点“信息”，<br />多一点<span>可以决定的事。</span></h2></div><div className="principle-list"><article><span>01</span><h3>先把事实收口</h3><p>关闭、入职、HC、项目归属与当前状态优先处理。UNKNOWN 就是 UNKNOWN，不写成看似确定的数字。</p></article><article><span>02</span><h3>再给出可信排序</h3><p>推进、探索、个人适配与判断可靠度并列呈现。分数是线索，而不是替代判断的答案。</p></article><article><span>03</span><h3>只展示允许的动作</h3><p>验证、关注、接单、完成，都由当前身份与事实决定。前端不擅自推断权限或补全缺失事实。</p></article></div></section>

    <section className="evidence-band"><div><p>02 / EXPLAINABLE BY DEFAULT</p><h2>每一次推荐，<br />都能回到它的来处。</h2></div><dl><div><dt>当前事实</dt><dd>职位关系、Offer、HC、最新活动</dd></div><div><dt>判断说明</dt><dd>评分拆解、风险与未知原因</dd></div><div><dt>冻结回放</dt><dd>当时快照与后续结果并列呈现</dd></div></dl></section>

    <section className="scope" id="scope"><div><p>03 / THE CURRENT SURFACE</p><h2>为后端留好接口，<br />但不假装它已经接上。</h2></div><div className="scope-grid"><article><Check /><h3>今日判断</h3><p>按业务阶段组织 Top 3、核验与排除区。</p></article><article><PanelRight /><h3>并排详情</h3><p>判断、承接、轨迹与回放都留在同一工作流。</p></article><article><ShieldCheck /><h3>本地可演示</h3><p>同步、身份、通知与承接状态可完整走通。</p></article></div><p className="scope-note">当前是前端原型：真实排序、权限、同步与推送均等待后端适配层接入。</p></section>

    <section className="final-cta"><p>B‑TEX / FACTS BECOME ACTION</p><h2>下一步，不必靠记住。</h2><a href="/">打开职位决策台 <ArrowRight /></a><footer><span>B‑tex</span><span>职位决策工作台</span><span>2026</span></footer></section>

    {helpOpen && <div className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={() => setHelpOpen(false)}><button className="help-scrim" type="button" aria-label="关闭说明"/><section onClick={event => event.stopPropagation()}><button type="button" className="dialog-close" onClick={() => setHelpOpen(false)} aria-label="关闭说明"><X /></button><p>HOW B‑TEX WORKS</p><h2 id="help-title">先判断事实，<br />再分配注意力。</h2><div><span><b>1</b> 排除关闭、入职、HC 为 0 和重复机会。</span><span><b>2</b> 以当前事实组织推进、核验与观察。</span><span><b>3</b> 只展示服务端允许的下一步动作。</span></div></section></div>}
    {menuOpen && <aside className="showcase-drawer" aria-label="展示页菜单"><button type="button" onClick={() => setMenuOpen(false)}>关闭 <X /></button><nav><a href="#product" onClick={() => setMenuOpen(false)}>产品</a><a href="#principles" onClick={() => setMenuOpen(false)}>判断原则</a><a href="#scope" onClick={() => setMenuOpen(false)}>当前范围</a></nav><a href="/">打开工作台 <ArrowRight /></a></aside>}
  </main>;
}
