"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, Menu, X } from "lucide-react";
import "./editorial.css";

type Focus = "today" | "signal" | "rules";

const focusCopy: Record<Focus, { index: string; title: string; text: string; tasks: [string, string, string][] }> = {
  today: {
    index: "01 / TODAY",
    title: "先做最值得推进的三个职位",
    text: "推荐、核验与承接被放在同一张判断面上。",
    tasks: [["01", "39‑AI · 资深海外投放经理", "高动能推进"], ["02", "上海蝴蝶梦境 · 资深广告优化师", "需要核验"], ["03", "Aha.AI · B2B 投放专员", "已查看"]],
  },
  signal: {
    index: "02 / SIGNAL",
    title: "不只看分数，也看正在发生什么",
    text: "HC、反馈、阶段和竞争信号共同决定这一步是否值得投入。",
    tasks: [["HC", "剩余职位与项目状态", "已确认"], ["→", "客户反馈与推进节奏", "24h 内"], ["!", "待验证的关键事实", "不占 Top 3"]],
  },
  rules: {
    index: "03 / RULES",
    title: "规则可见，判断才可解释",
    text: "每个推荐都有快照、依据和允许执行的下一步。",
    tasks: [["01", "硬条件先行", "关闭 / 入职 / HC"], ["02", "个人适配只做修正", "不覆盖事实"], ["03", "未知就是未知", "先核验"]],
  },
};

const tiles: { focus: Focus; label: string; className: string; glyph?: string }[] = [
  { focus: "today", label: "today / focus", className: "tile-a" },
  { focus: "signal", label: "signal / evidence", className: "tile-b" },
  { focus: "rules", label: "next", className: "tile-c", glyph: "→" },
  { focus: "today", label: "one page", className: "tile-d" },
  { focus: "rules", label: "policy / trace", className: "tile-e" },
  { focus: "signal", label: "rank / now", className: "tile-f" },
  { focus: "today", label: "decide", className: "tile-g", glyph: "+" },
];

export default function BtexEditorialShowcase() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const current = focus ? focusCopy[focus] : null;
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key !== "Escape") return; setMenuOpen(false); setFocus(null); trigger.current?.focus(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);
  const closeMenu = () => setMenuOpen(false);
  return <main className="editorial-showcase" id="top">
    <header className="editorial-topbar"><a href="#top" className="editorial-brand" aria-label="B-tex 叙事展示首页"><span>∞</span>B‑tex</a><span className="editorial-center">职位决策台 / 叙事版</span><button className="editorial-menu" type="button" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-controls="editorial-menu">菜单 <Menu /></button></header>
    <section className="editorial-hero" aria-labelledby="editorial-title">{tiles.map((tile, index) => <button ref={index === 0 ? trigger : undefined} key={tile.className} className={`hero-tile ${tile.className}`} type="button" onClick={() => setFocus(tile.focus)}><span>{String(index + 1).padStart(2, "0")}</span>{tile.glyph && <strong>{tile.glyph}</strong>}<small>{tile.label}</small></button>)}<p className="editorial-wordmark" aria-hidden="true">B‑tex</p><div className="editorial-claim"><p className="editorial-kicker">JOB DECISION WORKBENCH</p><h1 id="editorial-title">让每一次职位判断，<br />都落到清晰的下一步。</h1><p>把职位、客户、项目事实与个人工作节奏放在同一张判断面上。</p><a className="editorial-link" href="/">进入职位决策台 <ChevronRight /></a></div></section>
    <section className="editorial-section editorial-about" id="about"><p className="section-index">01 / WHAT IT DOES</p><div className="about-layout"><h2>先判断事实，<br /><em>再安排注意力。</em></h2><p className="about-copy">B‑tex 不把所有职位塞进一个排行榜。它先收口关闭、入职、HC 与归属事实，再把真正值得推进、需要核验和暂不推荐的机会放进不同工作区。</p><article><span>事实优先</span><p>UNKNOWN 不会被写成 0；没有加入项目，就不会伪装成可直接承接。</p></article><article><span>行动优先</span><p>分数只作为判断线索，职位行首先告诉你：现在具体该做什么。</p></article></div></section>
    <section className="editorial-section editorial-principle" id="logic"><p className="section-index">02 / THE LOGIC</p><div><h2>从一条信号，<br />到一次<span>可解释的行动。</span></h2><p>不用在表格、项目和历史记录间来回寻找。每个职位都有一张当下判断，也保留那一刻的快照。</p></div><div className="logic-steps"><article><b>01</b><i>↙</i><h3>先排除硬条件</h3><p>关闭、已入职、HC 为 0 与重复项目不进入正式推荐。</p></article><article><b>02</b><i>↗</i><h3>再组织可信机会</h3><p>推进、探索、个人适配和判断可靠度都能回到事实与证据。</p></article><article><b>03</b><i>→</i><h3>只给允许的下一步</h3><p>验证、关注、接单或完成，由服务端规则决定，不由前端猜测。</p></article></div></section>
    <section className="editorial-section editorial-demo" id="demo"><div className="demo-heading"><p className="section-index">03 / IN ONE PLACE</p><h2>不必先记住。<br /><em>先看下一步。</em></h2></div><div className="demo-surface"><aside><b>∞</b><span className="active">今天</span><span>职位</span><span>客户</span><span>预警</span><span>规则</span></aside><div className="demo-center"><div className="demo-bar"><span>今日职位判断</span><small><i />快照已同步</small></div><div className="demo-title"><p>今天先做这 3 个职位</p><span>9 个有效机会 · 3 个待核验</span></div><div className="demo-tasks">{focusCopy.today.tasks.map(task => <div key={task[0]}><b>{task[0]}</b><span>{task[1]}</span><em>{task[2]}</em><ChevronRight /></div>)}</div></div><aside className="demo-side"><p>和 B‑tex 对话</p><strong>“把今天值得推进的职位，按事实完整度与下一步排出来。”</strong><span>已过滤关闭、入职与重复项目，并保留需要确认的机会。</span><div>{(["today", "signal", "rules"] as Focus[]).map(item => <button type="button" key={item} onClick={() => setFocus(item)}>{focusCopy[item].index.split(" / ")[1]}</button>)}</div></aside></div></section>
    <section className="editorial-section editorial-roadmap" id="scope"><p className="section-index">04 / BUILD WITH TRUST</p><h2>当前能做什么，<br /><em>就清楚展示什么。</em></h2><div><article><b>01</b><h3>今天的判断</h3><p>按方向组织正式 Top 3、需要确认和排除机会。</p></article><article><b>02</b><h3>承接与回放</h3><p>演示关注、接单、结果记录与冻结的历史判断。</p></article><article><b>03</b><h3>统一前端表面</h3><p>为后端同步、权限、通知与轨迹预留可替换的数据适配层。</p></article></div><p className="roadmap-note">这是前端可演示版本：交互与本地状态可用，真实接口、飞书授权和推送由后端后续接入。</p></section>
    <section className="editorial-outro"><p className="section-index">B‑TEX / FACTS BECOME ACTION</p><h2>下一次判断，<br /><em>从这里开始。</em></h2><a href="/">进入职位决策台 <ArrowUpRight /></a><footer><span>B‑tex</span><span>职位决策叙事版</span><span>为清晰的下一步而建</span></footer></section>
    {current && <div className="editorial-preview" role="dialog" aria-modal="true" aria-labelledby="preview-title"><button className="preview-scrim" type="button" aria-label="关闭预览" onClick={() => setFocus(null)} /><section><button className="preview-close" type="button" onClick={() => setFocus(null)}>返回拼贴 <X /></button><p>{current.index}</p><h2 id="preview-title">{current.title}</h2><span>{current.text}</span><div>{current.tasks.map(task => <article key={task[0]}><b>{task[0]}</b><strong>{task[1]}</strong><em>{task[2]}</em><Check /></article>)}</div></section></div>}
    {menuOpen && <aside className="editorial-menu-overlay" id="editorial-menu" aria-label="叙事展示页菜单"><button type="button" onClick={closeMenu}>关闭 <X /></button><nav><a onClick={closeMenu} href="#about">介绍</a><a onClick={closeMenu} href="#logic">判断逻辑</a><a onClick={closeMenu} href="#demo">工作台</a><a onClick={closeMenu} href="#scope">范围</a></nav><a href="/">进入 B‑tex 工作台 <ChevronRight /></a></aside>}
  </main>;
}
