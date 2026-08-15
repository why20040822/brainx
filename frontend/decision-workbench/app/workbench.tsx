"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowLeft, BarChart3, Bell, BriefcaseBusiness,
  Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Database, Filter, GitCompareArrows,
  Infinity, LayoutDashboard, ListFilter, MoreHorizontal, Plus, RotateCcw, Search, Settings2,
  BellRing, CircleUserRound, ClipboardCheck, PanelLeftClose, PanelLeftOpen, Send, ShieldCheck, SlidersHorizontal, Sparkles, Users, X, Zap,
} from "lucide-react";
import { actionLabel, seedAuth, seedNotifications, seedSync, stateLabel, type AuthStatus, type DecisionEvent, type EngagementCommand, type EngagementState, type Notification, type Outcome, type SyncStatus } from "./decision-demo";

type Page = "today"|"jobs"|"clients"|"alerts"|"rules"|"sources";
type Status = "新发布"|"升温"|"活跃"|"拥挤"|"降温"|"疑似失活"|"已关闭";
type Job = {id:number;name:string;client:string;industry:string;city:string;pm:string;status:Status;score:number;hc:number;feedback:string;recommended:number;interview:number;offer:number;reason:string;salary:string};
type DecisionGroup = "RESULT_CLOSURE"|"ACTIVE_ADVANCEMENT"|"NEW_VALIDATION"|"MAINTENANCE"|"EXCLUDE";
type Eligibility = "ELIGIBLE"|"VERIFY_REQUIRED"|"BLOCKED"|"EXCLUDED";
type DecisionDirection = "paid"|"growth"|"marketing";
type SourceMode = "COCKPIT_CONTEXT"|"MARKET_ONLY";
type DecisionAction = {id:string;label:string;kind:"verify"|"advance"|"watch"|"skip";detail:string};
type DecisionJob = {
 id:string; rank:number; company:string; role:string; direction:DecisionDirection; sourceMode:SourceMode; group:DecisionGroup; eligibility:Eligibility;
 globalScore:number; explorationScore:number; personalScore:number; finalScore:number; evidenceCoverage:number|null;
 recommendation:string; recentSignal:string; facts:Record<string,string>; scoreNotes:string[];
 risks:string[]; evidence:string[]; actions:DecisionAction[];
};
type Panel = {kind:"job";jobId:string;tab:"judgement"|"engagement"|"trail"|"replay"}|{kind:"sync"}|{kind:"identity"}|{kind:"notifications"}|{kind:"commitments"}|null;
type DirectSegmentOption<T extends string> = {value:T;label:React.ReactNode;ariaLabel?:string};

const decisionGroupMeta: Record<DecisionGroup,{title:string;subtitle:string}> = {
 RESULT_CLOSURE:{title:"结果收口",subtitle:"别丢单，先把当前结果确认下来"},
 ACTIVE_ADVANCEMENT:{title:"高动能推进",subtitle:"现在有真实动能，优先顺势推进"},
 NEW_VALIDATION:{title:"新机会验证",subtitle:"值得看，但先验证关键事实"},
 MAINTENANCE:{title:"维护观察",subtitle:"项目仍有效，暂不抢占今天注意力"},
 EXCLUDE:{title:"暂不推荐",subtitle:"硬条件不符合，不进入正式推荐"},
};
type DecisionSeed = {id:string;direction:DecisionDirection;rank:number;company:string;role:string;relation:string;sourceMode:SourceMode;stage:string;remainingHc:number;pipeline:string;process:number;exploration:number;personal:number;final:number;group:DecisionGroup;reasons:string[];risks:string[];nextAction:string;evidence:string[]};
const decisionSeeds:DecisionSeed[]=[
 {id:"JU87P01",direction:"paid",rank:1,company:"39-AI",role:"资深海外投放经理",relation:"我的职位",sourceMode:"COCKPIT_CONTEXT",stage:"INTERVIEW",remainingHc:1,pipeline:"推荐 22 · 面试 2 · 寻访 1",process:82,exploration:76,personal:81,final:80,group:"ACTIVE_ADVANCEMENT",reasons:["已进入面试阶段，项目具有真实推进动能。","驾驶舱已有 20 名推荐样本和 2 名面试样本。","HC 1，当前入职 0，剩余 HC 1。"],risks:["客户最新反馈和下一轮推荐动作仍需回写。"],nextAction:"按驾驶舱下一动作推进，并在 72 小时内回写信号",evidence:["驾驶舱项目快照","Pipeline 阶段记录","HC 占用判断"]},
 {id:"J3NBVPJ",direction:"paid",rank:2,company:"上海蝴蝶梦境科技有限公司",role:"资深广告优化师",relation:"未加入",sourceMode:"MARKET_ONLY",stage:"INTERVIEW",remainingHc:1,pipeline:"推荐 3 · 面试 3",process:78,exploration:95,personal:64,final:80,group:"NEW_VALIDATION",reasons:["市场职位处于面试阶段，且仍有明确 HC。","探索价值高，但尚未匹配到驾驶舱 project_id。"],risks:["项目负责人和当前 HC 需要在承接前再次确认。"],nextAction:"确认负责人和 HC，再做 72 小时低成本验证",evidence:["职位市场快照","市场 Pipeline","HC 字段"]},
 {id:"JPG4HAS",direction:"paid",rank:3,company:"Aha.AI",role:"B2B 投放专员",relation:"我的职位",sourceMode:"MARKET_ONLY",stage:"INTERVIEW",remainingHc:1,pipeline:"推荐 2 · 面试 1",process:75,exploration:95,personal:71,final:79,group:"ACTIVE_ADVANCEMENT",reasons:["职位市场显示已有面试推进，方向匹配度高。","当前快照未找到可确认的驾驶舱 project_id。"],risks:["不能把公司名相似当作驾驶舱关联证据。"],nextAction:"核验项目归属和 HC，再决定投入寻访",evidence:["职位市场快照","市场 Pipeline","顾问关系"]},
 {id:"JNDLIXO",direction:"growth",rank:1,company:"北京雨林时代科技有限公司",role:"海外增长负责人",relation:"我的职位",sourceMode:"MARKET_ONLY",stage:"INTERVIEW",remainingHc:2,pipeline:"推荐 3 · 面试 10",process:85,exploration:95,personal:71,final:85,group:"ACTIVE_ADVANCEMENT",reasons:["10 名面试样本证明需求处于真实推进阶段。","总 HC 2，当前仍有 2 个机会空间。"],risks:["未匹配驾驶舱上下文，需确认竞争与项目负责人。"],nextAction:"确认负责人和 HC，再做 72 小时低成本验证",evidence:["职位市场快照","市场 Pipeline","HC 字段"]},
 {id:"JPZ5RC5",direction:"growth",rank:2,company:"CurioSea",role:"GTM Leader / 全球增长负责人",relation:"未加入",sourceMode:"MARKET_ONLY",stage:"INTERVIEW",remainingHc:1,pipeline:"推荐 10 · 面试 14 · 寻访 1",process:83,exploration:95,personal:64,final:83,group:"NEW_VALIDATION",reasons:["市场 Pipeline 活跃，面试与推荐样本充分。","方向吻合，但顾问尚未加入项目。"],risks:["未加入项目，不能直接出现接单动作。"],nextAction:"确认项目归属与可承接状态，再决定是否加入",evidence:["职位市场快照","市场 Pipeline","项目关系字段"]},
 {id:"JVS2PHH",direction:"growth",rank:3,company:"科漫智能",role:"海外增长运营负责人 / 经理",relation:"我的职位",sourceMode:"COCKPIT_CONTEXT",stage:"INTERVIEW",remainingHc:1,pipeline:"推荐 28 · 面试 7 · 寻访 3",process:85,exploration:75,personal:81,final:82,group:"ACTIVE_ADVANCEMENT",reasons:["驾驶舱已记录岗位拆解、30 人联系池和首轮验证。","项目处于面试阶段，HC 仍开放。"],risks:["客户优先级、联系回复和硬条件尚需进一步确认。"],nextAction:"按驾驶舱下一动作推进，并在 72 小时内回写信号",evidence:["驾驶舱项目快照","岗位拆解记录","Pipeline 阶段记录"]},
 {id:"J90P3H0",direction:"marketing",rank:1,company:"中科酷原",role:"市场总监 / 经理",relation:"未加入",sourceMode:"MARKET_ONLY",stage:"INTERVIEW",remainingHc:5,pipeline:"推荐 1 · 面试 9",process:87,exploration:95,personal:64,final:86,group:"NEW_VALIDATION",reasons:["存在 5 个剩余 HC，机会空间明确。","已有 9 名面试样本，项目需求处于活跃状态。"],risks:["尚未加入项目，需确认项目负责人和承接规则。"],nextAction:"确认负责人和 HC，再做 72 小时低成本验证",evidence:["职位市场快照","市场 Pipeline","HC 字段"]},
 {id:"JBWXJ7W",direction:"marketing",rank:2,company:"深势科技",role:"Marketing Head（科研产品）",relation:"未加入",sourceMode:"MARKET_ONLY",stage:"INTERVIEW",remainingHc:1,pipeline:"推荐 3 · 面试 3",process:78,exploration:95,personal:64,final:80,group:"NEW_VALIDATION",reasons:["方向吻合，市场 Pipeline 已有真实推进。","剩余 HC 1，仍有机会空间。"],risks:["项目未加入，驾驶舱上下文不可用。"],nextAction:"确认项目归属、客户优先级和当前 HC",evidence:["职位市场快照","市场 Pipeline","HC 字段"]},
 {id:"JU2GCAC",direction:"marketing",rank:3,company:"天瞳威视",role:"市场与媒体公关总监",relation:"未加入",sourceMode:"MARKET_ONLY",stage:"INTERVIEW",remainingHc:1,pipeline:"推荐 12 · 面试 9 · 寻访 7",process:84,exploration:76,personal:64,final:79,group:"ACTIVE_ADVANCEMENT",reasons:["项目 Pipeline 充分，已有推荐和面试推进。","HC 1，当前仍有可验证机会。"],risks:["市场竞争可能偏高，且缺少驾驶舱项目上下文。"],nextAction:"核验竞争强度和项目归属后，再决定投入级别",evidence:["职位市场快照","市场 Pipeline","HC 字段"]},
];
const decisionJobs:DecisionJob[]=decisionSeeds.map(seed=>({id:seed.id,rank:seed.rank,company:seed.company,role:seed.role,direction:seed.direction,sourceMode:seed.sourceMode,group:seed.group,eligibility:"ELIGIBLE",globalScore:seed.process,explorationScore:seed.exploration,personalScore:seed.personal,finalScore:seed.final,evidenceCoverage:null,recommendation:seed.nextAction,recentSignal:`${seed.stage} · 剩余 HC ${seed.remainingHc}`,facts:{"职位关系":seed.relation,"数据来源":seed.sourceMode==="COCKPIT_CONTEXT"?"驾驶舱上下文":"职位市场","当前阶段":seed.stage,"剩余 HC":String(seed.remainingHc),"Offer 状态":"0","入职状态":"0","历史 Pipeline":seed.pipeline},scoreNotes:seed.reasons,risks:seed.risks,evidence:seed.evidence,actions:seed.relation==="未加入"?[{id:"verify",label:"确认项目归属",kind:"verify",detail:"先确认负责人和承接状态"}]:[{id:"advance",label:"进入项目推进",kind:"advance",detail:seed.nextAction},{id:"watch",label:"加入观察",kind:"watch",detail:"保留本周提醒"}]}));
const verificationJobs:DecisionJob[]=[
 ["JS6ZVBW","Nooklab","DTC负责人","Offer 1 覆盖剩余 HC 1，入职未确认"],
 ["JFL41BC","SigmaZ","平台增长负责人","Offer 1 覆盖剩余 HC 1，入职未确认"],
 ["JH1ORT9","refly.ai","增长运营 / KOL / 投放","Offer 2 覆盖剩余 HC 2，入职未确认"],
].map(([id,company,role,note],index)=>({id,rank:index+1,company,role,direction:index===0?"growth":index===1?"growth":"paid",sourceMode:"MARKET_ONLY",group:"RESULT_CLOSURE",eligibility:"VERIFY_REQUIRED",globalScore:0,explorationScore:0,personalScore:0,finalScore:0,evidenceCoverage:null,recommendation:"核验 Offer 与入职状态",recentSignal:note,facts:{"职位关系":"待确认","数据来源":"职位市场","当前阶段":"OFFER","剩余 HC":"UNKNOWN","Offer 状态":"已发出","入职状态":"UNKNOWN","历史 Pipeline":"待核验"},scoreNotes:["Offer 已覆盖当前 HC，但入职结果未知。"],risks:[note],evidence:["职位市场快照","Offer 状态字段","入职状态缺失"],actions:[{id:"verify",label:"去确认状态",kind:"verify",detail:"确认 Offer、入职和剩余 HC"}]} as DecisionJob));

const jobs: Job[] = [
 {id:1,name:"AI 广告销售负责人",client:"星河科技",industry:"人工智能",city:"上海",pm:"林书言",status:"升温",score:92,hc:3,feedback:"2小时前",recommended:8,interview:3,offer:0,reason:"48小时反馈提速，HC由2增至3",salary:"70–100K"},
 {id:2,name:"海外增长负责人",client:"纬度引擎",industry:"跨境电商",city:"深圳",pm:"周既明",status:"拥挤",score:78,hc:2,feedback:"5小时前",recommended:14,interview:5,offer:1,reason:"已有5人面试，竞争进入高位",salary:"60–85K"},
 {id:3,name:"商业化增长经理",client:"棱镜互动",industry:"营销科技",city:"北京",pm:"许嘉禾",status:"降温",score:63,hc:1,feedback:"3天前",recommended:9,interview:1,offer:0,reason:"反馈放缓且预算低于市场中位数",salary:"35–45K"},
 {id:4,name:"AI 产品运营负责人",client:"澄明智能",industry:"人工智能",city:"杭州",pm:"沈青",status:"活跃",score:86,hc:2,feedback:"8小时前",recommended:6,interview:2,offer:0,reason:"客户连续两轮在24小时内反馈",salary:"50–75K"},
 {id:5,name:"Creator Partnership 负责人",client:"远屿网络",industry:"内容平台",city:"上海",pm:"陆弦",status:"新发布",score:82,hc:4,feedback:"1天前",recommended:3,interview:0,offer:0,reason:"新发布且4个HC，需求画像已确认",salary:"45–65K"},
 {id:6,name:"海外渠道销售",client:"云帆智能",industry:"企业服务",city:"深圳",pm:"林书言",status:"疑似失活",score:41,hc:2,feedback:"7天前",recommended:11,interview:1,offer:0,reason:"连续7天无反馈，剩余HC未确认",salary:"40–60K"},
 {id:7,name:"用户增长负责人",client:"拾光生活",industry:"消费科技",city:"北京",pm:"周既明",status:"升温",score:88,hc:2,feedback:"4小时前",recommended:7,interview:3,offer:1,reason:"新增Offer且反馈时间缩短至12小时",salary:"55–80K"},
 {id:8,name:"增长策略负责人",client:"矩阵工场",industry:"SaaS",city:"杭州",pm:"沈青",status:"活跃",score:80,hc:1,feedback:"20小时前",recommended:5,interview:2,offer:0,reason:"面试转化稳定，业务负责人持续参与",salary:"50–70K"},
 {id:9,name:"AI 解决方案销售",client:"澄明智能",industry:"人工智能",city:"北京",pm:"许嘉禾",status:"拥挤",score:72,hc:3,feedback:"9小时前",recommended:18,interview:6,offer:1,reason:"参与顾问增至6人，推荐密度过高",salary:"45–70K"},
 {id:10,name:"国际化产品增长",client:"远屿网络",industry:"内容平台",city:"上海",pm:"陆弦",status:"已关闭",score:0,hc:0,feedback:"2天前",recommended:12,interview:4,offer:1,reason:"客户确认HC已全部关闭",salary:"45–65K"},
];
const allJobs = Array.from({length:24},(_,i)=> jobs[i%jobs.length]);
const clients = [
 {name:"星河科技",industry:"人工智能",state:"招聘窗口期",active:4,hc:9,feedback:"18h",r2i:"38%",i2o:"24%",hires:12,intent:"强",score:94,risk:"面试标准抬高"},
 {name:"澄明智能",industry:"人工智能",state:"稳定合作",active:3,hc:7,feedback:"22h",r2i:"34%",i2o:"19%",hires:8,intent:"强",score:89,risk:"顾问竞争增加"},
 {name:"远屿网络",industry:"内容平台",state:"招聘窗口期",active:4,hc:8,feedback:"30h",r2i:"28%",i2o:"17%",hires:6,intent:"较强",score:85,risk:"海外画像不稳定"},
 {name:"拾光生活",industry:"消费科技",state:"稳定合作",active:2,hc:4,feedback:"16h",r2i:"41%",i2o:"25%",hires:9,intent:"强",score:88,risk:"薪资空间有限"},
 {name:"纬度引擎",industry:"跨境电商",state:"反馈降温",active:3,hc:5,feedback:"54h",r2i:"31%",i2o:"15%",hires:5,intent:"中",score:71,risk:"面试拥挤"},
 {name:"棱镜互动",industry:"营销科技",state:"需求不明确",active:2,hc:2,feedback:"72h",r2i:"19%",i2o:"8%",hires:3,intent:"弱",score:56,risk:"预算低于市场"},
 {name:"矩阵工场",industry:"SaaS",state:"稳定合作",active:2,hc:3,feedback:"28h",r2i:"30%",i2o:"18%",hires:7,intent:"较强",score:81,risk:"决策链较长"},
 {name:"云帆智能",industry:"企业服务",state:"高风险",active:1,hc:2,feedback:"168h",r2i:"14%",i2o:"0%",hires:1,intent:"弱",score:39,risk:"7天无反馈"},
];
const actionSeed = [
 ["紧急","AI 广告销售负责人","优先推进，今天补充2名高匹配人选","HC增至3且反馈速度提升","预计缩短5天交付周期"],
 ["关注","海外增长负责人","暂停泛化寻访，提高推荐门槛","已有5人进入面试","减少约8小时无效投入"],
 ["机会","星河科技","将两名顾问调配至重点职位","过去48小时反馈明显加快","本周面试 +3"],
 ["紧急","云帆智能","向PM确认需求是否仍然有效","连续7天没有反馈","避免继续无效投入"],
 ["关注","商业化增长经理","重新确认薪资预算","预算低于市场中位数约18%","提升推荐转化"],
 ["机会","AI 产品运营负责人","扩展头部AI应用公司名单","反馈稳定且仍有2个HC","本周推荐 +4"],
];
const events = [
 ["14:20","职位升温","AI 广告销售负责人 · HC 2 → 3"],
 ["12:45","客户反馈","星河科技反馈2份简历，均进入初面"],
 ["11:10","Offer 产生","用户增长负责人产生1个Offer"],
 ["09:35","反馈异常","云帆智能已连续7天未反馈"],
 ["昨天","职位关闭","国际化产品增长 · HC已全部关闭"],
];
const statusOrder:Status[]=["新发布","升温","活跃","拥挤","降温","疑似失活","已关闭"];
const nav = [
 ["today","今日决策",LayoutDashboard],["jobs","职位雷达",Activity],["clients","客户洞察",Users],
 ["alerts","动态预警",Bell],["rules","决策规则",SlidersHorizontal],["sources","数据源",Database],
] as const;
const sourceNames=["内部项目驾驶舱","职位库","客户管理记录","飞书文档","飞书消息","邮件反馈","历史交付记录"];
type SavedWorkbenchState = Partial<{done:number[];snoozed:number[];extraTasks:string[];weights:number[];decisionActions:string[];sidebarWidth:number;engagement:Record<string,EngagementState>;events:Record<string,DecisionEvent[]>;outcomes:Record<string,Outcome[]>;sync:SyncStatus;auth:AuthStatus;notifications:Notification[]}>;
type SidebarResize = {startX:number;startWidth:number;opensCollapsed:boolean};
const SIDEBAR_MIN_WIDTH=252;
const SIDEBAR_MAX_WIDTH=336;
const SIDEBAR_COLLAPSE_DISTANCE=36;
const SIDEBAR_EXPAND_DISTANCE=12;
function readSavedWorkbenchState():SavedWorkbenchState{if(typeof document==="undefined")return {};try{return JSON.parse(localStorage.getItem("decision-workbench")||"{}")}catch{return {}}}
const initialEngagement:Record<string,EngagementState>={"JU87P01":"WATCHED","JVS2PHH":"ACCEPTED","JPG4HAS":"VIEWED"};
const initialEvents:Record<string,DecisionEvent[]>={"JU87P01":[{id:"evt-1",type:"已关注",at:"08-11 11:31"}],"JVS2PHH":[{id:"evt-2",type:"已接单",at:"08-11 16:20"}]};
const initialOutcomes:Record<string,Outcome[]>={"JVS2PHH":[{id:"out-1",stage:"面试",rating:4,note:"已完成首轮供给验证",at:"08-11 10:18"}]};
function legalActions(job:DecisionJob,state:EngagementState):EngagementCommand[]{if(job.facts["职位关系"]==="未加入"||job.eligibility!=="ELIGIBLE")return [];if(state==="WATCHED")return ["UNWATCH","ACCEPT","DISMISS"];if(state==="ACCEPTED")return ["RELEASE","COMPLETE"];if(state==="VIEWED"||state==="RECOMMENDED"||state==="NEW")return ["WATCH","DISMISS"];return []}
function stateEvent(command:EngagementCommand){return ({WATCH:"已关注",UNWATCH:"已取消关注",ACCEPT:"已接单",DISMISS:"暂不考虑",RELEASE:"已释放",COMPLETE:"已完成"})[command]}
function nextState(command:EngagementCommand):EngagementState{return ({WATCH:"WATCHED",UNWATCH:"VIEWED",ACCEPT:"ACCEPTED",DISMISS:"DISMISSED",RELEASE:"RELEASED",COMPLETE:"COMPLETED"} as const)[command]}

export default function DecisionWorkbench(){
 const [hydrated,setHydrated]=useState(false);
 const [page,setPage]=useState<Page>("today");
 const [navOpen,setNavOpen]=useState(true);
 const [sidebarWidth,setSidebarWidth]=useState(280);
 const [sidebarResize,setSidebarResize]=useState<SidebarResize|null>(null);
 const [query,setQuery]=useState("");
 const [status,setStatus]=useState("全部状态");
 const [sort,setSort]=useState("score");
 const [view,setView]=useState<"list"|"rail">("list");
 const [selected,setSelected]=useState<number[]>([]);
 const [detail,setDetail]=useState<Job|null>(null);
 const [clientDetail,setClientDetail]=useState<typeof clients[number]|null>(null);
 const [drawer,setDrawer]=useState<string|null>(null);
 const [toast,setToast]=useState("");
 const [done,setDone]=useState<number[]>([]);
 const [snoozed,setSnoozed]=useState<number[]>([]);
 const [extraTasks,setExtraTasks]=useState<string[]>([]);
 const [weights,setWeights]=useState([60,25,15]);
 const [eventType,setEventType]=useState("客户反馈");
 const [hc,setHc]=useState(3);
 const [panel,setPanel]=useState<Panel>(null);
 const [decisionActions,setDecisionActions]=useState<string[]>([]);
 const [engagement,setEngagement]=useState<Record<string,EngagementState>>(initialEngagement);
 const [decisionEvents,setDecisionEvents]=useState<Record<string,DecisionEvent[]>>(initialEvents);
 const [outcomes,setOutcomes]=useState<Record<string,Outcome[]>>(initialOutcomes);
 const [sync,setSync]=useState<SyncStatus>(seedSync);
 const [auth,setAuth]=useState<AuthStatus>(seedAuth);
 const [notifications,setNotifications]=useState<Notification[]>(seedNotifications);
 const [mobileNavOpen,setMobileNavOpen]=useState(false);
 const [mobileDrawerProgress,setMobileDrawerProgress]=useState<number|null>(null);
 const mobileDrawerDrag=useRef<{pointerId:number;startX:number;startProgress:number;drawerWidth:number;lastX:number;lastAt:number;velocity:number;progress:number;moved:boolean}|null>(null);
 const mobileDrawerCloseTimer=useRef<number|null>(null);
 const [pendingCommand,setPendingCommand]=useState<{job:DecisionJob;command:EngagementCommand}|null>(null);
 const [maintenanceOpen,setMaintenanceOpen]=useState(false);
 useEffect(()=>{const savedState=readSavedWorkbenchState();setDone(savedState.done||[]);setSnoozed(savedState.snoozed||[]);setExtraTasks(savedState.extraTasks||[]);setWeights(savedState.weights?.length===3?savedState.weights:[60,25,15]);setDecisionActions(savedState.decisionActions||[]);setSidebarWidth(savedState.sidebarWidth||280);setEngagement({...initialEngagement,...(savedState.engagement||{})});setDecisionEvents({...initialEvents,...(savedState.events||{})});setOutcomes({...initialOutcomes,...(savedState.outcomes||{})});setSync(savedState.sync||seedSync);setAuth(savedState.auth||seedAuth);setNotifications(savedState.notifications||seedNotifications);setHydrated(true)},[]);
 useEffect(()=>{if(!hydrated)return;localStorage.setItem("decision-workbench",JSON.stringify({done,snoozed,extraTasks,weights,decisionActions,sidebarWidth,engagement,events:decisionEvents,outcomes,sync,auth,notifications}))},[hydrated,done,snoozed,extraTasks,weights,decisionActions,sidebarWidth,engagement,decisionEvents,outcomes,sync,auth,notifications]);
 useEffect(()=>{const closeOnEscape=(event:KeyboardEvent)=>{if(event.key!=="Escape")return;setPanel(null);setPendingCommand(null);setDrawer(null);setDetail(null);setClientDetail(null);setMobileNavOpen(false)};window.addEventListener("keydown",closeOnEscape);return()=>window.removeEventListener("keydown",closeOnEscape)},[]);
useEffect(()=>{if(!sidebarResize)return;const delta=(event:PointerEvent)=>event.clientX-sidebarResize.startX;const rawWidth=(event:PointerEvent)=>sidebarResize.startWidth+delta(event);const move=(event:PointerEvent)=>{if(sidebarResize.opensCollapsed){if(delta(event)<SIDEBAR_EXPAND_DISTANCE)return;setNavOpen(true);setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH,Math.max(SIDEBAR_MIN_WIDTH,SIDEBAR_MIN_WIDTH+delta(event)-SIDEBAR_EXPAND_DISTANCE)));return}setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH,Math.max(SIDEBAR_MIN_WIDTH,rawWidth(event))))};const stop=(event:PointerEvent)=>{if(sidebarResize.opensCollapsed){if(event.type==="pointerup"&&delta(event)>=SIDEBAR_EXPAND_DISTANCE)setNavOpen(true);setSidebarResize(null);return}if(event.type==="pointerup"&&rawWidth(event)<SIDEBAR_MIN_WIDTH-SIDEBAR_COLLAPSE_DISTANCE)setNavOpen(false);setSidebarResize(null)};window.addEventListener("pointermove",move);window.addEventListener("pointerup",stop);window.addEventListener("pointercancel",stop);return()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",stop);window.removeEventListener("pointercancel",stop)}},[sidebarResize]);
 const notify=(s:string)=>{setToast(s);setTimeout(()=>setToast(""),2200)};
 const filteredJobs=useMemo(()=>jobs.filter(j=>(status==="全部状态"||j.status===status)&&(`${j.name}${j.client}${j.city}`.includes(query))).sort((a,b)=>sort==="score"?b.score-a.score:b.hc-a.hc),[query,status,sort]);
 const visibleActions=actionSeed.map((a,i)=>({a,i})).filter(x=>!done.includes(x.i)&&!snoozed.includes(x.i));
 const go=(p:Page)=>{setPage(p);setDetail(null);setClientDetail(null);setPanel(null);setDrawer(null);setMobileNavOpen(false)};
 const runDecisionAction=(job:DecisionJob,action:DecisionAction)=>{setDecisionActions(v=>v.includes(`${job.id}:${action.id}`)?v:[...v,`${job.id}:${action.id}`]);notify(`已记录：${action.label}`)};
 const openDecision=(job:DecisionJob,tab:"judgement"|"engagement"|"trail"|"replay"="judgement")=>setPanel(current=>current?.kind==="job"&&current.jobId===job.id&&current.tab===tab?null:{kind:"job",jobId:job.id,tab});
 const applyCommand=(job:DecisionJob,command:EngagementCommand,reason?:string)=>{const state=nextState(command);setEngagement(current=>({...current,[job.id]:state}));setDecisionEvents(current=>({...current,[job.id]:[{id:`evt-${Date.now()}`,type:stateEvent(command),at:new Date().toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}),reason},...(current[job.id]||[])]}));setPendingCommand(null);notify(`${job.company} · ${stateEvent(command)}`)};
 const requestCommand=(job:DecisionJob,command:EngagementCommand)=>{if(command==="ACCEPT"||command==="DISMISS"){setPendingCommand({job,command});return}applyCommand(job,command)};
 const recordOutcome=(job:DecisionJob,stage:Outcome["stage"],rating?:number,note?:string)=>{const item:Outcome={id:`out-${Date.now()}`,stage,rating,note,at:new Date().toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})};setOutcomes(current=>({...current,[job.id]:[item,...(current[job.id]||[])]}));setDecisionEvents(current=>({...current,[job.id]:[{id:`evt-${Date.now()}`,type:"记录结果",at:item.at,reason:stage},...(current[job.id]||[])]}));notify(`已记录${stage}`)};
 const runSync=()=>{setSync(current=>({...current,state:"RUNNING",errors:[]}));notify("正在生成演示快照…");window.setTimeout(()=>{setSync({...seedSync,updatedAt:new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})});notify("快照已更新，推荐已刷新")},650)};
 const openNotification=(item:Notification)=>{setNotifications(current=>current.map(note=>note.id===item.id?{...note,read:true}:note));if(item.jobId){const job=decisionJobs.find(entry=>entry.id===item.jobId);if(job)openDecision(job,item.kind==="DAILY_TOP3"?"replay":"engagement")}else setPanel({kind:"sync"})};
 const startSidebarResize=(event:React.PointerEvent<HTMLDivElement>)=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);const opensCollapsed=!navOpen;setSidebarResize({startX:event.clientX,startWidth:opensCollapsed?SIDEBAR_MIN_WIDTH:sidebarWidth,opensCollapsed})};
 const resizeFromKeyboard=(event:React.KeyboardEvent<HTMLDivElement>)=>{if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;event.preventDefault();if(!navOpen&&event.key==="ArrowRight"){setSidebarWidth(SIDEBAR_MIN_WIDTH);setNavOpen(true);return}setSidebarWidth(width=>Math.min(SIDEBAR_MAX_WIDTH,Math.max(SIDEBAR_MIN_WIDTH,width+(event.key==="ArrowRight"?16:-16))))};
 const selectedDecisionJob=panel?.kind==="job"?[...decisionJobs,...verificationJobs].find(job=>job.id===panel.jobId)||null:null;
 const commitmentJobs=decisionJobs.filter(job=>["WATCHED","ACCEPTED"].includes(engagement[job.id]||"NEW"));
 const panelOpen=!!panel;
 const clearMobileDrawerCloseTimer=()=>{if(mobileDrawerCloseTimer.current!==null){window.clearTimeout(mobileDrawerCloseTimer.current);mobileDrawerCloseTimer.current=null}};
 const closeMobileDrawer=(animate=true)=>{clearMobileDrawerCloseTimer();if(!animate){setMobileDrawerProgress(null);setMobileNavOpen(false);return}setMobileDrawerProgress(0);mobileDrawerCloseTimer.current=window.setTimeout(()=>{setMobileNavOpen(false);setMobileDrawerProgress(null);mobileDrawerCloseTimer.current=null},230)};
 const toggleMobileDrawer=()=>{if(mobileNavOpen){closeMobileDrawer();return}clearMobileDrawerCloseTimer();setMobileNavOpen(true);setMobileDrawerProgress(0);window.requestAnimationFrame(()=>setMobileDrawerProgress(null))};
 const beginMobileSwipe=(event:React.PointerEvent<HTMLDivElement>)=>{if(typeof window==="undefined"||window.innerWidth>720||event.button!==0||mobileNavOpen)return;if((event.target as Element).closest("button,a,input,select,textarea"))return;if(event.clientX>28)return;clearMobileDrawerCloseTimer();const drawerWidth=Math.min(window.innerWidth*.82,320);mobileDrawerDrag.current={pointerId:event.pointerId,startX:event.clientX,startProgress:0,drawerWidth,lastX:event.clientX,lastAt:event.timeStamp,velocity:0,progress:0,moved:false};if(!mobileNavOpen)setMobileNavOpen(true);setMobileDrawerProgress(0)};
 const moveMobileSwipe=(event:React.PointerEvent<HTMLDivElement>)=>{const drag=mobileDrawerDrag.current;if(!drag||drag.pointerId!==event.pointerId)return;const distance=Math.abs(event.clientX-drag.startX);if(!drag.moved&&distance<8)return;if(!drag.moved){drag.moved=true;event.currentTarget.setPointerCapture(event.pointerId)}const raw=drag.startProgress+(event.clientX-drag.startX)/drag.drawerWidth;const elapsed=event.timeStamp-drag.lastAt;if(elapsed>0)drag.velocity=(event.clientX-drag.lastX)/elapsed;drag.lastX=event.clientX;drag.lastAt=event.timeStamp;drag.progress=raw<0?raw*.24:raw>1?1+(raw-1)*.24:raw;setMobileDrawerProgress(drag.progress)};
 const endMobileSwipe=(event:React.PointerEvent<HTMLDivElement>,cancelled=false)=>{
  const drag=mobileDrawerDrag.current;
  if(!drag||drag.pointerId!==event.pointerId)return;
  if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  const velocityProgress=drag.velocity/drag.drawerWidth;
  const momentum=cancelled?0:Math.max(-.35,Math.min(.35,velocityProgress*140));
  const projected=Math.min(1,Math.max(0,drag.progress+momentum));
  if(projected>=.5){setMobileNavOpen(true);setMobileDrawerProgress(1);window.setTimeout(()=>setMobileDrawerProgress(null),230)}else closeMobileDrawer();
  mobileDrawerDrag.current=null;
 };
 return <div className={`app btex-app ${navOpen?"nav-open":""} ${panelOpen?"decision-panel-open":""} ${sidebarResize?"is-resizing":""} ${mobileNavOpen?"mobile-nav-open":""} ${mobileDrawerDrag.current?"mobile-nav-swiping":""}`} style={{"--sidebar-width":`${navOpen?sidebarWidth:68}px`,"--mobile-drawer-progress":mobileDrawerProgress??1} as React.CSSProperties} onPointerDown={beginMobileSwipe} onPointerMove={moveMobileSwipe} onPointerUp={event=>endMobileSwipe(event)} onPointerCancel={event=>endMobileSwipe(event,true)}>
  <aside className="sidebar btex-nav" aria-label="主要导航">
   <div className="brand"><div className="brand-identity"><div className="brand-mark" aria-label="B-tex"><Infinity aria-hidden="true"/></div><div><b>B-tex</b><small>职位决策台</small></div></div><button className="nav-toggle" onClick={()=>setNavOpen(v=>!v)} aria-label={navOpen?"收起导航":"展开导航"}>{navOpen?<PanelLeftClose/>:<PanelLeftOpen/>}</button></div>
   <button className="mobile-nav-trigger" onClick={toggleMobileDrawer} aria-label={mobileNavOpen?"收起全部模块":"打开全部模块"} aria-expanded={mobileNavOpen}><Infinity aria-hidden="true"/><span>{mobileNavOpen?"收起模块":"全部模块"}</span></button>
   <nav className="nav">{nav.map(([id,label,Icon])=><button key={id} className={page===id?"active":""} onClick={()=>go(id)}><Icon/><span>{label}</span></button>)}</nav>
   <SidebarCommitments jobs={commitmentJobs} engagement={engagement} onOpen={job=>openDecision(job,"engagement")} onExpand={()=>setNavOpen(true)}/>
   <div className="sidebar-foot"><div className="ai-status"><i className="pulse"/><span>快照已同步</span></div><small>Policy v1.2</small></div>
  <div className="sidebar-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={SIDEBAR_MIN_WIDTH} aria-valuemax={SIDEBAR_MAX_WIDTH} aria-valuenow={navOpen?sidebarWidth:68} tabIndex={0} onPointerDown={startSidebarResize} onKeyDown={resizeFromKeyboard}/>
  </aside>
  {mobileNavOpen&&<button className="mobile-nav-backdrop" onClick={()=>closeMobileDrawer()} aria-label="关闭全部模块"/>}
  <main className="main">
   <header className="topbar">
    {page==="today"?<><button className="btex-person identity-trigger" onClick={()=>setPanel({kind:"identity"})}><CircleUserRound/>{auth.consultant}</button><button className={`sync sync-trigger ${auth.needsReauth?"auth_expired":sync.state.toLowerCase()}`} onClick={()=>setPanel(auth.needsReauth?{kind:"identity"}:{kind:"sync"})}><i/> {auth.needsReauth?"飞书授权已过期":sync.state==="READY"?`Snapshot #1842 · ${sync.updatedAt} 已同步`:sync.state==="RUNNING"?"同步中…":sync.state==="INCOMPLETE"?"本次同步不完整":sync.state==="AUTH_EXPIRED"?"飞书授权已过期":sync.state==="ERROR"?"同步失败":"尚未同步"}</button><button className="mobile-commitment-trigger" onClick={()=>setPanel({kind:"commitments"})} aria-label={`我的承接 ${commitmentJobs.length} 个`}><BriefcaseBusiness/><i>{commitmentJobs.length}</i></button><button className="icon-btn notification-trigger" onClick={()=>setPanel({kind:"notifications"})} aria-label="今日提醒"><BellRing/>{notifications.filter(note=>!note.read).length>0&&<i>{notifications.filter(note=>!note.read).length}</i>}</button><button className="top-pill" onClick={()=>setNavOpen(true)}>全部模块 <ChevronRight/></button></>:<><div className="search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索客户、职位、PM…"/></div><button className="top-pill" onClick={()=>notify("全局筛选已展开")}><Filter/> 当前团队 <ChevronRight/></button><span className="sync">更新于 14:32 · 7个来源</span><button className="icon-btn" onClick={()=>setPanel({kind:"notifications"})} aria-label="通知"><Bell/></button></>}
   </header>
   <div className="content">
    {detail?<JobDetail job={detail} onBack={()=>setDetail(null)} weights={weights} eventType={eventType} setEventType={setEventType} hc={hc} setHc={setHc} notify={notify}/>:clientDetail?<ClientDetail c={clientDetail} onBack={()=>setClientDetail(null)} notify={notify}/>:<>
     {page==="today"&&<DecisionToday maintenanceOpen={maintenanceOpen} setMaintenanceOpen={setMaintenanceOpen} completed={decisionActions} jobs={decisionJobs} engagement={engagement} sync={sync} open={openDecision} onRules={()=>go("rules")} onAction={runDecisionAction}/>}
     {page==="jobs"&&<JobsView jobs={filteredJobs} status={status} setStatus={setStatus} sort={sort} setSort={setSort} view={view} setView={setView} selected={selected} setSelected={setSelected} openJob={setDetail} notify={notify}/>}
     {page==="clients"&&<ClientsView clients={clients.filter(c=>`${c.name}${c.industry}`.includes(query))} open={setClientDetail} notify={notify}/>}
     {page==="alerts"&&<Alerts setExtraTasks={setExtraTasks} notify={notify} setDrawer={setDrawer}/>}
     {page==="rules"&&<Rules weights={weights} setWeights={setWeights} notify={notify}/>}
     {page==="sources"&&<Sources notify={notify}/>}
    </>}
   </div>
  </main>
  {panel&&<WorkbenchPanel panel={panel} job={selectedDecisionJob} commitmentJobs={commitmentJobs} auth={auth} sync={sync} notifications={notifications} engagement={engagement} events={decisionEvents} outcomes={outcomes} completed={decisionActions} onClose={()=>setPanel(null)} onOpenJob={openDecision} onAction={runDecisionAction} onCommand={requestCommand} onOutcome={recordOutcome} onSync={runSync} onSetSync={setSync} onAuth={setAuth} onNotification={openNotification} notify={notify}/>}
  {pendingCommand&&<CommandConfirm pending={pendingCommand} onClose={()=>setPendingCommand(null)} onConfirm={(reason?:string)=>applyCommand(pendingCommand.job,pendingCommand.command,reason)}/>}
  {drawer&&<><div className="drawer-backdrop" onClick={()=>setDrawer(null)}/><aside className="drawer"><button className="icon-btn" style={{float:"right"}} onClick={()=>setDrawer(null)}><X/></button><span className="eyebrow">Decision evidence</span><h2>判断依据</h2><div className="conclusion"><div className="spark"><Sparkles/></div><div><b>{drawer}</b><p>综合规则计算与AI结构化推断，置信度 91%</p></div></div><div className="score-bars">{["客户招聘意愿 18/20","职位新鲜度 14/15","HC与紧急程度 15/15","客户反馈速度 14/15","转化表现 16/20","竞争与风险 12/15"].map((x,i)=><div className="mini-item" key={x}><span className="num">0{i+1}</span><div><b>{x}</b><p>{i<4?"规则计算 · 内部项目驾驶舱":"AI推断 · 基于近30天事件"}</p></div></div>)}</div><button className="btn primary" style={{marginTop:18}} onClick={()=>{setDrawer(null);notify("依据已复制到项目备注")}}>复制到项目备注</button></aside></>}
  {toast&&<div className="toast"><Check/> {toast}</div>}
 </div>
}

function SidebarCommitments({jobs,engagement,onOpen,onExpand}:{jobs:DecisionJob[];engagement:Record<string,EngagementState>;onOpen:(job:DecisionJob)=>void;onExpand:()=>void}){
 const accepted=jobs.filter(job=>engagement[job.id]==="ACCEPTED").length;
 const watched=jobs.filter(job=>engagement[job.id]==="WATCHED").length;
 return <section className="sidebar-commitments" aria-label="我的承接"><button className="commitment-rail-toggle" onClick={onExpand} aria-label={`展开我的承接，${jobs.length} 个`}><BriefcaseBusiness/><i>{jobs.length}</i></button><div className="commitment-rail-body"><div className="commitment-rail-head"><span><b>我的承接</b><small>持续工作区</small></span><em>{jobs.length}</em></div><div className="commitment-rail-counts"><span><i className="accepted"/>{accepted} 接单中</span><span><i className="watched"/>{watched} 关注中</span></div>{jobs.length?<div className="commitment-rail-list">{jobs.map(job=><button key={job.id} onClick={()=>onOpen(job)} className={engagement[job.id]==="ACCEPTED"?"accepted":"watched"}><i/><span><b>{job.company}</b><small>{job.role}</small><em>{engagement[job.id]==="ACCEPTED"?"推进或记录结果":"评估是否接单"}</em></span><ChevronRight/></button>)}</div>:<p className="commitment-rail-empty">还没有关注或接单的职位。</p>}</div></section>
}

function Heading({code,title,desc,action}:{code:string,title:React.ReactNode,desc:string,action?:React.ReactNode}){return <div className="headline"><div><span className="eyebrow">{code}</span><h1>{title}</h1><p>{desc}</p></div>{action}</div>}
function StatusTag({s}:{s:string}){const cls=s.includes("关闭")||s.includes("风险")||s.includes("异常")?"red":s==="拥挤"||s==="降温"?"gray":"blue";return <span className={`tag ${cls}`}>{s}</span>}

type FilterSelectOption={value:string;label:string};
function FilterSelect({value,options,onChange,ariaLabel}:{value:string;options:readonly FilterSelectOption[];onChange:(value:string)=>void;ariaLabel:string}){
 const [open,setOpen]=useState(false);
 const root=useRef<HTMLDivElement>(null);
 const selected=options.find(option=>option.value===value)??options[0];
 useEffect(()=>{if(!open)return;const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false)};document.addEventListener("pointerdown",close);document.addEventListener("keydown",onKey);return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",onKey)}},[open]);
 return <div className={`filter-select${open?" is-open":""}`} ref={root}><button type="button" className="field filter-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(value=>!value)} onKeyDown={event=>{if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();setOpen(true)}}}><span>{selected.label}</span><ChevronDown/></button>{open&&<div className="filter-select-menu" role="listbox" aria-label={ariaLabel}>{options.map(option=><button type="button" role="option" aria-selected={option.value===value} className={option.value===value?"selected":""} key={option.value} onClick={()=>{onChange(option.value);setOpen(false)}}>{option.label}</button>)}</div>}</div>
}

function DirectGlassSegment<T extends string>({value,options,onChange,className="",ariaLabel}:{value:T;options:readonly DirectSegmentOption<T>[];onChange:(value:T)=>void;className?:string;ariaLabel:string}){
 const [dragProgress,setDragProgress]=useState<number|null>(null);
 const drag=useRef<{pointerId:number;startX:number;startIndex:number;trackWidth:number;lastX:number;lastAt:number;velocity:number;progress:number;moved:boolean}|null>(null);
 const index=Math.max(0,options.findIndex(option=>option.value===value));
 const progress=dragProgress??index;
 // The active glass must never escape the track.  A rubber-band transform looks
 // playful in isolation, but exposes a detached pane at either edge in a toolbar.
 const rubberBand=(raw:number)=>Math.min(options.length-1,Math.max(0,raw));
 const start=(event:React.PointerEvent<HTMLElement>)=>{if(event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect();drag.current={pointerId:event.pointerId,startX:event.clientX,startIndex:index,trackWidth:Math.max(1,rect.width-8),lastX:event.clientX,lastAt:event.timeStamp,velocity:0,progress:index,moved:false}};
 const move=(event:React.PointerEvent<HTMLElement>)=>{const active=drag.current;if(!active||active.pointerId!==event.pointerId)return;const distance=Math.abs(event.clientX-active.startX);if(!active.moved&&distance<8)return;if(!active.moved){active.moved=true;event.currentTarget.setPointerCapture(event.pointerId)}const raw=active.startIndex+(event.clientX-active.startX)/(active.trackWidth/options.length);const elapsed=event.timeStamp-active.lastAt;if(elapsed>0)active.velocity=(event.clientX-active.lastX)/elapsed;active.lastX=event.clientX;active.lastAt=event.timeStamp;active.progress=rubberBand(raw);setDragProgress(active.progress)};
 const finish=(event:React.PointerEvent<HTMLElement>,cancelled=false)=>{const active=drag.current;if(!active||active.pointerId!==event.pointerId)return;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(!cancelled&&active.moved){const velocityInSteps=active.velocity/(active.trackWidth/options.length);const projected=Math.min(options.length-1,Math.max(0,active.progress+Math.max(-.5,Math.min(.5,velocityInSteps*140))));onChange(options[Math.round(projected)].value)}drag.current=null;setDragProgress(null)};
 return <nav className={`direct-segment ${className}${dragProgress!==null?" is-dragging":""}`} aria-label={ariaLabel} style={{"--direct-index":progress,"--direct-count":options.length} as React.CSSProperties} onPointerDown={start} onPointerMove={move} onPointerUp={event=>finish(event)} onPointerCancel={event=>finish(event,true)}><span className="direct-segment-lens" aria-hidden="true"/>{options.map(option=><button key={option.value} className={value===option.value?"active":""} onClick={()=>onChange(option.value)} aria-label={option.ariaLabel}>{option.label}</button>)}</nav>
}

function DecisionToday({maintenanceOpen,setMaintenanceOpen,completed,jobs,engagement,sync,open,onRules,onAction}:{maintenanceOpen:boolean;setMaintenanceOpen:(value:boolean)=>void;completed:string[];jobs:DecisionJob[];engagement:Record<string,EngagementState>;sync:SyncStatus;open:(job:DecisionJob,tab?:"judgement"|"engagement"|"trail"|"replay")=>void;onRules:()=>void;onAction:(job:DecisionJob,action:DecisionAction)=>void}){
 const [direction,setDirection]=useState<DecisionDirection>("paid");
 const [directionDragProgress,setDirectionDragProgress]=useState<number|null>(null);
 const directionDrag=useRef<{pointerId:number;startX:number;startProgress:number;trackWidth:number;lastX:number;lastAt:number;velocity:number;progress:number;moved:boolean}|null>(null);
 const suppressDirectionClick=useRef(false);
 const directionMeta:Record<DecisionDirection,{label:string;description:string}>={paid:{label:"投放",description:"广告投放与优化"},growth:{label:"增长负责人",description:"增长、GTM 与商业化"},marketing:{label:"市场负责人",description:"市场、品牌与公关"}};
 const directions=Object.keys(directionMeta) as DecisionDirection[];
 const directionIndex=directions.indexOf(direction);
 const lensProgress=directionDragProgress??directionIndex;
 const clampDirectionProgress=(value:number)=>Math.min(directions.length-1,Math.max(0,value));
 const rubberBandDirectionProgress=(value:number)=>value<0?value*.28:value>directions.length-1?directions.length-1+(value-(directions.length-1))*.28:value;
 const beginDirectionDrag=(event:React.PointerEvent<HTMLElement>)=>{if(event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect();const trackWidth=Math.max(1,rect.width-8);directionDrag.current={pointerId:event.pointerId,startX:event.clientX,startProgress:directionIndex,trackWidth,lastX:event.clientX,lastAt:event.timeStamp,velocity:0,progress:directionIndex,moved:false}};
 const moveDirectionDrag=(event:React.PointerEvent<HTMLElement>)=>{const drag=directionDrag.current;if(!drag||drag.pointerId!==event.pointerId)return;const distance=Math.abs(event.clientX-drag.startX);if(!drag.moved&&distance<8)return;if(!drag.moved){drag.moved=true;event.currentTarget.setPointerCapture(event.pointerId)}const step=drag.trackWidth/directions.length;const rawProgress=drag.startProgress+(event.clientX-drag.startX)/step;const elapsed=event.timeStamp-drag.lastAt;if(elapsed>0)drag.velocity=(event.clientX-drag.lastX)/elapsed;drag.lastX=event.clientX;drag.lastAt=event.timeStamp;drag.progress=rubberBandDirectionProgress(rawProgress);setDirectionDragProgress(drag.progress)};
 const finishDirectionDrag=(event:React.PointerEvent<HTMLElement>,cancelled=false)=>{const drag=directionDrag.current;if(!drag||drag.pointerId!==event.pointerId)return;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(!cancelled&&drag.moved){const velocityInSteps=drag.velocity/(drag.trackWidth/directions.length);const projected=clampDirectionProgress(drag.progress+Math.max(-.5,Math.min(.5,velocityInSteps*140)));setDirection(directions[Math.round(projected)]);suppressDirectionClick.current=true;window.setTimeout(()=>{suppressDirectionClick.current=false},0)}directionDrag.current=null;setDirectionDragProgress(null)};
 const visible=jobs.filter(job=>job.direction===direction).sort((a,b)=>a.rank-b.rank).slice(0,3);
 const directionVerification=verificationJobs.filter(job=>job.direction===direction);
 const commitments=jobs.filter(job=>["WATCHED","ACCEPTED"].includes(engagement[job.id]||"NEW"));
 return <div className="decision-home">
  <div className="decision-heading"><div><span className="decision-kicker">今日职位决策</span><h1>今天先做这 3 个职位</h1><p><strong>{jobs.length} 个有效机会</strong><span>·</span><strong className="warn">{verificationJobs.length} 个待核验</strong><span>·</span><strong>{commitments.length} 个承接中</strong></p></div><button className="link decision-link" onClick={onRules}>判断策略 <SlidersHorizontal/></button></div>
  <nav className={`direction-tabs${directionDragProgress!==null?" is-dragging":""}`} aria-label="职位方向" style={{"--direction-index":lensProgress} as React.CSSProperties} onPointerDown={beginDirectionDrag} onPointerMove={moveDirectionDrag} onPointerUp={event=>finishDirectionDrag(event)} onPointerCancel={event=>finishDirectionDrag(event,true)}><span className="direction-glass-lens" aria-hidden="true"/>{directions.map(key=><button data-direction={key} key={key} className={direction===key?"active":""} onClick={event=>{if(suppressDirectionClick.current){event.preventDefault();return}setDirection(key)}}><b>{directionMeta[key].label}</b><small>{directionMeta[key].description}</small></button>)}</nav>
  {sync.state==="INCOMPLETE"||sync.state==="ERROR"?<section className="decision-blocked"><AlertTriangle/><div><b>{sync.state==="INCOMPLETE"?"本次同步不完整":"同步失败"}</b><p>为避免误导，当前不展示新的正式推荐。</p></div><button className="btn" onClick={()=>open(jobs[0],"judgement")}>查看上次快照</button></section>:<section className="decision-lane"><div className="decision-group-head"><div><h2>{directionMeta[direction].label} Top 3</h2><p>Agent 已先处理 HC、关闭、入职和项目重复，再按推进、探索与个人适配排序</p></div><span>Snapshot 08.11</span></div><div className="decision-queue">{visible.map(job=><DecisionRow key={job.id} job={job} completed={completed} engagement={engagement[job.id]||"NEW"} open={open} onAction={onAction}/>)}</div></section>}
  <section className="decision-collapsed verification-pool"><button onClick={()=>setMaintenanceOpen(!maintenanceOpen)}><span><b>需要先确认</b><small>Offer、入职或剩余 HC 不确定，不占用正式 Top 3</small></span><em>{directionVerification.length} 个</em><ChevronRight className={maintenanceOpen?"turned":""}/></button>{maintenanceOpen&&<div className="verification-list">{directionVerification.length?directionVerification.map(job=><VerificationRow key={job.id} job={job} open={open} onAction={onAction}/>):<p>当前方向没有待核验职位。</p>}</div>}</section>
 </div>
}

function VerificationRow({job,open,onAction}:{job:DecisionJob;open:(job:DecisionJob,tab?:"judgement"|"engagement"|"trail"|"replay")=>void;onAction:(job:DecisionJob,action:DecisionAction)=>void}){const action=job.actions[0];return <article className="verification-row"><button className="verification-main" onClick={()=>open(job)}><AlertTriangle/><span><b>{job.company} · {job.role}</b><small>{job.recentSignal}</small></span></button><button className="link" onClick={()=>onAction(job,action)}>{action.label}<ChevronRight/></button></article>}

function DecisionGroupList({group,jobs,completed,engagement,open,onAction}:{group:DecisionGroup;jobs:DecisionJob[];completed:string[];engagement:Record<string,EngagementState>;open:(job:DecisionJob,tab?:"judgement"|"engagement"|"trail"|"replay")=>void;onAction:(job:DecisionJob,action:DecisionAction)=>void}){
 const meta=decisionGroupMeta[group];
 return <section className="decision-group"><div className="decision-group-head"><div><h2>{meta.title}</h2><p>{meta.subtitle}</p></div><span>{jobs.length} 个</span></div>{jobs.map(job=><DecisionRow key={job.id} job={job} completed={completed} engagement={engagement[job.id]||"NEW"} open={open} onAction={onAction}/>)}</section>
}

function DecisionRow({job,completed,engagement,open,onAction}:{job:DecisionJob;completed:string[];engagement:EngagementState;open:(job:DecisionJob,tab?:"judgement"|"engagement"|"trail"|"replay")=>void;onAction:(job:DecisionJob,action:DecisionAction)=>void}){
 const action=job.actions.find(item=>!completed.includes(`${job.id}:${item.id}`))||job.actions[0];
 const actionComplete=completed.includes(`${job.id}:${action.id}`);
 return <article className="decision-row">
  <button className="decision-row-toggle" onClick={()=>open(job)} aria-label={`打开或关闭 ${job.company} 详情`}/>
  <div className="decision-rank">{String(job.rank).padStart(2,"0")}</div>
  <div className="decision-title"><b>{job.company} <span>·</span> {job.role}</b><div className="decision-labels"><em>{decisionGroupMeta[job.group].title}</em><em>{job.facts["职位关系"]}</em><em className={job.sourceMode==="COCKPIT_CONTEXT"?"cockpit":"market"}>{job.sourceMode==="COCKPIT_CONTEXT"?"驾驶舱上下文":"职位市场"}</em><em className="row-state">{stateLabel[engagement]}</em></div><small>{job.recommendation}</small></div>
  <div className="decision-scores"><DecisionMetric label="推进" value={job.globalScore}/><DecisionMetric label="探索" value={job.explorationScore}/><DecisionMetric label="个人" value={job.personalScore}/><DecisionMetric label="最终" value={job.finalScore} emphasis="final"/></div>
  <div className="decision-action"><small>{job.recentSignal}</small><button className={actionComplete?"complete":""} onClick={()=>onAction(job,action)} disabled={actionComplete}>{actionComplete?"已记录":action.label}<ChevronRight/></button></div>
  <span className="row-disclosure" aria-hidden="true"><ChevronRight/></span>
 </article>
}

function DecisionMetric({label,value,emphasis,helpOpen,onHelpToggle}:{label:string;value:string|number;emphasis?:string;helpOpen?:boolean;onHelpToggle?:()=>void}){return <div className="decision-metric"><small>{label}</small>{onHelpToggle&&<button className="metric-help" type="button" onClick={onHelpToggle} aria-label={`解释${label}`} aria-expanded={helpOpen}>!</button>}<b className={emphasis}>{value}</b></div>}

function WorkbenchPanel({panel,job,commitmentJobs,auth,sync,notifications,engagement,events,outcomes,completed,onClose,onOpenJob,onAction,onCommand,onOutcome,onSync,onSetSync,onAuth,onNotification,notify}:{panel:Panel;job:DecisionJob|null;commitmentJobs:DecisionJob[];auth:AuthStatus;sync:SyncStatus;notifications:Notification[];engagement:Record<string,EngagementState>;events:Record<string,DecisionEvent[]>;outcomes:Record<string,Outcome[]>;completed:string[];onClose:()=>void;onOpenJob:(job:DecisionJob,tab?:"judgement"|"engagement"|"trail"|"replay")=>void;onAction:(job:DecisionJob,action:DecisionAction)=>void;onCommand:(job:DecisionJob,command:EngagementCommand)=>void;onOutcome:(job:DecisionJob,stage:Outcome["stage"],rating?:number,note?:string)=>void;onSync:()=>void;onSetSync:(sync:SyncStatus)=>void;onAuth:(auth:AuthStatus)=>void;onNotification:(notification:Notification)=>void;notify:(text:string)=>void}){
 const [dragOffset,setDragOffset]=useState<number|null>(null);
 const panelDrag=useRef<{pointerId:number;startX:number;lastX:number;lastAt:number;velocity:number}|null>(null);
 const startPanelDrag=(event:React.PointerEvent<HTMLDivElement>)=>{
  if(typeof window==="undefined"||window.innerWidth>720||event.button!==0)return;
  panelDrag.current={pointerId:event.pointerId,startX:event.clientX,lastX:event.clientX,lastAt:performance.now(),velocity:0};
  event.currentTarget.setPointerCapture(event.pointerId);
  setDragOffset(0);
 };
 const movePanelDrag=(event:React.PointerEvent<HTMLDivElement>)=>{
  const drag=panelDrag.current;
  if(!drag||drag.pointerId!==event.pointerId)return;
  const now=performance.now();
  const raw=Math.max(0,event.clientX-drag.startX);
  const offset=raw>260?260+(raw-260)*.28:raw;
  drag.velocity=(event.clientX-drag.lastX)/Math.max(1,now-drag.lastAt);
  drag.lastX=event.clientX;drag.lastAt=now;
  setDragOffset(offset);
 };
 const finishPanelDrag=(event:React.PointerEvent<HTMLDivElement>)=>{
  const drag=panelDrag.current;
  if(!drag||drag.pointerId!==event.pointerId)return;
  panelDrag.current=null;
  const distance=Math.max(0,event.clientX-drag.startX);
  const projected=distance+Math.max(0,drag.velocity)*150;
  setDragOffset(null);
  if(projected>window.innerWidth*.3)onClose();
 };
 return <aside className={`decision-drawer workbench-panel${dragOffset!==null?" is-dragging":""}`} style={{"--panel-drag-offset":`${dragOffset??0}px`} as React.CSSProperties} aria-label="工作台详情面板"><div className="drawer-drag-handle" aria-label="向右滑动关闭详情" onPointerDown={startPanelDrag} onPointerMove={movePanelDrag} onPointerUp={finishPanelDrag} onPointerCancel={finishPanelDrag}><i/></div><button className="drawer-close" onClick={onClose} aria-label="关闭详情"><X/></button>{panel?.kind==="job"&&job?<DecisionDrawer job={job} tab={panel.tab} completed={completed} engagement={engagement[job.id]||"NEW"} events={events[job.id]||[]} outcomes={outcomes[job.id]||[]} onTab={tab=>onOpenJob(job,tab)} onAction={onAction} onCommand={onCommand} onOutcome={onOutcome}/>:panel?.kind==="sync"?<SyncPanel sync={sync} onSync={onSync} onSetSync={onSetSync} notify={notify}/>:panel?.kind==="identity"?<IdentityPanel auth={auth} onAuth={onAuth} notify={notify}/>:panel?.kind==="commitments"?<CommitmentsPanel jobs={commitmentJobs} engagement={engagement} onOpen={job=>onOpenJob(job,"engagement")}/>:<NotificationPanel items={notifications} onOpen={onNotification} notify={notify}/>}</aside>
}

function CommitmentsPanel({jobs,engagement,onOpen}:{jobs:DecisionJob[];engagement:Record<string,EngagementState>;onOpen:(job:DecisionJob)=>void}){return <><div className="panel-heading"><BriefcaseBusiness/><div><h1>我的承接</h1><p>关注、接单和需要继续处理的职位</p></div></div><div className="mobile-commitment-list">{jobs.length?jobs.map(job=><button key={job.id} onClick={()=>onOpen(job)}><span><b>{job.company} · {job.role}</b><small>{engagement[job.id]==="ACCEPTED"?"接单中 · 推进交付或记录结果":"关注中 · 评估后接单或取消关注"}</small></span><ChevronRight/></button>):<p>暂无承接职位。</p>}</div></>}

function DecisionDrawer({job,tab,completed,engagement,events,outcomes,onTab,onAction,onCommand,onOutcome}:{job:DecisionJob;tab:"judgement"|"engagement"|"trail"|"replay";completed:string[];engagement:EngagementState;events:DecisionEvent[];outcomes:Outcome[];onTab:(tab:"judgement"|"engagement"|"trail"|"replay")=>void;onAction:(job:DecisionJob,action:DecisionAction)=>void;onCommand:(job:DecisionJob,command:EngagementCommand)=>void;onOutcome:(job:DecisionJob,stage:Outcome["stage"],rating?:number,note?:string)=>void}){
 const tabOptions=["judgement","engagement","trail","replay"] as const;
 const tabLabel={judgement:"判断",engagement:"承接与结果",trail:"决策轨迹",replay:"回放"} as const;
 return <><div className="drawer-title"><h1>{job.company} <span>·</span> {job.role}</h1><span className={`decision-state ${job.eligibility.toLowerCase()}`}>{stateLabel[engagement]} · {decisionGroupMeta[job.group].title}</span></div><DirectGlassSegment value={tab} options={tabOptions.map(value=>({value,label:tabLabel[value]}))} onChange={onTab} className="drawer-tabs" ariaLabel="职位详情视图"/>{tab==="judgement"?<><div className="drawer-metrics"><DecisionMetric label="项目推进" value={job.globalScore}/><DecisionMetric label="探索机会" value={job.explorationScore}/><DecisionMetric label="个人适配" value={job.personalScore}/><DecisionMetric label="最终得分" value={job.finalScore} emphasis="final"/></div><DrawerSection title="当前事实"><dl className="facts">{Object.entries(job.facts).map(([key,value])=><div key={key}><dt>{key}</dt><dd className={value==="UNKNOWN"?"unknown":""}>{value}</dd></div>)}</dl></DrawerSection><DrawerSection title="为什么现在做"><ul className="explanations">{job.scoreNotes.map(note=><li key={note}>{note}</li>)}</ul></DrawerSection>{job.risks.length>0&&<DrawerSection title="风险与缺失"><ul className="explanations risks">{job.risks.map(note=><li key={note}>{note}</li>)}</ul></DrawerSection>}<DrawerSection title="证据来源"><div className="evidence-list">{job.evidence.map(item=><span key={item}>{item}</span>)}</div><p className="snapshot-note">冻结快照 · {job.id} · Policy v1.2</p></DrawerSection><TalentSupplySection job={job}/><DrawerSection title="当前建议"><div className="drawer-actions">{job.actions.map(action=>{const complete=completed.includes(`${job.id}:${action.id}`);return <button key={action.id} className={complete?"completed":""} onClick={()=>onAction(job,action)} disabled={complete}><span><b>{complete?"已记录：":""}{action.label}</b><small>{action.detail}</small></span>{complete?<Check/>:<ChevronRight/>}</button>})}</div></DrawerSection></>:tab==="engagement"?<EngagementPanel job={job} state={engagement} outcomes={outcomes} onCommand={onCommand} onOutcome={onOutcome}/>:tab==="trail"?<DrawerSection title="决策轨迹"><div className="trail-list">{events.length?events.map(event=><div key={event.id}><time>{event.at}</time><b>{event.type}</b><small>{event.reason||"顾问工作台"}</small></div>):<p className="muted">尚无操作记录</p>}</div></DrawerSection>:<ReplayPanel job={job} events={events} outcomes={outcomes}/>}</>
}

function EngagementPanel({job,state,outcomes,onCommand,onOutcome}:{job:DecisionJob;state:EngagementState;outcomes:Outcome[];onCommand:(job:DecisionJob,command:EngagementCommand)=>void;onOutcome:(job:DecisionJob,stage:Outcome["stage"],rating?:number,note?:string)=>void}){const [stage,setStage]=useState<Outcome["stage"]>("推荐采纳");const [rating,setRating]=useState("4");const [note,setNote]=useState("");const actions=legalActions(job,state);const stageOptions:FilterSelectOption[]=["推荐采纳","面试","Offer","入职","关闭","反馈"].map(value=>({value,label:value}));const ratingOptions:FilterSelectOption[]=[{value:"",label:"不打分"},...[1,2,3,4,5].map(value=>({value:String(value),label:`${value} 分`}))];return <><DrawerSection title="承接状态"><div className="engagement-state"><span>{stateLabel[state]}</span><p>{state==="ACCEPTED"?"已进入你的交付列表。请推进或补充结果。":state==="WATCHED"?"已保留关注位；评估完成后可接单。":state==="DISMISSED"?"该职位处于暂不考虑状态。":"该职位尚未进入承接工作流。"}</p></div><div className="command-grid">{actions.length?actions.map(command=><button key={command} className={command==="ACCEPT"?"primary":""} onClick={()=>onCommand(job,command)}>{actionLabel[command]}<ChevronRight/></button>):<p className="muted">当前没有允许的承接操作</p>}</div></DrawerSection>{state==="ACCEPTED"&&<DrawerSection title="记录结果"><form className="outcome-form" onSubmit={event=>{event.preventDefault();onOutcome(job,stage,rating?Number(rating):undefined,note||undefined);setNote("")}}><FilterSelect value={stage} onChange={value=>setStage(value as Outcome["stage"])} ariaLabel="结果阶段" options={stageOptions}/><FilterSelect value={rating} onChange={setRating} ariaLabel="结果评分" options={ratingOptions}/><input value={note} onChange={event=>setNote(event.target.value)} placeholder="备注（可选）"/><button className="btn primary" type="submit"><ClipboardCheck/>记录</button></form><div className="outcome-list">{outcomes.map(item=><div key={item.id}><b>{item.stage}</b><span>{item.rating?`${item.rating} 分 · `:""}{item.note||"已记录"}</span><time>{item.at}</time></div>)}</div></DrawerSection>}</>}

function ReplayPanel({job,events,outcomes}:{job:DecisionJob;events:DecisionEvent[];outcomes:Outcome[]}){const replay={decisionId:`D-${job.id.slice(4)}`,runId:"RUN-1842",snapshotAt:"2026-08-10 11:28",policyVersion:"Policy v1.2",rank:job.rank,reasons:job.scoreNotes,risks:job.scoreNotes.slice(0,1),evidence:job.evidence};return <><DrawerSection title="冻结决策快照"><dl className="facts"><div><dt>快照时间</dt><dd>{replay.snapshotAt}</dd></div><div><dt>策略版本</dt><dd>{replay.policyVersion}</dd></div><div><dt>当时排名</dt><dd>第 {replay.rank} 位</dd></div><div><dt>决策编号</dt><dd>{replay.decisionId}</dd></div></dl></DrawerSection><DrawerSection title="当时理由与风险"><ul className="explanations">{replay.reasons.map(item=><li key={item}>{item}</li>)}</ul><div className="evidence-list">{replay.evidence.map(item=><span key={item}>{item}</span>)}</div></DrawerSection><DrawerSection title="后续操作"><div className="trail-list">{events.map(item=><div key={item.id}><time>{item.at}</time><b>{item.type}</b><small>{item.reason||"顾问工作台"}</small></div>)}</div></DrawerSection><DrawerSection title="后续结果">{outcomes.length?<div className="outcome-list">{outcomes.map(item=><div key={item.id}><b>{item.stage}</b><span>{item.note||"已记录"}</span><time>{item.at}</time></div>)}</div>:<p className="muted">暂无结果记录；回放以上方冻结数据为准。</p>}</DrawerSection></>}

function SyncPanel({sync,onSync,onSetSync,notify}:{sync:SyncStatus;onSync:()=>void;onSetSync:(sync:SyncStatus)=>void;notify:(text:string)=>void}){const setDemo=(state:SyncStatus["state"]):void=>{onSetSync({...sync,state,errors:state==="ERROR"?["飞书消息源超时"]:state==="INCOMPLETE"?["职位事实未完整返回"]:[]});notify(state==="INCOMPLETE"?"已切换为同步不完整演示状态":"已切换为同步失败演示状态")};return <><div className="panel-heading"><ShieldCheck/><div><h1>同步状态</h1><p>当前推荐只使用完整快照</p></div></div><DrawerSection title="当前快照"><dl className="facts"><div><dt>状态</dt><dd>{sync.state==="READY"?"已同步":sync.state==="RUNNING"?"同步中":sync.state==="INCOMPLETE"?"本次同步不完整":sync.state==="AUTH_EXPIRED"?"飞书授权已过期":sync.state==="ERROR"?"同步失败":"尚未同步"}</dd></div><div><dt>读取进度</dt><dd>{sync.rowsRead??0} / {sync.rowsExpected??"—"}</dd></div><div><dt>更新时间</dt><dd>{sync.updatedAt||"—"}</dd></div></dl></DrawerSection><div className="drawer-actions"><button onClick={onSync}><span><b>重新同步</b><small>生成新的完整推荐快照</small></span><ChevronRight/></button><button onClick={()=>setDemo("INCOMPLETE")}><span><b>模拟同步不完整</b><small>验证推荐阻断界面</small></span><AlertTriangle/></button><button onClick={()=>setDemo("ERROR")}><span><b>模拟同步失败</b><small>验证异常与恢复提示</small></span><X/></button></div><p className="panel-caption">当前为前端演示。后端接入后，这里映射 sync_runs 与推荐生成状态。</p></>}

function IdentityPanel({auth,onAuth,notify}:{auth:AuthStatus;onAuth:(auth:AuthStatus)=>void;notify:(text:string)=>void}){return <><div className="panel-heading"><CircleUserRound/><div><h1>{auth.consultant}</h1><p>顾问会话与数据授权</p></div></div><DrawerSection title="账户状态"><dl className="facts"><div><dt>登录状态</dt><dd>已登录</dd></div><div><dt>飞书授权</dt><dd className={auth.needsReauth?"unknown":""}>{auth.needsReauth?"已过期":"正常"}</dd></div></dl></DrawerSection><div className="drawer-actions"><button onClick={()=>{onAuth({...auth,needsReauth:!auth.needsReauth,authorized:auth.needsReauth});notify(auth.needsReauth?"已恢复授权演示状态":"已切换为授权过期演示状态")}}><span><b>{auth.needsReauth?"恢复授权状态":"模拟授权过期"}</b><small>用于验证后端授权恢复入口</small></span><ShieldCheck/></button><button onClick={()=>notify("已退出演示会话；刷新页面将恢复本地演示身份")}><span><b>退出</b><small>不影响任何外部账号</small></span><ChevronRight/></button></div></>}

function NotificationPanel({items,onOpen,notify}:{items:Notification[];onOpen:(item:Notification)=>void;notify:(text:string)=>void}){return <><div className="panel-heading"><BellRing/><div><h1>今日提醒</h1><p>同步、承接与每日推荐摘要</p></div></div><div className="notification-list">{items.map(item=><button key={item.id} className={item.read?"read":""} onClick={()=>onOpen(item)}><i/><span><b>{item.title}</b><small>{item.detail}</small></span><ChevronRight/></button>)}</div><DrawerSection title="推送预览"><div className="push-preview"><b>今日职位判断</b><span>Top 3 已生成 · 1 个承接待处理</span></div><button className="btn" onClick={()=>notify("已模拟发送到 Felix 的飞书提醒") }><Send/>模拟发送</button><p className="panel-caption">仅展示推送内容，不会发送到外部系统。</p></DrawerSection></>}

function CommandConfirm({pending,onClose,onConfirm}:{pending:{job:DecisionJob;command:EngagementCommand};onClose:()=>void;onConfirm:(reason?:string)=>void}){const [reason,setReason]=useState("当前没精力");const dismiss=pending.command==="DISMISS";const reasonOptions:FilterSelectOption[]=["无资源","不符合方向","客户/职位质量不足","当前没精力","已有其他顾问推进","信息不完整","其他"].map(value=>({value,label:value}));return <div className="command-mask" role="presentation"><section className="command-modal" role="dialog" aria-modal="true" aria-label="确认承接操作"><h2>{dismiss?"暂不考虑这个职位？":"确认接单？"}</h2><p>{dismiss?"选择原因后会记录到决策轨迹。":"接单后该职位将进入你的交付列表。"}</p>{dismiss&&<FilterSelect value={reason} onChange={setReason} ariaLabel="暂不考虑原因" options={reasonOptions}/>}<div><button className="btn" onClick={onClose}>取消</button><button className="btn primary" onClick={()=>onConfirm(dismiss?reason:undefined)}>{dismiss?"记录原因":"确认接单"}</button></div></section></div>}

function DrawerSection({title,children}:{title:string;children:React.ReactNode}){return <section className="drawer-section"><h2>{title}</h2>{children}</section>}

// —— 候选供给（人才侧适配层的前端呈现）——
// 数据形状对齐后端 talent-supply.js 的 TalentSupplySnapshot（GET /opportunities/:id/talent-supply）。
// 供给分析【旁路】：只做展示，绝不并入 job.finalScore（与后端"不进入基础评分"纪律一致）。
type SupplySnapshot={matchableTalentCount:number;supplyDifficulty:"low"|"medium"|"high";matchingSuggestion:string;reactivatableTalentCount:number;topMatches:{name:string;score:number}[]};
const supplyDifficultyMeta:Record<SupplySnapshot["supplyDifficulty"],{label:string;tone:string}>={low:{label:"供给充足",tone:"ok"},medium:{label:"供给适中",tone:"warn"},high:{label:"供给偏紧",tone:"risk"}};
const talentPoolSeed=["王航·海外投放","陈мор·增长运营","李默·GTM 负责人","周屿·达人营销","苏黎·效果广告","林越·品牌市场","何洲·用户增长","顾原·渠道拓展"];
/** 从 job 确定性推导供给快照：稳定、可复现、与后端弱匹配语义同构（此处为前端演示数据）。 */
function deriveSupply(job:DecisionJob):SupplySnapshot{
 let h=0;for(const ch of job.id)h=(h*31+ch.charCodeAt(0))>>>0;
 const count=h%9;// 0-8 名可匹配候选
 const difficulty:SupplySnapshot["supplyDifficulty"]=count>=6?"low":count>=3?"medium":"high";
 const suggestion=count===0?"暂无可匹配候选，建议先扩搜或激活沉睡人才":difficulty==="high"?`仅 ${count} 名可匹配候选，供给偏紧，优先精准触达`:difficulty==="medium"?`${count} 名候选可推进，建议按匹配分分层触达`:`${count} 名候选可选，供给充足，可快速起量`;
 const topMatches=Array.from({length:Math.min(count,3)},(_,i)=>({name:talentPoolSeed[(h+i)%talentPoolSeed.length],score:Number((0.9-((h>>(i+1))%30)/100).toFixed(2))})).sort((a,b)=>b.score-a.score);
 return {matchableTalentCount:count,supplyDifficulty:difficulty,matchingSuggestion:suggestion,reactivatableTalentCount:h%3,topMatches};
}
function TalentSupplySection({job}:{job:DecisionJob}){
 const s=deriveSupply(job);
 const meta=supplyDifficultyMeta[s.supplyDifficulty];
 return <DrawerSection title="候选供给（人才侧参考）">
  <div className="supply-head">
   <div className="supply-count"><strong>{s.matchableTalentCount}</strong><span>可匹配候选</span></div>
   <span className={`supply-badge ${meta.tone}`}>{meta.label}</span>
   {s.reactivatableTalentCount>0&&<span className="supply-reactivate">可激活沉睡 {s.reactivatableTalentCount} 人</span>}
  </div>
  <p className="supply-suggestion">{s.matchingSuggestion}</p>
  {s.topMatches.length>0&&<div className="supply-matches">{s.topMatches.map(m=><div key={m.name} className="supply-match"><b>{m.name}</b><span>匹配 {Math.round(m.score*100)}%</span></div>)}</div>}
  <p className="snapshot-note">仅供参考 · 不计入最终得分 · 来源 talent-supply 适配层</p>
 </DrawerSection>;
}


function Today({actions,done,setDone,setSnoozed,extraTasks,setDrawer,openJob,openClient,notify}:any){
 return <><Heading code="TODAY / 07.29" title={<>今天有 <strong>3 个职位</strong>建议优先投入，<strong>1 个客户</strong>需要立即确认需求</>} desc="系统已综合 24 个职位、8 个客户和过去 48 小时的 37 条业务信号。"/>
 <div className="conclusion"><div className="spark"><Zap/></div><div><b>当前最值得投入：AI 广告销售负责人</b><p>星河科技反馈提速且新增 1 个 HC；建议今天补充 2 名高匹配人选。</p></div><button className="btn primary" style={{marginLeft:"auto"}} onClick={()=>openJob(jobs[0])}>进入职位 <ChevronRight/></button></div>
 <div className="grid g2">
  <section className="card"><div className="card-head"><h2>今日优先动作</h2><span>{actions.length+extraTasks.length} 项待处理</span></div><div className="actions">{extraTasks.map((t:string,i:number)=><div className="action-row" key={t}><StatusTag s="预警转入"/><div className="action-main"><b>{t}</b><small>由动态预警转为今日任务</small></div><div className="impact"><strong>需今日处理</strong>避免风险扩大</div><button className="btn" onClick={()=>notify("任务已完成")}>完成</button></div>)}{actions.map(({a,i}:any)=><div className="action-row" key={i}><StatusTag s={a[0]}/><div className="action-main"><b>{a[1]} · {a[2]}</b><small>{a[3]}</small></div><div className="impact"><strong>{a[4]}</strong>预计影响</div><div className="row-actions"><button title="查看依据" className="icon-btn" onClick={()=>setDrawer(`${a[1]}：${a[3]}`)}><CircleHelp/></button><button title="完成" className="icon-btn" onClick={()=>{setDone([...done,i]);notify("已标记完成")}}><Check/></button><button title="稍后" className="icon-btn" onClick={()=>{setSnoozed((x:number[])=>[...x,i]);notify("已移至稍后处理")}}><Clock3/></button><button title="不采纳" className="icon-btn danger" onClick={()=>{setDone([...done,i]);notify("已记录不采纳，将用于优化建议")}}><X/></button></div></div>)}{actions.length===0&&extraTasks.length===0&&<div className="empty"><Check/>今日建议已处理完毕</div>}</div></section>
  <section className="card"><div className="card-head"><h2>今日变化</h2><span>实时</span></div><div className="card-body timeline">{events.map(e=><div className="event" key={e[0]}><time>{e[0]}</time><i className="event-dot"/><div><b>{e[1]}</b><p>{e[2]}</p></div></div>)}</div></section>
 </div>
 <section className="card section"><div className="card-head"><h2>今日重点职位</h2><button className="link" onClick={()=>notify("已进入完整职位列表")}>查看全部 24 个</button></div><JobTable rows={jobs.slice(0,5)} open={openJob}/></section>
 <section className="card section"><div className="card-head"><h2>今日重点客户</h2><span>按综合优先级</span></div><ClientTable rows={clients.slice(0,5)} open={openClient}/></section></>
}

function JobsView({jobs,status,setStatus,sort,setSort,view,setView,selected,setSelected,openJob,notify}:any){
 const [clientFilter,setClientFilter]=useState("全部客户");
 const [cityFilter,setCityFilter]=useState("全部城市");
 const [compareOpen,setCompareOpen]=useState(false);
 const statusOptions:FilterSelectOption[]=[{value:"全部状态",label:"全部状态"},...statusOrder.map(value=>({value,label:value}))];
 const sortOptions:FilterSelectOption[]=[{value:"score",label:"综合分数 ↓"},{value:"hc",label:"HC ↓"}];
 const clientOptions:FilterSelectOption[]=[{value:"全部客户",label:"全部客户"},...clients.map(client=>({value:client.name,label:client.name}))];
 const cityOptions:FilterSelectOption[]=[{value:"全部城市",label:"全部城市"},...(["上海","北京","深圳","杭州"]).map(value=>({value,label:value}))];
 const visibleJobs=jobs.filter((job:Job)=>(clientFilter==="全部客户"||job.client===clientFilter)&&(cityFilter==="全部城市"||job.city===cityFilter));
 const comparedJobs=visibleJobs.filter((job:Job)=>selected.includes(job.id));
 const toggle=(id:number)=>{setCompareOpen(false);if(selected.includes(id))setSelected(selected.filter((x:number)=>x!==id));else if(selected.length<3)setSelected([...selected,id]);else notify("最多对比 3 个职位")};
 return <><Heading code="JOB SIGNAL RADAR" title="职位雷达" desc="把新鲜度、招聘意愿、反馈、转化与竞争信号放在同一决策面上。" action={<button className="btn primary" onClick={()=>notify("新建职位表单已准备（演示数据不写入真实系统）")}><Plus/>新增职位</button>}/>
 <div className="toolbar"><FilterSelect value={status} onChange={setStatus} ariaLabel="职位状态" options={statusOptions}/><FilterSelect value={sort} onChange={setSort} ariaLabel="排序方式" options={sortOptions}/><FilterSelect value={clientFilter} onChange={setClientFilter} ariaLabel="客户筛选" options={clientOptions}/><FilterSelect value={cityFilter} onChange={setCityFilter} ariaLabel="城市筛选" options={cityOptions}/><DirectGlassSegment value={view} options={[{value:"list",label:<><ListFilter/>决策列表</>},{value:"rail",label:<><Activity/>信号轨道</>}]} onChange={setView} className="glass-seg" ariaLabel="职位视图"/>{comparedJobs.length>1&&<button className="btn primary" onClick={()=>setCompareOpen(true)}><GitCompareArrows/>对比 {comparedJobs.length}</button>}</div>
 <section className="card">{view==="list"?<div className="table-wrap"><table className="data-table"><thead><tr><th>对比</th><th>职位 / 客户</th><th>分数</th><th>状态与判断</th><th>HC</th><th>最近反馈</th><th>推荐</th><th>面试</th><th>Offer</th><th>操作</th></tr></thead><tbody>{visibleJobs.map((j:Job)=><tr key={j.id}><td><input type="checkbox" checked={selected.includes(j.id)} onChange={()=>toggle(j.id)} /></td><td className="name-cell"><b>{j.name}</b><small>{j.client} · {j.city}</small></td><td className="score">{j.score}</td><td><StatusTag s={j.status}/><div className="reason">{j.reason}</div></td><td className="mono">{j.hc}</td><td>{j.feedback}</td><td>{j.recommended}</td><td>{j.interview}</td><td>{j.offer}</td><td><button className="link" onClick={()=>openJob(j)}>详情 →</button></td></tr>)}</tbody></table>{visibleJobs.length===0&&<div className="empty"><Search/>没有符合当前筛选的职位</div>}</div>:<SignalRail jobs={visibleJobs} open={openJob}/>}</section>
 {compareOpen&&<Compare jobs={comparedJobs} close={()=>setCompareOpen(false)}/>}</>
}
function SignalRail({jobs,open}:{jobs:Job[];open:(j:Job)=>void}){return <div className="rail">{jobs.map(j=>{const ix=statusOrder.indexOf(j.status);const color=j.status==="已关闭"?"#b32636":j.status==="拥挤"||j.status==="降温"?"#7d8795":"#0071e3";return <div className="rail-row" key={j.id}><div className="rail-name"><button className="link" onClick={()=>open(j)}><b>{j.name}</b></button><small>{j.client} · 评分 {j.score}</small></div><div><div className="track" style={{"--progress":`${ix/6*100}%`,"--track-color":color} as React.CSSProperties}>{statusOrder.map((s,i)=><i key={s} className={`node ${i<=ix?"done":""} ${i===ix?"current":""}`} style={{left:`${i/6*100}%`}} title={s}/>)}</div><div className="track-labels">{statusOrder.map(s=><span key={s}>{s}</span>)}</div></div><div className="reason">{j.reason}</div></div>})}</div>}
function Compare({jobs,close}:{jobs:Job[];close:()=>void}){const dims=["综合评分","职位新鲜度","招聘意愿","HC / 紧急程度","反馈速度","推荐→面试","面试→Offer","竞争程度","主要风险","建议动作"];return <><div className="drawer-backdrop" onClick={close}/><div className="modal"><div className="modal-head"><b>职位横向对比</b><button className="icon-btn" onClick={close}><X/></button></div><div className="modal-body compare-grid"><div></div>{jobs.map(j=><div key={j.id}><b>{j.name}</b></div>)}{dims.flatMap((d,i)=><><div key={d}>{d}</div>{jobs.map(j=><div key={`${d}${j.id}`}>{i===0?<span className="score">{j.score}</span>:i===1?`${Math.max(7,j.score-72)}/15`:i===2?`${Math.max(8,j.score-72)}/20`:i===3?`${j.hc} HC · ${j.hc>2?"紧急":"正常"}`:i===4?j.feedback:i===5?`${Math.round(j.interview/j.recommended*100)}%`:i===6?`${j.interview?Math.round(j.offer/j.interview*100):0}%`:i===7?j.status==="拥挤"?"高":"中":i===8?j.reason:j.status==="拥挤"?"提高推荐门槛":"优先推进"}</div>)}</>)}</div></div></>}

function JobTable({rows,open}:{rows:Job[];open:(j:Job)=>void}){return <div className="table-wrap"><table className="data-table"><thead><tr><th>职位 / 客户</th><th>综合分</th><th>状态与原因</th><th>HC</th><th>最近反馈</th><th>推荐</th><th>面试</th><th>Offer</th><th>今日建议</th></tr></thead><tbody>{rows.map(j=><tr key={j.id}><td className="name-cell"><button className="link" onClick={()=>open(j)}><b>{j.name}</b></button><small>{j.client}</small></td><td className="score">{j.score}</td><td><StatusTag s={j.status}/><div className="reason">{j.reason}</div></td><td className="mono">{j.hc}</td><td>{j.feedback}</td><td>{j.recommended}</td><td>{j.interview}</td><td>{j.offer}</td><td>{j.status==="拥挤"?"提高标准":j.status==="降温"?"确认预算":"优先推进"}</td></tr>)}</tbody></table></div>}

function JobDetail({job,onBack,weights,eventType,setEventType,hc,setHc,notify}:any){
 const [events2,setEvents2]=useState(events.slice(0,3));
 const detailWeights=[20,15,15,15,10,10,10,5];
 const add=()=>{setEvents2([[new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}),eventType,eventType==="HC变化"?`HC更新为 ${hc}`:"用户新增项目事件"],...events2]);notify("事件已记录，状态与评分已重新计算")};
 return <><button className="back" onClick={onBack}><ArrowLeft/>返回职位雷达</button><div className="detail-top"><div className="detail-title"><span className="eyebrow">JOB / {String(job.id).padStart(4,"0")}</span><h1>{job.name}</h1><div className="meta"><span>{job.client}</span><span>PM · {job.pm}</span><span>{job.city}</span><span>{job.salary}</span><span>HC {job.hc}</span><span>更新 {job.feedback}</span></div></div><div className="big-score" style={{"--score":job.score} as React.CSSProperties}><span>{job.score}</span></div></div>
 <div className="conclusion"><div className="spark"><Sparkles/></div><div><b>建议优先投入</b><p>{job.reason}。当前推荐到面试转化较高，主要风险是面试池逐渐拥挤，建议提高推荐标准。</p></div><StatusTag s={job.status}/></div>
 <div className="grid g2"><section className="card"><div className="card-head"><h2>评分依据</h2><span>规则计算 + AI推断</span></div><div className="card-body score-bars">{["客户真实招聘意愿","职位新鲜度","HC 和紧急程度","客户反馈速度","推荐到面试转化","面试到 Offer 转化","当前竞争程度","历史交付风险"].map((n,i)=><div className="score-line" key={n}><span>{n}</span><div className="bar"><i style={{width:`${Math.min(100,(detailWeights[i]-(i%3))*100/detailWeights[i])}%`}}/></div><strong>{detailWeights[i]-(i%3)} / {detailWeights[i]}</strong></div>)}</div></section><section className="card"><div className="card-head"><h2>建议动作</h2><span>按影响排序</span></div><div className="card-body side-list">{["向PM确认剩余HC","确认当前面试进度","提高推荐标准","48小时无反馈则降低优先级"].map((x,i)=><div className="mini-item" key={x}><span className="num">0{i+1}</span><div><b>{x}</b><p>{i<2?"今天完成 · 高影响":"本周完成 · 中影响"}</p></div><button className="icon-btn" onClick={()=>notify(`已完成：${x}`)}><Check/></button></div>)}</div></section></div>
 <section className="card section"><div className="card-head"><h2>职位信号轨道</h2><span>每次判断均可追溯</span></div><SignalRail jobs={[job]} open={()=>{}}/></section>
 <div className="grid g2 section"><section className="card"><div className="card-head"><h2>招聘漏斗</h2><span>近 90 天</span></div><div className="card-body funnel">{[["推荐",job.recommended],["客户查看",Math.max(1,job.recommended-2)],["初面",job.interview],["复试",Math.max(1,job.interview-1)],["终面",job.offer+1],["Offer",job.offer],["入职",0]].map(x=><div className="funnel-step" key={x[0]}><b>{x[1]}</b><small>{x[0]}</small></div>)}</div></section><section className="card"><div className="card-head"><h2>当前竞争</h2><span>趋势上升</span></div><div className="card-body g3 grid">{[["参与顾问","4"],["已推荐",job.recommended],["面试 / Offer",`${job.interview} / ${job.offer}`]].map(x=><div className="mini-item" key={x[0]}><div><p>{x[0]}</p><b className="score">{x[1]}</b></div></div>)}</div></section></div>
 <div className="grid g2 section"><section className="card"><div className="card-head"><h2>客户反馈摘要</h2><span>AI结构化提取</span></div><div className="card-body side-list">{["最近反馈：商业化经验通过，需验证团队管理跨度","高频淘汰：行业深度不足、英文沟通欠缺","重点关注：AI广告客户资源、0→1团队经验","待确认：剩余HC与下一轮面试排期"].map(x=><div className="mini-item" key={x}><Sparkles/><b>{x}</b></div>)}</div></section><section className="card"><div className="card-head"><h2>新增项目事件</h2><span>将触发重新计算</span></div><div className="card-body"><div className="toolbar"><FilterSelect value={eventType} onChange={setEventType} ariaLabel="项目事件类型" options={["客户反馈","HC变化","面试变化","Offer变化","职位暂停","职位恢复","职位关闭"].map(value=>({value,label:value}))}/>{eventType==="HC变化"&&<input className="field" type="number" min={0} value={hc} onChange={e=>setHc(+e.target.value)}/>}<button className="btn primary" onClick={add}><Plus/>记录并重算</button></div><div className="timeline">{events2.map((e:string[],i:number)=><div className="event" key={`${e[0]}${i}`}><time>{e[0]}</time><i className="event-dot"/><div><b>{e[1]}</b><p>{e[2]}</p></div></div>)}</div></div></section></div></>
}

function ClientsView({clients,open,notify}:any){const [compare,setCompare]=useState<string[]>([]);const [stateFilter,setStateFilter]=useState("全部合作状态");const [sortBy,setSortBy]=useState("score");const [compareOpen,setCompareOpen]=useState(false);const visibleClients=[...clients].filter((client:any)=>stateFilter==="全部合作状态"||client.state===stateFilter).sort((a:any,b:any)=>sortBy==="feedback"?parseInt(a.feedback)-parseInt(b.feedback):sortBy==="hc"?b.hc-a.hc:b.score-a.score);const comparedClients=visibleClients.filter((client:any)=>compare.includes(client.name));const toggle=(name:string)=>{setCompareOpen(false);if(compare.includes(name))setCompare(compare.filter(x=>x!==name));else if(compare.length<3)setCompare([...compare,name]);else notify("最多对比 3 个客户")};const reset=()=>{setStateFilter("全部合作状态");setSortBy("score");setCompare([]);setCompareOpen(false);notify("客户筛选已重置")};return <><Heading code="CLIENT INTELLIGENCE" title="客户洞察" desc="识别真实招聘窗口、合作温度与交付风险。" action={<button className="btn" onClick={reset}><RotateCcw/>重置筛选</button>}/><div className="toolbar"><FilterSelect value={stateFilter} onChange={setStateFilter} ariaLabel="合作状态筛选" options={["全部合作状态","招聘窗口期","稳定合作","反馈降温"].map(value=>({value,label:value}))}/><FilterSelect value={sortBy} onChange={setSortBy} ariaLabel="客户排序方式" options={[{value:"score",label:"优先级 ↓"},{value:"feedback",label:"反馈速度 ↑"},{value:"hc",label:"总 HC ↓"}]}/>{comparedClients.length>1&&<button className="btn primary" onClick={()=>setCompareOpen(true)}><GitCompareArrows/>对比 {comparedClients.length}</button>}</div><section className="card"><div className="table-wrap"><table className="data-table"><thead><tr><th>对比</th><th>客户 / 行业</th><th>合作状态</th><th>活跃职位</th><th>总HC</th><th>平均反馈</th><th>推荐→面试</th><th>面试→Offer</th><th>历史入职</th><th>意愿</th><th>优先级</th><th>主要风险</th></tr></thead><tbody>{visibleClients.map((c:any)=><tr key={c.name}><td><input type="checkbox" checked={compare.includes(c.name)} onChange={()=>toggle(c.name)}/></td><td className="name-cell"><button className="link" onClick={()=>open(c)}><b>{c.name}</b></button><small>{c.industry}</small></td><td><StatusTag s={c.state}/></td><td>{c.active}</td><td>{c.hc}</td><td>{c.feedback}</td><td>{c.r2i}</td><td>{c.i2o}</td><td>{c.hires}</td><td>{c.intent}</td><td className="score">{c.score}</td><td>{c.risk}</td></tr>)}</tbody></table>{visibleClients.length===0&&<div className="empty"><Search/>没有符合当前筛选的客户</div>}</div></section>{compareOpen&&<ClientCompare clients={comparedClients} close={()=>setCompareOpen(false)}/>}</>}
function ClientCompare({clients,close}:{clients:any[];close:()=>void}){const dims:[string,(client:any)=>React.ReactNode][]=[["合作状态",client=>client.state],["活跃职位",client=>client.active],["总 HC",client=>client.hc],["平均反馈",client=>client.feedback],["推荐→面试",client=>client.r2i],["面试→Offer",client=>client.i2o],["历史入职",client=>client.hires],["招聘意愿",client=>client.intent],["优先级",client=><span className="score">{client.score}</span>],["主要风险",client=>client.risk]];return <><div className="drawer-backdrop" onClick={close}/><div className="modal"><div className="modal-head"><b>客户横向对比</b><button className="icon-btn" onClick={close} aria-label="关闭对比"><X/></button></div><div className="modal-body compare-grid"><div></div>{clients.map(client=><div key={client.name}><b>{client.name}</b></div>)}{dims.flatMap(([label,value])=><><div key={label}>{label}</div>{clients.map(client=><div key={`${label}${client.name}`}>{value(client)}</div>)}</>)}</div></div></>}
function ClientTable({rows,open}:any){return <div className="table-wrap"><table className="data-table"><thead><tr><th>客户</th><th>状态</th><th>活跃职位</th><th>总 HC</th><th>平均反馈</th><th>招聘意愿</th><th>优先级</th><th>主要风险</th><th>建议动作</th></tr></thead><tbody>{rows.map((c:any)=><tr key={c.name}><td><button className="link" onClick={()=>open(c)}><b>{c.name}</b></button></td><td><StatusTag s={c.state}/></td><td>{c.active}</td><td>{c.hc}</td><td>{c.feedback}</td><td>{c.intent}</td><td className="score">{c.score}</td><td>{c.risk}</td><td>确认本周面试排期</td></tr>)}</tbody></table></div>}
function ClientDetail({c,onBack,notify}:any){return <><button className="back" onClick={onBack}><ArrowLeft/>返回客户洞察</button><Heading code={`CLIENT / ${c.industry}`} title={c.name} desc={`优先级 ${c.score} · ${c.state} · 平均反馈 ${c.feedback}`} action={<button className="btn primary" onClick={()=>notify("客户反馈已记录并触发重新判断")}><Plus/>添加客户反馈</button>}/><div className="conclusion"><div className="spark"><Sparkles/></div><div><b>{c.name}当前处于集中招聘窗口期</b><p>近30天新增 {c.active} 个职位，平均反馈时间缩短至 {c.feedback}，建议提高交付优先级。</p></div></div><div className="grid g3">{[["活跃职位",c.active],["总 HC",c.hc],["历史入职",c.hires]].map(x=><div className="card card-body" key={x[0]}><span className="eyebrow">{x[0]}</span><div className="score" style={{fontSize:28,marginTop:8}}>{x[1]}</div></div>)}</div><div className="grid g2 section"><section className="card"><div className="card-head"><h2>当前活跃职位</h2><span>{c.active} 个</span></div><JobTable rows={jobs.filter(j=>j.client===c.name).concat(jobs.slice(0,Math.max(0,3-jobs.filter(j=>j.client===c.name).length)))} open={()=>notify("已打开关联职位")}/></section><section className="card"><div className="card-head"><h2>合作判断</h2><span>近6个月</span></div><div className="card-body side-list">{["人才偏好：头部AI商业化经验、团队从0到1","高频淘汰：缺少复杂销售经验","需求变更：近30天 2 次，处于可控范围","合作风险：面试标准近期小幅抬高","建议动作：锁定本周业务负责人面试档期"].map((x,i)=><div className="mini-item" key={x}><span className="num">0{i+1}</span><b>{x}</b></div>)}</div></section></div><section className="card section"><div className="card-head"><h2>客户事件时间线</h2><span>可追溯</span></div><div className="card-body timeline">{events.concat([["06-28","新增职位","新增 AI 解决方案销售，HC 3"],["06-04","需求变化","薪资上限提高 15%"]]).map(e=><div className="event" key={e[0]}><time>{e[0]}</time><i className="event-dot"/><div><b>{e[1]}</b><p>{e[2]}</p></div></div>)}</div></section></>}

function Alerts({setExtraTasks,notify,setDrawer}:any){const alerts=["云帆智能连续7天未反馈","商业化增长经理转化率下降12%","海外增长负责人面试池已拥挤","星河科技进入招聘窗口期","Creator Partnership负责人新增2个HC","棱镜互动近14天需求变更3次","AI解决方案销售参与顾问增至6人","用户增长负责人产生Offer"];const [handled,setHandled]=useState<number[]>([]);const [riskFilter,setRiskFilter]=useState("全部风险等级");const [clientFilter,setClientFilter]=useState("全部客户");return <><Heading code="DYNAMIC ALERTS" title="动态预警" desc="聚合需要人工确认的机会、变化和失活信号。"/><div className="toolbar"><FilterSelect value={riskFilter} onChange={setRiskFilter} ariaLabel="预警风险等级" options={["全部风险等级","高风险","机会"].map(value=>({value,label:value}))}/><FilterSelect value={clientFilter} onChange={setClientFilter} ariaLabel="预警客户筛选" options={[{value:"全部客户",label:"全部客户"},...clients.map(client=>({value:client.name,label:client.name}))]}/></div><section className="card"><div className="actions">{alerts.map((x,i)=><div className="action-row" key={x} style={{opacity:handled.includes(i)?.5:1}}><StatusTag s={i%3===0?"高风险":i%3===1?"关注":"机会"}/><div className="action-main"><b>{x}</b><small>{i%2?"基于近7天业务事件变化":"超过预设阈值，建议今天确认"}</small></div><div className="impact"><strong>{i%3===2?"机会升温":"需人工确认"}</strong>置信度 {88+i}%</div><div className="row-actions"><button className="btn" onClick={()=>setDrawer(x)}>依据</button><button className="btn" onClick={()=>{setExtraTasks((v:string[])=>v.includes(x)?v:[...v,x]);notify("已转为今日任务")}}>转任务</button><button className="icon-btn" onClick={()=>{setHandled([...handled,i]);notify("预警已处理")}}><Check/></button></div></div>)}</div></section></>}
function Rules({weights,setWeights,notify}:any){const names=["项目推进","探索机会","个人适配"];const notes=["阶段、动量、转化、HC 空间与竞争度","新鲜度、方向匹配、有效 HC 与低竞争","顾问关系、容量、历史交付与战略方向"];const total=weights.reduce((a:number,b:number)=>a+b,0);const canApply=total===100;return <><Heading code="POLICY / FELIX V1.3" title="判断策略" desc="调整关注侧重点，不等于手工指定职位排名；HC、已入职和关闭状态始终是硬规则。" action={<div className={`tag ${canApply?"blue":"orange"}`}>当前合计 {total}%{canApply?"":" · 需为 100%"}</div>}/><div className="grid g2"><section className="card"><div className="card-head"><h2>三层软权重</h2><button className="link" onClick={()=>{setWeights([60,25,15]);notify("已恢复默认策略")}}>恢复默认</button></div><div className="card-body strategy-rules">{names.map((n,i)=><label className="rule-row" key={n}><span><b>{n}</b><small>{notes[i]}</small></span><input type="range" min="5" max="80" value={weights[i]} onChange={e=>{const w=[...weights];w[i]=+e.target.value;setWeights(w)}}/><output>{weights[i]}%</output></label>)}<button className="btn primary" style={{marginTop:16}} disabled={!canApply} onClick={()=>notify("策略已保存；后端将生成新的 policy_version 和推荐快照")}><Check/>保存并生成新推荐</button>{!canApply&&<p className="rule-validation">三层权重总和需为 100%，才能提交给 Agent 重新计算。</p>}<p className="policy-boundary"><ShieldCheck/>不可调整：HC、已入职、职位关闭、项目归属与数据冲突规则。</p></div></section><section className="card"><div className="card-head"><h2>影响预览</h2><span>由 Agent 返回</span></div><div className="card-body"><div className="conclusion"><div className="spark"><Activity/></div><div><b>只预览软排序变化</b><p>正式保存前展示哪些职位上升、下降，以及仍被硬规则拦截的职位。</p></div></div>{[["项目推进","当前 60%","强化在途项目与真实反馈"],["探索机会","当前 25%","保留新项目验证空间"],["个人适配","当前 15%","只做个人修正，不覆盖项目事实"]].map(x=><div className="mini-item" key={x[0]}><div><b>{x[0]}</b><p>{x[2]}</p></div><strong style={{marginLeft:"auto",color:"var(--blue)"}}>{x[1]}</strong></div>)}</div></section></div></>}
function TalentBackendCard(){
 type Health={backend:string;connected:boolean;schema:string;degraded:string|null;config?:{host:string;port:number;database:string|null;credentials_present:boolean;ssl:boolean};hint:string};
 const [health,setHealth]=useState<Health|null>(null);
 const [state,setState]=useState<"loading"|"live"|"offline">("loading");
 useEffect(()=>{let alive=true;const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),2500);
  fetch("/api/v1/talent/health",{signal:ctrl.signal,credentials:"include"})
   .then(r=>r.ok?r.json():Promise.reject())
   .then((h:Health)=>{if(alive){setHealth(h);setState("live")}})
   .catch(()=>{if(alive)setState("offline")})
   .finally(()=>clearTimeout(t));
  return ()=>{alive=false;ctrl.abort()};
 },[]);
 const isMysql=health?.backend==="mysql"&&health.connected;
 const badge=state==="offline"?{s:"已就绪",cls:""}:isMysql?{s:"已连接",cls:""}:{s:"内存回退",cls:"warn"};
 return <section className="card talent-backend"><div className="source-head"><div className="source-icon"><Database/></div><span className={`supply-badge ${isMysql?"ok":badge.cls==="warn"?"warn":"risk"}`}>{badge.s}</span></div>
  <h3>人才库（阿里云 RDS）</h3>
  {state==="loading"&&<p>正在检测人才库连接…</p>}
  {state==="offline"&&<><p>人才库读写与供给匹配【代码已就绪】。此预览未连后端 API，填写 <code>.env</code> 的 <code>BRAINX_MYSQL_*</code> 凭据并启动服务后，此处会实时显示真库连接状态。</p>
   <div className="backend-facts"><div><dt>切库方式</dt><dd>填凭据 → <code>npm run talent:health</code> 自检</dd></div><div><dt>连不通</dt><dd>自动降级内存库（功能不中断）</dd></div></div></>}
  {state==="live"&&health&&<><p>{health.hint}</p>
   <div className="backend-facts">
    <div><dt>当前后端</dt><dd className={isMysql?"":"unknown"}>{isMysql?"MySQL 真库":"内存回退"}</dd></div>
    <div><dt>连通性</dt><dd className={health.connected?"":"unknown"}>{health.connected?"已连通":"未连通"}</dd></div>
    <div><dt>建表状态</dt><dd>{health.schema}</dd></div>
    {health.config&&<div><dt>目标库</dt><dd>{health.config.database||"—"} @ {health.config.host}</dd></div>}
    {health.degraded&&<div><dt>诊断</dt><dd className="unknown">{health.degraded}</dd></div>}
   </div></>}
 </section>;
}
function Sources({notify}:any){return <><Heading code="DATA SOURCES" title="数据源" desc="MVP 演示连接状态；不连接真实账号，不写入外部系统。"/><div className="source-grid"><TalentBackendCard/>{sourceNames.map((n,i)=><section className="card source" key={n}><div className="source-head"><div className="source-icon"><Database/></div><StatusTag s={i===5?"同步异常":i===4?"权限受限":"已连接"}/></div><h3>{n}</h3><p>最后同步：{i<3?"14:28":"昨天 22:10"} · {i===5?"缺少邮件正文权限":"读取权限正常"}</p><div className="completeness"><span>数据完整度</span><b>{92-i*4}%</b></div><div className="bar"><i style={{width:`${92-i*4}%`,background:i===5?"var(--orange)":"var(--blue)"}}/></div><button className="btn" style={{marginTop:14}} onClick={()=>notify(i===5?"已生成权限修复指引":"字段清单已展开")}><Settings2/>查看字段</button></section>)}</div></>}
