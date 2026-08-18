"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowLeft, BarChart3, Bell, BriefcaseBusiness,
  Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Database, Filter, FolderOpen, FolderPlus, GitCompareArrows,
  Infinity, ListFilter, MoreHorizontal, Plus, RotateCcw, Search, Settings2,
  BellRing, CheckCircle2, CircleUserRound, ClipboardCheck, Send, ShieldCheck, SlidersHorizontal, Sparkles, Star, Users, X, Zap,
} from "lucide-react";
import { actionLabel, seedAuth, seedNotifications, seedSync, stateLabel, type AuthStatus, type DecisionEvent, type EngagementCommand, type EngagementState, type Notification, type Outcome, type SyncStatus } from "./decision-demo";
import { BACKEND_WEIGHTS, FALLBACK_DISMISS_REASONS, brainxFetch, connectSSE, fetchJobDetail, getSnapshot, makeIdempotencyKey, mapReplayData, mapRadarRow, mapClientRow, getRadar, getClients, getTalentSupply, updateOpportunityFacts, sendRecommendationFeedback, streamAssistant, BrainxApiError, type TalentSupplySnapshot, type AssistantMessage, type BackendConsultants, type BackendEngagementResponse, type BackendOutcomeResponse, type BackendProfileUpdate, type BackendRecommendationRun, type BackendReplay, type BackendSessionStatus, type BrainxReplay, type BrainxSnapshot, type ManualFactField, type RadarJob, type RadarClient } from "./brainx-api";
import { cockpitRadarCompanies } from "./cockpit-radar-data";

type Page = "today"|"jobs"|"clients"|"alerts"|"rules"|"sources"|"accepted";
type Status = "待同步"|"新发布"|"升温"|"活跃"|"拥挤"|"降温"|"疑似失活"|"已关闭";
type PositionType = "技术"|"产品"|"运营"|"算法"|"设计"|"商业化";
type JobSource = "市场信号"|"驾驶舱导入";
type Job = {id:number|string;name:string;client:string;industry:string;city:string;pm:string;status:Status;score:number|null;hc:number|null;feedback:string;recommended:number|null;interview:number|null;offer:number|null;reason:string;salary:string;source:JobSource;positionType:PositionType;sourceColumn?:string};
type DecisionGroup = "RESULT_CLOSURE"|"ACTIVE_ADVANCEMENT"|"NEW_VALIDATION"|"MAINTENANCE"|"EXCLUDE";
type Eligibility = "ELIGIBLE"|"VERIFY_REQUIRED"|"BLOCKED"|"EXCLUDED";
type DecisionDirection = "paid"|"growth"|"marketing";
type SourceMode = "COCKPIT_CONTEXT"|"MARKET_ONLY";
type DecisionAction = {id:string;label:string;kind:"verify"|"advance"|"watch"|"skip";detail:string};
type DecisionFact = {value:string|number|null;effective_value:string|number|null;source:"SYNC"|"MANUAL"|"UNKNOWN"|"LOCAL";updated_at:string|null};
type DecisionJob = {
 id:string; rank:number; company:string; role:string; direction:DecisionDirection; sourceMode:SourceMode; group:DecisionGroup; eligibility:Eligibility;
 globalScore:number|string; explorationScore:number|string; personalScore:number|string; finalScore:number|string; evidenceCoverage:number|null;
 recommendation:string; recentSignal:string; facts:Record<string,string>; scoreNotes:string[];
 factFields?: Partial<Record<ManualFactField,DecisionFact>>;
 risks:string[]; evidence:string[]; actions:DecisionAction[];
 brainxLegal?:EngagementCommand[]; brainxDecisionId?:string;
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
 {id:"JX3S2YU",direction:"paid",rank:4,company:"云帆智能",role:"海外解决方案销售",relation:"未加入",sourceMode:"MARKET_ONLY",stage:"SCREENING",remainingHc:2,pipeline:"推荐 6 · 面试 1",process:69,exploration:72,personal:64,final:70,group:"MAINTENANCE",reasons:["职位仍保留 2 个 HC，但近期反馈不足。","需要先确认需求是否仍然有效。"],risks:["连续反馈间隔较长，不能直接投入承接资源。"],nextAction:"先确认需求有效性与负责人，再决定是否接单",evidence:["职位市场快照","HC 字段","反馈记录"]},
];
const decisionJobs:DecisionJob[]=decisionSeeds.map(seed=>({id:seed.id,rank:seed.rank,company:seed.company,role:seed.role,direction:seed.direction,sourceMode:seed.sourceMode,group:seed.group,eligibility:"ELIGIBLE",globalScore:seed.process,explorationScore:seed.exploration,personalScore:seed.personal,finalScore:seed.final,evidenceCoverage:null,recommendation:seed.nextAction,recentSignal:`${seed.stage} · 剩余 HC ${seed.remainingHc}`,facts:{"职位关系":seed.relation,"数据来源":seed.sourceMode==="COCKPIT_CONTEXT"?"驾驶舱上下文":"职位市场","当前阶段":seed.stage,"剩余 HC":String(seed.remainingHc),"Offer 状态":"0","入职状态":"0","历史 Pipeline":seed.pipeline},scoreNotes:seed.reasons,risks:seed.risks,evidence:seed.evidence,actions:seed.relation==="未加入"?[{id:"verify",label:"确认项目归属",kind:"verify",detail:"先确认负责人和承接状态"}]:[{id:"advance",label:"进入项目推进",kind:"advance",detail:seed.nextAction},{id:"watch",label:"加入观察",kind:"watch",detail:"保留本周提醒"}]}));
const verificationJobs:DecisionJob[]=[
 ["JS6ZVBW","Nooklab","DTC负责人","Offer 1 覆盖剩余 HC 1，入职未确认"],
 ["JFL41BC","SigmaZ","平台增长负责人","Offer 1 覆盖剩余 HC 1，入职未确认"],
 ["JH1ORT9","refly.ai","增长运营 / KOL / 投放","Offer 2 覆盖剩余 HC 2，入职未确认"],
].map(([id,company,role,note],index)=>({id,rank:index+1,company,role,direction:index===0?"growth":index===1?"growth":"paid",sourceMode:"MARKET_ONLY",group:"RESULT_CLOSURE",eligibility:"VERIFY_REQUIRED",globalScore:0,explorationScore:0,personalScore:0,finalScore:0,evidenceCoverage:null,recommendation:"核验 Offer 与入职状态",recentSignal:note,facts:{"职位关系":"待确认","数据来源":"职位市场","当前阶段":"OFFER","剩余 HC":"UNKNOWN","Offer 状态":"已发出","入职状态":"UNKNOWN","历史 Pipeline":"待核验"},scoreNotes:["Offer 已覆盖当前 HC，但入职结果未知。"],risks:[note],evidence:["职位市场快照","Offer 状态字段","入职状态缺失"],actions:[{id:"verify",label:"去确认状态",kind:"verify",detail:"确认 Offer、入职和剩余 HC"}]} as DecisionJob));

const jobs: Job[] = [
 {id:1,name:"AI 广告销售负责人",client:"星河科技",industry:"人工智能",city:"上海",pm:"林书言",status:"升温",score:92,hc:3,feedback:"2小时前",recommended:8,interview:3,offer:0,reason:"48小时反馈提速，HC由2增至3",salary:"70–100K",source:"市场信号",positionType:"商业化"},
 {id:2,name:"海外增长负责人",client:"纬度引擎",industry:"跨境电商",city:"深圳",pm:"周既明",status:"拥挤",score:78,hc:2,feedback:"5小时前",recommended:14,interview:5,offer:1,reason:"已有5人面试，竞争进入高位",salary:"60–85K",source:"市场信号",positionType:"商业化"},
 {id:3,name:"商业化增长经理",client:"棱镜互动",industry:"营销科技",city:"北京",pm:"许嘉禾",status:"降温",score:63,hc:1,feedback:"3天前",recommended:9,interview:1,offer:0,reason:"反馈放缓且预算低于市场中位数",salary:"35–45K",source:"市场信号",positionType:"商业化"},
 {id:4,name:"AI 产品运营负责人",client:"澄明智能",industry:"人工智能",city:"杭州",pm:"沈青",status:"活跃",score:86,hc:2,feedback:"8小时前",recommended:6,interview:2,offer:0,reason:"客户连续两轮在24小时内反馈",salary:"50–75K",source:"市场信号",positionType:"产品"},
 {id:5,name:"Creator Partnership 负责人",client:"远屿网络",industry:"内容平台",city:"上海",pm:"陆弦",status:"新发布",score:82,hc:4,feedback:"1天前",recommended:3,interview:0,offer:0,reason:"新发布且4个HC，需求画像已确认",salary:"45–65K",source:"市场信号",positionType:"商业化"},
 {id:6,name:"海外渠道销售",client:"云帆智能",industry:"企业服务",city:"深圳",pm:"林书言",status:"疑似失活",score:41,hc:2,feedback:"7天前",recommended:11,interview:1,offer:0,reason:"连续7天无反馈，剩余HC未确认",salary:"40–60K",source:"市场信号",positionType:"商业化"},
 {id:7,name:"用户增长负责人",client:"拾光生活",industry:"消费科技",city:"北京",pm:"周既明",status:"升温",score:88,hc:2,feedback:"4小时前",recommended:7,interview:3,offer:1,reason:"新增Offer且反馈时间缩短至12小时",salary:"55–80K",source:"市场信号",positionType:"运营"},
 {id:8,name:"增长策略负责人",client:"矩阵工场",industry:"SaaS",city:"杭州",pm:"沈青",status:"活跃",score:80,hc:1,feedback:"20小时前",recommended:5,interview:2,offer:0,reason:"面试转化稳定，业务负责人持续参与",salary:"50–70K",source:"市场信号",positionType:"商业化"},
 {id:9,name:"AI 解决方案销售",client:"澄明智能",industry:"人工智能",city:"北京",pm:"许嘉禾",status:"拥挤",score:72,hc:3,feedback:"9小时前",recommended:18,interview:6,offer:1,reason:"参与顾问增至6人，推荐密度过高",salary:"45–70K",source:"市场信号",positionType:"商业化"},
 {id:10,name:"国际化产品增长",client:"远屿网络",industry:"内容平台",city:"上海",pm:"陆弦",status:"已关闭",score:0,hc:0,feedback:"2天前",recommended:12,interview:4,offer:1,reason:"客户确认HC已全部关闭",salary:"45–65K",source:"市场信号",positionType:"产品"},
];

const cockpitRoleColumns = [
 {key:"technical",label:"技术岗",fallback:"技术"},
 {key:"productOps",label:"产运岗",fallback:"运营"},
 {key:"algorithm",label:"算法岗",fallback:"算法"},
] as const satisfies readonly {key:"technical"|"productOps"|"algorithm";label:string;fallback:PositionType}[];

function splitCockpitRoles(value:string){
 const titles:string[]=[];let title="";let nesting=0;
 const push=()=>{const next=title.replace(/^[-•·\s]+|\s+$/g,"").trim();if(next&&next!=="—"&&next!=="暂无")titles.push(next);title=""};
 for(const char of value.replace(/\r/g,"\n")){
  if(char==="（"||char==="(")nesting+=1;
  if(char==="）"||char===")")nesting=Math.max(0,nesting-1);
  if((char==="\n"&&nesting===0)||"、；;".includes(char)){push();continue}
  title+=char;
 }
 push();return titles;
}
function classifyCockpitRole(title:string,fallback:PositionType):PositionType{
 const value=title.replace(/\s+/g," ").trim();
 if(/设计|UI\s*\/?\s*UX|视觉/i.test(value))return "设计";
 if(/算法|大模型|机器学习|深度学习|研究|Research|MLE|VLM|NLP|RAG|LLM/i.test(value))return "算法";
 if(/运营|社群|社区|助理|财务|FA\b|KOL/i.test(value))return "运营";
 if(/产品(经理|负责人|总监|设计|策略|运营|市场|增长|商业化|&)|\bPM\b|Product/i.test(value))return "产品";
 if(/增长|市场|投放|销售|商务|品牌|GTM|售前|招聘|HR|BD|营销|内容|CMO/i.test(value))return "商业化";
 if(/工程|研发|开发|前端|后端|全栈|运维|测试|架构|技术|CTO|iOS|Android|Engineer/i.test(value))return "技术";
 if(/产品/i.test(value))return "产品";
 return fallback;
}
const cockpitRadarJobs:Job[] = cockpitRadarCompanies.flatMap(company=>cockpitRoleColumns.flatMap(column=>splitCockpitRoles(company[column.key]).map((name,index)=>({
 id:`${company.id}:${column.key}:${index + 1}`,name,client:company.company,industry:company.business||"未标注业务方向",city:company.city||"待确认",pm:"待后端同步",status:"待同步" as const,
 score:null,hc:null,feedback:"待接入",recommended:null,interview:null,offer:null,reason:`驾驶舱导入 · ${column.label}`,salary:"待同步",source:"驾驶舱导入" as const,positionType:classifyCockpitRole(name,column.fallback),sourceColumn:column.label,
})))).filter((job,index,items)=>items.findIndex(candidate=>candidate.client===job.client&&candidate.name===job.name)===index);
// 离线演示的合并雷达列表；connected 模式在组件内用后端 /api/v1/radar 替代
const demoRadarJobs:Job[]=[...jobs,...cockpitRadarJobs];
type Client = {name:string;industry:string;state:string;active:number;hc:number|null;feedback:string;r2i:string;i2o:string;hires:number|null;intent:string;score:number|null;risk:string};
const clients:Client[] = [
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
const statusOrder:Exclude<Status,"待同步">[]=["新发布","升温","活跃","拥挤","降温","疑似失活","已关闭"];
const nav = [
 ["today","精选",Sparkles],["jobs","职位",Activity],["clients","客户",Users],
 ["alerts","预警",Bell],
] as const;
const navUtils = [
 ["rules","判断逻辑",SlidersHorizontal],["sources","数据源",Database],
] as const;
const sourceNames=["内部项目驾驶舱","职位库","客户管理记录","飞书文档","飞书消息","邮件反馈","历史交付记录"];
type PickFolder = {id:string;name:string;jobIds:string[]};
const DEFAULT_FOLDERS:PickFolder[]=[{id:"f-week",name:"本周重点",jobIds:[]},{id:"f-verify",name:"待验证",jobIds:[]},{id:"f-later",name:"稍后再看",jobIds:[]}];
type SavedWorkbenchState = Partial<{done:number[];snoozed:number[];extraTasks:string[];weights:number[];decisionActions:string[];sidebarWidth:number;tray:string[];folders:PickFolder[];folderMode:boolean;engagement:Record<string,EngagementState>;events:Record<string,DecisionEvent[]>;outcomes:Record<string,Outcome[]>;sync:SyncStatus;auth:AuthStatus;notifications:Notification[]}>;
type SidebarResize = {startX:number;startWidth:number;opensCollapsed:boolean};
const SIDEBAR_MIN_WIDTH=252;
const SIDEBAR_MAX_WIDTH=336;
const SIDEBAR_COLLAPSE_DISTANCE=36;
const SIDEBAR_EXPAND_DISTANCE=12;
function readSavedWorkbenchState():SavedWorkbenchState{if(typeof document==="undefined")return {};try{return JSON.parse(localStorage.getItem("decision-workbench")||"{}")}catch{return {}}}
const initialEngagement:Record<string,EngagementState>={"JU87P01":"ACCEPTED","JNDLIXO":"ACCEPTED","JVS2PHH":"ACCEPTED","JPG4HAS":"VIEWED"};
const INITIAL_TRAY_IDS=Object.keys(initialEngagement).filter(id=>initialEngagement[id]==="ACCEPTED");
const initialEvents:Record<string,DecisionEvent[]>={"JU87P01":[{id:"evt-1",type:"已接单",at:"08-11 11:31"}],"JNDLIXO":[{id:"evt-3",type:"已接单",at:"08-11 13:42"}],"JVS2PHH":[{id:"evt-2",type:"已接单",at:"08-11 16:20"}]};
const initialOutcomes:Record<string,Outcome[]>={
 "JU87P01":[{id:"out-39ai-1",stage:"推荐采纳",rating:5,note:"已确认本轮由本人推进，等待客户回信。",at:"08-11 11:32"}],
 "JNDLIXO":[{id:"out-rainforest-1",stage:"反馈",rating:4,note:"已核验项目归属，下一步补齐负责人和 HC。",at:"08-11 13:44"}],
 "JVS2PHH":[{id:"out-1",stage:"面试",rating:4,note:"已完成首轮供给验证",at:"08-11 10:18"}],
};
function legalActions(job:DecisionJob,state:EngagementState):EngagementCommand[]{if(job.facts["职位关系"]==="未加入"||job.eligibility!=="ELIGIBLE")return [];if(state==="WATCHED")return ["UNWATCH","ACCEPT","DISMISS"];if(state==="ACCEPTED")return ["RELEASE","COMPLETE"];if(state==="RELEASED")return ["WATCH","DISMISS"];if(state==="DISMISSED")return ["WATCH"];if(state==="VIEWED"||state==="RECOMMENDED"||state==="NEW")return ["WATCH","DISMISS"];return []}
type EngagementPrerequisite={title:string;detail:string;action?:DecisionAction};
function engagementPrerequisite(job:DecisionJob,state:EngagementState):EngagementPrerequisite{
 const verify=job.actions.find(action=>action.kind==="verify");
 if(job.facts["职位关系"]==="未加入")return {title:"先确认项目归属",detail:"该职位尚未加入当前项目；完成核验前，关注与接单操作会保持关闭。",action:verify};
 if(job.eligibility==="VERIFY_REQUIRED")return {title:"先补齐关键事实",detail:"Offer、入职或剩余 HC 尚未确认，不能直接进入承接流程。",action:verify};
 if(job.eligibility==="BLOCKED")return {title:"当前承接受阻",detail:"前置条件未满足，暂时没有可执行的承接操作。"};
 if(job.eligibility==="EXCLUDED")return {title:"当前不进入承接",detail:"该职位已被排除，不会提供关注或接单操作。"};
 if(state==="DISMISSED")return {title:"已暂不考虑",detail:"已记录原因；如有新信号，可重新关注后再评估。"};
 if(state==="RELEASED")return {title:"已释放",detail:"该职位已从当前工作区释放；可重新关注后再接单。"};
 if(state==="COMPLETED")return {title:"已完成",detail:"该职位的本轮承接已经结束，结果已归档。"};
 return {title:"当前没有可执行操作",detail:"等待后端返回下一步允许动作。"};
}
function stateEvent(command:EngagementCommand){return ({WATCH:"已关注",UNWATCH:"已取消关注",ACCEPT:"已接单",DISMISS:"暂不考虑",RELEASE:"已释放",COMPLETE:"已完成"})[command]}
function nextState(command:EngagementCommand):EngagementState{return ({WATCH:"WATCHED",UNWATCH:"VIEWED",ACCEPT:"ACCEPTED",DISMISS:"DISMISSED",RELEASE:"RELEASED",COMPLETE:"COMPLETED"} as const)[command]}

export default function DecisionWorkbench(){
 const [hydrated,setHydrated]=useState(false);
 const [page,setPage]=useState<Page>("today");
 const [navOpen,setNavOpen]=useState(false);
 const [sidebarWidth,setSidebarWidth]=useState(280);
 const [sidebarResize,setSidebarResize]=useState<SidebarResize|null>(null);
 const [query,setQuery]=useState("");
 const [status,setStatus]=useState("全部状态");
 const [sort,setSort]=useState("score");
 const [view,setView]=useState<"list"|"rail">("list");
 const [selected,setSelected]=useState<Job["id"][]>([]);
 const [detail,setDetail]=useState<Job|null>(null);
 const [clientDetail,setClientDetail]=useState<typeof clients[number]|null>(null);
 const [drawer,setDrawer]=useState<string|null>(null);
 const [toast,setToast]=useState("");
 const [done,setDone]=useState<number[]>([]);
 const [snoozed,setSnoozed]=useState<number[]>([]);
 const [extraTasks,setExtraTasks]=useState<string[]>([]);
 const [weights,setWeights]=useState([60,25,15]);
 const [tray,setTray]=useState<string[]>([]);
 const [folders,setFolders]=useState<PickFolder[]>(DEFAULT_FOLDERS);
 const [folderMode,setFolderMode]=useState(false);
 const [eventType,setEventType]=useState("客户反馈");
 const [hc,setHc]=useState(3);
 const [panel,setPanel]=useState<Panel>(null);
 const [panelMotion,setPanelMotion]=useState<"idle"|"entering"|"open"|"closing">("idle");
 const panelAnimationFrame=useRef<number|null>(null);
 const panelCloseTimer=useRef<number|null>(null);
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
 // Brain X 后端连接态：connecting（探测中）→ connected（API 驱动）/ offline（演示模式回退）
 const [brainxMode,setBrainxMode]=useState<"connecting"|"connected"|"offline">("connecting");
 const [assistantOpen,setAssistantOpen]=useState(false);
 const [assistantMessages,setAssistantMessages]=useState<AssistantMessage[]>([]);
 const [assistantInput,setAssistantInput]=useState("");
 const [assistantBusy,setAssistantBusy]=useState(false);
 const [assistantSettings,setAssistantSettings]=useState(false);
 const [assistantKey,setAssistantKey]=useState("");
 const assistantAbort=useRef<AbortController|null>(null);
 const [brainxJobs,setBrainxJobs]=useState<DecisionJob[]|null>(null);
 const [brainxRun,setBrainxRun]=useState<{snapshotId:string|null;policyVersion:string|null}>({snapshotId:null,policyVersion:null});
 const [brainxDismissReasons,setBrainxDismissReasons]=useState<string[]>(FALLBACK_DISMISS_REASONS);
 const [brainxReplay,setBrainxReplay]=useState<Record<string,BrainxReplay>>({});
 const [brainxKeywords,setBrainxKeywords]=useState<string[]>([]);
 const [brainxNote,setBrainxNote]=useState("");
 const [brainxRadar,setBrainxRadar]=useState<Job[]|null>(null);
 const [brainxClients,setBrainxClients]=useState<Client[]|null>(null);
 const feedbackJob=async(job:DecisionJob)=>{const reason=window.prompt("为什么对这个职位不感兴趣？例如：方向不符、客户不熟、暂时不想做");if(!reason?.trim())return;try{if(brainxMode==="connected"){await sendRecommendationFeedback(job.id,reason.trim(),brainxRun.snapshotId,makeIdempotencyKey(`recommendation-feedback:${job.id}`))}setBrainxJobs(current=>current?current.filter(item=>item.id!==job.id):current);notify(brainxMode==="connected"?"已记录不感兴趣，并补充下一条候选":"演示模式已隐藏该职位（不会写入后端）")}catch(error){notify(`反馈失败：${error instanceof Error?error.message:"后端未响应"}`)}};
 const loadBrainxSide=useRef(async()=>{try{const [radar,clientsData]=await Promise.all([getRadar(),getClients()]);setBrainxRadar(radar.items.map(mapRadarRow) as unknown as Job[]);setBrainxClients(clientsData.items.map(mapClientRow) as unknown as Client[])}catch{/* 雷达/洞察加载失败不阻断决策主链路 */}});
 const brainxApply=useRef((snapshot:BrainxSnapshot)=>{setBrainxJobs(snapshot.jobs as DecisionJob[]);setEngagement(snapshot.engagement);setDecisionEvents(snapshot.events);setOutcomes(snapshot.outcomes);setSync(snapshot.sync);setAuth(snapshot.auth);setNotifications(snapshot.notifications);setBrainxDismissReasons(snapshot.dismissReasons);setBrainxRun({snapshotId:snapshot.snapshotId,policyVersion:snapshot.policyVersion});setBrainxKeywords(snapshot.profileKeywords);setBrainxMode("connected")});
 const loadBrainxSnapshot=useRef(async()=>{const snapshot=await getSnapshot();brainxApply.current(snapshot)});
 useEffect(()=>{const savedState=readSavedWorkbenchState();setDone(savedState.done||[]);setSnoozed(savedState.snoozed||[]);setExtraTasks(savedState.extraTasks||[]);setWeights(savedState.weights?.length===3?savedState.weights:[60,25,15]);setDecisionActions(savedState.decisionActions||[]);setSidebarWidth(savedState.sidebarWidth||280);setTray(savedState.tray??INITIAL_TRAY_IDS);setFolders(savedState.folders?.length?savedState.folders:DEFAULT_FOLDERS);setFolderMode(!!savedState.folderMode);setEngagement({...initialEngagement,...(savedState.engagement||{})});setDecisionEvents({...initialEvents,...(savedState.events||{})});setOutcomes({...initialOutcomes,...(savedState.outcomes||{})});setSync(savedState.sync||seedSync);setAuth(savedState.auth||seedAuth);setNotifications(savedState.notifications||seedNotifications);setHydrated(true)},[]);
 useEffect(()=>{if(!hydrated||brainxMode==="connected")return;localStorage.setItem("decision-workbench",JSON.stringify({done,snoozed,extraTasks,weights,decisionActions,sidebarWidth,tray,folders,folderMode,engagement,events:decisionEvents,outcomes,sync,auth,notifications}))},[hydrated,brainxMode,done,snoozed,extraTasks,weights,decisionActions,sidebarWidth,tray,folders,folderMode,engagement,decisionEvents,outcomes,sync,auth,notifications]);
 // 后端探测与快照引导：仅浏览器端；成功 → connected（API 驱动），失败 → offline（本地演示回退）。
 // localStorage 仅作演示回退与乐观缓存，连接后端后不写入本地业务状态。
 useEffect(()=>{if(!hydrated)return;let cancelled=false;void(async()=>{try{await brainxFetch<BackendSessionStatus>("/api/v1/oauth/status");const snapshot=await getSnapshot();if(!cancelled)brainxApply.current(snapshot);void loadBrainxSide.current()}catch{if(!cancelled)setBrainxMode("offline")}})();return()=>{cancelled=true}},[hydrated]);
 // SSE 实时通知：同步/推荐事件 → 去抖刷新快照并插入提醒；组件卸载关闭连接
 useEffect(()=>{if(brainxMode!=="connected")return;const sub=connectSSE(event=>{if(!event.type||event.type==="hello")return;const title=event.type==="sync_error"?"同步异常":event.type==="recommend"?"推荐已更新":"同步完成";setNotifications(current=>[{id:`sse-${Date.now()}`,kind:"SYNC_ALERT",title,detail:String(event.message||""),read:false},...current]);window.setTimeout(()=>{void loadBrainxSnapshot.current().catch(()=>{});void loadBrainxSide.current()},800)});return()=>sub.close()},[brainxMode]);
useEffect(()=>{if(!sidebarResize)return;const delta=(event:PointerEvent)=>event.clientX-sidebarResize.startX;const rawWidth=(event:PointerEvent)=>sidebarResize.startWidth+delta(event);const move=(event:PointerEvent)=>{if(sidebarResize.opensCollapsed){if(delta(event)<SIDEBAR_EXPAND_DISTANCE)return;setNavOpen(true);setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH,Math.max(SIDEBAR_MIN_WIDTH,SIDEBAR_MIN_WIDTH+delta(event)-SIDEBAR_EXPAND_DISTANCE)));return}setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH,Math.max(SIDEBAR_MIN_WIDTH,rawWidth(event))))};const stop=(event:PointerEvent)=>{if(sidebarResize.opensCollapsed){if(event.type==="pointerup"&&delta(event)>=SIDEBAR_EXPAND_DISTANCE)setNavOpen(true);setSidebarResize(null);return}if(event.type==="pointerup"&&rawWidth(event)<SIDEBAR_MIN_WIDTH-SIDEBAR_COLLAPSE_DISTANCE)setNavOpen(false);setSidebarResize(null)};window.addEventListener("pointermove",move);window.addEventListener("pointerup",stop);window.addEventListener("pointercancel",stop);return()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",stop);window.removeEventListener("pointercancel",stop)}},[sidebarResize]);
 const notify=(s:string)=>{setToast(s);setTimeout(()=>setToast(""),2200)};
 const radarJobs:Job[]=brainxMode==="connected"&&brainxRadar?brainxRadar:demoRadarJobs;
 const filteredJobs=useMemo(()=>radarJobs.filter(job=>(status==="全部状态"||job.status===status)&&(`${job.name}${job.client}${job.city}${job.industry}${job.positionType}${job.source}`.includes(query))).sort((a,b)=>sort==="score"?(b.score??-1)-(a.score??-1):(b.hc??-1)-(a.hc??-1)),[query,status,sort,radarJobs]);
 const visibleActions=actionSeed.map((a,i)=>({a,i})).filter(x=>!done.includes(x.i)&&!snoozed.includes(x.i));
 const clearPanelMotion=()=>{if(typeof window==="undefined")return;if(panelAnimationFrame.current!==null){window.cancelAnimationFrame(panelAnimationFrame.current);panelAnimationFrame.current=null}if(panelCloseTimer.current!==null){window.clearTimeout(panelCloseTimer.current);panelCloseTimer.current=null}};
 const dismissPanelImmediately=()=>{clearPanelMotion();setPanel(null);setPanelMotion("idle")};
 const openPanel=(next:Panel)=>{if(!next)return;clearPanelMotion();if(panel&&panelMotion==="open"){setPanel(next);return}const animate=typeof window!=="undefined"&&window.matchMedia("(min-width: 961px)").matches;if(panelMotion==="closing"){setPanel(next);setPanelMotion("open");return}setPanel(next);if(!animate){setPanelMotion("open");return}setPanelMotion("entering");panelAnimationFrame.current=window.requestAnimationFrame(()=>{panelAnimationFrame.current=window.requestAnimationFrame(()=>{setPanelMotion("open");panelAnimationFrame.current=null})})};
 const closePanel=()=>{if(!panel)return;clearPanelMotion();const animate=typeof window!=="undefined"&&window.matchMedia("(min-width: 961px)").matches;if(!animate){dismissPanelImmediately();return}setPanelMotion("closing");panelCloseTimer.current=window.setTimeout(()=>{setPanel(null);setPanelMotion("idle");panelCloseTimer.current=null},380)};
 useEffect(()=>{const closeOnEscape=(event:KeyboardEvent)=>{if(event.key!=="Escape")return;closePanel();setPendingCommand(null);setDrawer(null);setDetail(null);setClientDetail(null);setMobileNavOpen(false)};window.addEventListener("keydown",closeOnEscape);return()=>window.removeEventListener("keydown",closeOnEscape)},[panel,panelMotion]);
 useEffect(()=>()=>clearPanelMotion(),[]);
 const go=(p:Page)=>{setPage(p);setDetail(null);setClientDetail(null);dismissPanelImmediately();setDrawer(null);setMobileNavOpen(false)};
 useEffect(()=>{try{const saved=localStorage.getItem("brainx-assistant-history");if(saved)setAssistantMessages(JSON.parse(saved))}catch{}},[]);
 useEffect(()=>{try{setAssistantKey(localStorage.getItem("brainx-deepseek-key")||"")}catch{}},[]);
 useEffect(()=>{try{localStorage.setItem("brainx-assistant-history",JSON.stringify(assistantMessages.slice(-40)))}catch{}},[assistantMessages]);
 useEffect(()=>()=>assistantAbort.current?.abort(),[]);
 const sendAssistant=()=>{const question=assistantInput.trim();if(!question||assistantBusy)return;const user:AssistantMessage={role:"user",content:question};const controller=new AbortController();assistantAbort.current=controller;setAssistantInput("");setAssistantBusy(true);setAssistantMessages(current=>[...current,user,{role:"assistant",content:""}]);void streamAssistant({question,history:assistantMessages.slice(-12),context:{page,opportunity_id:selectedDecisionJob?.id||null},api_key:assistantKey||undefined,signal:controller.signal},text=>setAssistantMessages(current=>{const next=[...current];const last=next.length-1;if(last>=0&&next[last].role==="assistant")next[last]={...next[last],content:next[last].content+text};return next}),message=>setAssistantMessages(current=>{const next=[...current];const last=next.length-1;if(last>=0&&next[last].role==="assistant")next[last]={...next[last],content:message};return next})).catch(error=>{if(error?.name!=="AbortError")setAssistantMessages(current=>{const next=[...current];const last=next.length-1;if(last>=0&&next[last].role==="assistant")next[last]={...next[last],content:`助手暂不可用：${error instanceof Error?error.message:"后端未响应"}`};return next})}).finally(()=>{assistantAbort.current=null;setAssistantBusy(false)})};
 const runDecisionAction=(job:DecisionJob,action:DecisionAction)=>{const key=`${job.id}:${action.id}`;if(decisionActions.includes(key))return;const at=new Date().toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});setDecisionActions(v=>[...v,key]);setDecisionEvents(current=>({...current,[job.id]:[{id:`evt-${Date.now()}`,type:action.label,at,reason:action.detail},...(current[job.id]||[])]}));if(action.kind==="verify")window.dispatchEvent(new CustomEvent("brainx:edit-facts",{detail:job.id}));notify(`已记录：${action.label}`)};
 const toggleTray=(id:string)=>{setTray(current=>{const next=current.includes(id)?current.filter(x=>x!==id):[...current,id];notify(next.includes(id)?"已加入精选盘":"已移出精选盘");return next})};
 const removeTray=(id:string)=>{setTray(current=>current.filter(x=>x!==id));notify("已移出精选盘")};
 const assignFolder=(jobId:string,folderId:string)=>{setFolders(current=>current.map(f=>f.id===folderId?{...f,jobIds:Array.from(new Set([...f.jobIds,jobId]))}:{...f,jobIds:f.jobIds.filter(x=>x!==jobId)}));setTray(current=>current.filter(x=>x!==jobId));notify(folderId?"已放入文件夹":"已从文件夹移除")};
 const createFolder=(name:string)=>{const trimmed=name.trim();if(!trimmed)return;setFolders(current=>[...current,{id:`f-${Date.now()}`,name:trimmed,jobIds:[]}]);notify(`已新建文件夹「${trimmed}」`)};
 const confirmTray=async()=>{const jobs=activeDecisionJobs.filter(job=>tray.includes(job.id)&&(engagement[job.id]||"NEW")!=="ACCEPTED");if(!jobs.length){notify("盘里的职位都已接单");return}let done=0,skipped=0;for(const job of jobs){const state=engagement[job.id]||"NEW";const legal=legalActions(job,state);if(!legal.includes("ACCEPT")&&!legal.includes("WATCH")){skipped++;continue}if(brainxMode!=="connected"){if(legal.includes("WATCH"))applyCommand(job,"WATCH");applyCommand(job,"ACCEPT");done++;continue}try{const url=`/api/v1/opportunities/${encodeURIComponent(job.id)}/engagement`;if(legal.includes("WATCH"))await brainxFetch<BackendEngagementResponse>(url,{method:"POST",body:{action:"WATCH",idempotency_key:makeIdempotencyKey(`tray-watch:${job.id}`)}});const res=await brainxFetch<BackendEngagementResponse>(url,{method:"POST",body:{action:"ACCEPT",confirm:true,idempotency_key:makeIdempotencyKey(`tray-accept:${job.id}`)}});setEngagement(current=>({...current,[job.id]:res.state}));done++}catch{skipped++}}if(done)notify(`已确定 ${done} 个职位接单${skipped?` · ${skipped} 个需先核验`:""}`);else notify("没有可确定的职位：先完成核验，或盘已空")};
 const activeDecisionJobs=brainxJobs||decisionJobs;
 const refreshBrainxJob=async(jobId:string)=>{if(brainxMode!=="connected")return;try{const detail=await fetchJobDetail(jobId);setEngagement(current=>({...current,[jobId]:detail.engagementState}));setDecisionEvents(current=>({...current,[jobId]:detail.events}));setOutcomes(current=>({...current,[jobId]:detail.outcomes}));setBrainxJobs(current=>current?current.map(job=>job.id===jobId?{...job,brainxLegal:detail.legal,brainxDecisionId:detail.decisionId||job.brainxDecisionId}:job):null)}catch{/* 详情刷新失败不打断交互，下次打开再试 */}};
 const openDecision=(job:DecisionJob,tab:"judgement"|"engagement"|"trail"|"replay"="judgement")=>{if(panel?.kind==="job"&&panel.jobId===job.id&&panel.tab===tab&&panelMotion!=="closing"){closePanel();return}if(brainxMode==="connected")void brainxFetch<BackendEngagementResponse>(`/api/v1/opportunities/${encodeURIComponent(job.id)}/engagement`,{method:"POST",body:{action:"VIEW",idempotency_key:makeIdempotencyKey(`view:${job.id}`)}}).catch(()=>{});openPanel({kind:"job",jobId:job.id,tab})};
 const applyCommand=(job:DecisionJob,command:EngagementCommand,reason?:string)=>{if(brainxMode!=="connected"){const state=nextState(command);setEngagement(current=>({...current,[job.id]:state}));setDecisionEvents(current=>({...current,[job.id]:[{id:`evt-${Date.now()}`,type:stateEvent(command),at:new Date().toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}),reason},...(current[job.id]||[])]}));setPendingCommand(null);notify(`${job.company} · ${stateEvent(command)}`);return}const key=makeIdempotencyKey(`engage:${job.id}:${command}`);setPendingCommand(null);void(async()=>{try{const res=await brainxFetch<BackendEngagementResponse>(`/api/v1/opportunities/${encodeURIComponent(job.id)}/engagement`,{method:"POST",body:{action:command,confirm:command==="ACCEPT",reason,idempotency_key:key}});setEngagement(current=>({...current,[job.id]:res.state}));await refreshBrainxJob(job.id);notify(`${job.company} · ${stateEvent(command)}`)}catch(error){notify(`操作失败：${error instanceof Error?error.message:"后端未响应"}`)}})()};
 const requestCommand=(job:DecisionJob,command:EngagementCommand)=>{if(command==="ACCEPT"||command==="DISMISS"){setPendingCommand({job,command});return}applyCommand(job,command)};
 const recordOutcome=(job:DecisionJob,stage:Outcome["stage"],rating?:number,note?:string)=>{if(brainxMode!=="connected"){const item:Outcome={id:`out-${Date.now()}`,stage,rating,note,at:new Date().toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})};setOutcomes(current=>({...current,[job.id]:[item,...(current[job.id]||[])]}));setDecisionEvents(current=>({...current,[job.id]:[{id:`evt-${Date.now()}`,type:"记录结果",at:item.at,reason:stage},...(current[job.id]||[])]}));notify(`已记录${stage}`);return}void(async()=>{try{await brainxFetch<BackendOutcomeResponse>("/api/v1/outcomes",{method:"POST",body:{project_id:job.id,stage,value:{rating,note},idempotency_key:makeIdempotencyKey(`outcome:${job.id}`)}});await refreshBrainxJob(job.id);notify(`已记录${stage}`)}catch(error){notify(`记录失败：${error instanceof Error?error.message:"后端未响应"}`)}})()};
 const runSync=()=>{void(async()=>{if(brainxMode!=="connected"){setSync(current=>({...current,state:"RUNNING",errors:[]}));notify("正在生成演示快照…");window.setTimeout(()=>{setSync({...seedSync,updatedAt:new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})});notify("快照已更新，推荐已刷新")},650);return}setSync(current=>({...current,state:"RUNNING",errors:[]}));notify("正在同步后端快照…");try{await brainxFetch("/api/v1/sync-runs",{method:"POST",body:{source:"fixture"}});const rec=await brainxFetch<BackendRecommendationRun>("/api/v1/recommendations/run",{method:"POST"});if(rec?.blocked){setSync(current=>({...current,state:"INCOMPLETE",errors:[rec.reason||"本次同步不完整"]}));notify(rec.reason||"本次同步不完整");return}await loadBrainxSnapshot.current();void loadBrainxSide.current();notify("快照已更新，推荐已刷新")}catch(error){setSync(current=>({...current,state:"ERROR",errors:[error instanceof Error?error.message:"同步失败"]}));notify(`同步失败：${error instanceof Error?error.message:"后端未响应"}`)}})()};
 const openNotification=(item:Notification)=>{setNotifications(current=>current.map(note=>note.id===item.id?{...note,read:true}:note));if(item.jobId){const job=activeDecisionJobs.find(entry=>entry.id===item.jobId);if(job)openDecision(job,item.kind==="DAILY_TOP3"?"replay":"engagement")}else openPanel({kind:"sync"})};
 const startSidebarResize=(event:React.PointerEvent<HTMLDivElement>)=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);const opensCollapsed=!navOpen;setSidebarResize({startX:event.clientX,startWidth:opensCollapsed?SIDEBAR_MIN_WIDTH:sidebarWidth,opensCollapsed})};
 const resizeFromKeyboard=(event:React.KeyboardEvent<HTMLDivElement>)=>{if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;event.preventDefault();if(!navOpen&&event.key==="ArrowRight"){setSidebarWidth(SIDEBAR_MIN_WIDTH);setNavOpen(true);return}setSidebarWidth(width=>Math.min(SIDEBAR_MAX_WIDTH,Math.max(SIDEBAR_MIN_WIDTH,width+(event.key==="ArrowRight"?16:-16))))};
 const selectedDecisionJob=panel?.kind==="job"?[...activeDecisionJobs,...verificationJobs].find(job=>job.id===panel.jobId)||null:null;
 const commitmentJobs=activeDecisionJobs.filter(job=>["WATCHED","ACCEPTED"].includes(engagement[job.id]||"NEW"));
 const acceptedJobs=activeDecisionJobs.filter(job=>engagement[job.id]==="ACCEPTED");
 const visibleAcceptedJobs=useMemo(()=>{
  const keyword=query.trim().toLocaleLowerCase();
  if(!keyword)return acceptedJobs;
  return acceptedJobs.filter(job=>`${job.company} ${job.role} ${job.recentSignal} ${Object.values(job.facts).join(" ")}`.toLocaleLowerCase().includes(keyword));
 },[acceptedJobs,query]);
 const panelPresent=!!panel;
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
 return <div className={`app btex-app ${navOpen?"nav-open":""} ${assistantOpen?"assistant-open":""} ${panelMotion==="open"?"decision-panel-open":""} ${panelPresent?"decision-panel-present decision-panel-compact":""} panel-motion-${panelMotion} ${sidebarResize?"is-resizing":""} ${mobileNavOpen?"mobile-nav-open":""} ${mobileDrawerDrag.current?"mobile-nav-swiping":""}`} style={{"--sidebar-width":`${navOpen?sidebarWidth:68}px`,"--mobile-drawer-progress":mobileDrawerProgress??1} as React.CSSProperties} onPointerDown={beginMobileSwipe} onPointerMove={moveMobileSwipe} onPointerUp={event=>endMobileSwipe(event)} onPointerCancel={event=>endMobileSwipe(event,true)}>
  <aside className="rail-nav" aria-label="主要导航">
   <button className="rail-brand" onClick={()=>go("today")} aria-label="B-tex 首页"><span className="rail-brand-mark"><Infinity aria-hidden="true"/></span></button>
   <nav className="rail-blocks">{nav.map(([id,label,Icon])=><button key={id} className={page===id?"active":""} onClick={()=>go(id)} aria-label={label} aria-current={page===id?"page":undefined}><span className="rail-ico"><Icon/></span><span className="rail-label">{label}</span></button>)}</nav>
   <div className="rail-spacer"/>
   {acceptedJobs.length>0&&<nav className="rail-blocks rail-confirmed" aria-label="已确定职位"><button className={page==="accepted"?"active":""} onClick={()=>go("accepted")} aria-label={`已确定 ${acceptedJobs.length} 个`} aria-current={page==="accepted"?"page":undefined}><span className="rail-ico"><CheckCircle2/></span><span className="rail-label">已确定</span><i className="rail-count">{acceptedJobs.length}</i></button></nav>}
   <nav className="rail-blocks rail-utils">{navUtils.map(([id,label,Icon])=><button key={id} className={page===id?"active":""} onClick={()=>go(id)} aria-label={label} aria-current={page===id?"page":undefined}><span className="rail-ico"><Icon/></span><span className="rail-label">{label}</span></button>)}</nav>
   <button className="rail-person identity-trigger" onClick={()=>openPanel({kind:"identity"})} aria-label={`身份：${auth.consultant}`}><CircleUserRound/><span className="rail-person-dot"/></button>
   <span className="rail-status" title={brainxMode==="connected"?"BrainX 已连接":brainxMode==="connecting"?"连接 BrainX…":"演示模式"}><i className="pulse"/></span>
  </aside>
  <button className="mobile-nav-trigger" onClick={toggleMobileDrawer} aria-label={mobileNavOpen?"收起全部模块":"打开全部模块"} aria-expanded={mobileNavOpen}><Infinity aria-hidden="true"/><span>{mobileNavOpen?"收起模块":"全部模块"}</span></button>
  {mobileNavOpen&&<button className="mobile-nav-backdrop" onClick={()=>closeMobileDrawer()} aria-label="关闭全部模块"/>}
  <main className="main">
   <header className="topbar">
    {page==="today"?<><button className="btex-person identity-trigger" onClick={()=>openPanel({kind:"identity"})}><CircleUserRound/>{auth.consultant}</button><button className={`sync sync-trigger ${auth.needsReauth?"auth_expired":sync.state.toLowerCase()}`} onClick={()=>openPanel(auth.needsReauth?{kind:"identity"}:{kind:"sync"})}><i/> {auth.needsReauth?"飞书授权已过期":sync.state==="READY"?`Snapshot #${brainxMode==="connected"&&brainxRun.snapshotId?brainxRun.snapshotId.slice(0,8):"1842"} · ${sync.updatedAt} 已同步`:sync.state==="RUNNING"?"同步中…":sync.state==="INCOMPLETE"?"本次同步不完整":sync.state==="AUTH_EXPIRED"?"飞书授权已过期":sync.state==="ERROR"?"同步失败":"尚未同步"}</button><button className="mobile-commitment-trigger" onClick={()=>openPanel({kind:"commitments"})} aria-label={`我的承接 ${commitmentJobs.length} 个`}><BriefcaseBusiness/><i>{commitmentJobs.length}</i></button><button className="icon-btn notification-trigger" onClick={()=>openPanel({kind:"notifications"})} aria-label="今日提醒"><BellRing/>{notifications.filter(note=>!note.read).length>0&&<i>{notifications.filter(note=>!note.read).length}</i>}</button></>:<><div className="search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索客户、职位、PM…"/></div><button className="top-pill" onClick={()=>notify("全局筛选已展开")}><Filter/> 当前团队 <ChevronRight/></button><span className="sync">更新于 14:32 · 7个来源</span><button className="icon-btn" onClick={()=>openPanel({kind:"notifications"})} aria-label="通知"><Bell/></button></>}
    <button className={`profile-trigger ${page==="rules"?"active":""}`} onClick={()=>go("rules")} aria-label="打开岗位画像"><SlidersHorizontal/><span>岗位画像</span></button><button className={`assistant-trigger ${assistantOpen?"active":""}`} onClick={()=>setAssistantOpen(value=>!value)} aria-label="打开 BrainX 助手" aria-expanded={assistantOpen}><Sparkles/><span>BrainX 助手</span></button>
   </header>
   <div className="content">
    {detail?<JobDetail job={detail} onBack={()=>setDetail(null)} weights={weights} eventType={eventType} setEventType={setEventType} hc={hc} setHc={setHc} notify={notify}/>:clientDetail?<ClientDetail c={clientDetail} onBack={()=>setClientDetail(null)} notify={notify}/>:<>
     {page==="today"&&<DecisionToday activeJobId={panel?.kind==="job"&&panelMotion!=="closing"?panel.jobId:null} completed={decisionActions} jobs={activeDecisionJobs} engagement={engagement} sync={sync} open={openDecision} onAction={runDecisionAction} onFeedback={feedbackJob} showVerification={brainxMode!=="connected"} tray={tray} onToggleTray={toggleTray} onRemoveTray={removeTray} onConfirmTray={confirmTray} folders={folders} folderMode={folderMode} onFolderMode={()=>setFolderMode(v=>!v)} onAssignFolder={assignFolder} onCreateFolder={createFolder}/>}
     {page==="accepted"&&<AcceptedJobsView jobs={visibleAcceptedJobs} total={acceptedJobs.length} query={query} open={openDecision}/>}
     {page==="jobs"&&<JobsView jobs={filteredJobs} mode={brainxMode} status={status} setStatus={setStatus} sort={sort} setSort={setSort} view={view} setView={setView} selected={selected} setSelected={setSelected} openJob={setDetail} notify={notify}/>}
     {page==="clients"&&<ClientsView clients={(brainxMode==="connected"&&brainxClients?brainxClients:clients).filter(c=>`${c.name}${c.industry}`.includes(query))} open={setClientDetail} notify={notify}/>}
     {page==="alerts"&&<Alerts setExtraTasks={setExtraTasks} notify={notify} setDrawer={setDrawer}/>}
     {page==="rules"&&<Rules weights={weights} setWeights={setWeights} notify={notify} mode={brainxMode} policy={brainxRun.policyVersion} keywords={brainxKeywords} note={brainxNote} onSaveKeywords={(k:string[],n:string)=>void(async()=>{try{await brainxFetch<BackendProfileUpdate>("/api/v1/profile",{method:"PUT",body:{profile_keywords:k,profile_note:n}});setBrainxKeywords(k);setBrainxNote(n);notify("画像已保存；下一轮推荐将生效")}catch(error){notify(`保存失败：${error instanceof Error?error.message:"后端未响应"}`)}})()}/>}
     {page==="sources"&&<Sources notify={notify}/>}
    </>}
   </div>
  </main>
     {panel&&<WorkbenchPanel panel={panel} motion={panelMotion} job={selectedDecisionJob} commitmentJobs={commitmentJobs} auth={auth} sync={sync} notifications={notifications} engagement={engagement} events={decisionEvents} outcomes={outcomes} completed={decisionActions} mode={brainxMode} legalMap={brainxJobs?Object.fromEntries(activeDecisionJobs.map(job=>[job.id,job.brainxLegal||[]])):{}} replayMap={brainxReplay} dismissReasons={brainxDismissReasons} onReplay={(jobId,data)=>setBrainxReplay(current=>({...current,[jobId]:data}))} onFactsUpdated={async()=>{await loadBrainxSnapshot.current();void loadBrainxSide.current()}} onClose={closePanel} onOpenJob={openDecision} onAction={runDecisionAction} onCommand={requestCommand} onOutcome={recordOutcome} onSync={runSync} onSetSync={setSync} onAuth={setAuth} onNotification={openNotification} notify={notify}/>}
  {assistantOpen&&<ChatbotDrawer messages={assistantMessages} input={assistantInput} setInput={setAssistantInput} busy={assistantBusy} onSend={sendAssistant} onStop={()=>assistantAbort.current?.abort()} onClear={()=>setAssistantMessages([])} onClose={()=>setAssistantOpen(false)} mode={brainxMode} page={page} settings={assistantSettings} setSettings={setAssistantSettings} apiKey={assistantKey} setApiKey={key=>{setAssistantKey(key);try{localStorage.setItem("brainx-deepseek-key",key)}catch{}}}/>}
  {pendingCommand&&<CommandConfirm pending={pendingCommand} reasons={brainxDismissReasons} onClose={()=>setPendingCommand(null)} onConfirm={(reason?:string)=>applyCommand(pendingCommand.job,pendingCommand.command,reason)}/>}
  {drawer&&<><div className="drawer-backdrop" onClick={()=>setDrawer(null)}/><aside className="drawer"><button className="icon-btn" style={{float:"right"}} onClick={()=>setDrawer(null)}><X/></button><span className="eyebrow">Decision evidence</span><h2>判断依据</h2><div className="conclusion"><div className="spark"><Sparkles/></div><div><b>{drawer}</b><p>综合规则计算与AI结构化推断，置信度 91%</p></div></div><div className="score-bars">{["客户招聘意愿 18/20","职位新鲜度 14/15","HC与紧急程度 15/15","客户反馈速度 14/15","转化表现 16/20","竞争与风险 12/15"].map((x,i)=><div className="mini-item" key={x}><span className="num">0{i+1}</span><div><b>{x}</b><p>{i<4?"规则计算 · 内部项目驾驶舱":"AI推断 · 基于近30天事件"}</p></div></div>)}</div><button className="btn primary" style={{marginTop:18}} onClick={()=>{setDrawer(null);notify("依据已复制到项目备注")}}>复制到项目备注</button></aside></>}
  {toast&&<div className="toast"><Check/> {toast}</div>}
 </div>
}

function ChatbotDrawer({messages,input,setInput,busy,onSend,onStop,onClear,onClose,mode,page,settings,setSettings,apiKey,setApiKey}:{messages:AssistantMessage[];input:string;setInput:(value:string)=>void;busy:boolean;onSend:()=>void;onStop:()=>void;onClear:()=>void;onClose:()=>void;mode:"connecting"|"connected"|"offline";page:Page;settings:boolean;setSettings:(value:boolean)=>void;apiKey:string;setApiKey:(value:string)=>void}){
 return <><div className="assistant-backdrop" onClick={onClose}/><aside className="assistant-drawer" aria-label="BrainX 助手"><header><div><h2>问问 BrainX</h2></div><button className="icon-btn" onClick={onClose} aria-label="关闭助手"><X/></button></header>{settings&&<div className="assistant-settings"><div className="assistant-settings-title"><b>DeepSeek 设置</b><button className="icon-btn" onClick={()=>setSettings(false)} aria-label="关闭设置"><X/></button></div><label>API Key<input type="password" value={apiKey} onChange={event=>setApiKey(event.target.value)} placeholder="sk-…" autoComplete="off"/></label><small>仅保存在当前浏览器，不会写入项目代码。</small></div>}<div className="assistant-messages" aria-live="polite">{messages.map((message,index)=><div className={`assistant-message ${message.role}`} key={`${index}-${message.role}`}><span>{message.role==="user"?"你":"BrainX"}</span><p>{message.content|| (busy&&index===messages.length-1?"正在思考…":"")}</p></div>)}</div><form className="assistant-compose" onSubmit={event=>{event.preventDefault();onSend()}}><textarea value={input} onChange={event=>setInput(event.target.value)} placeholder="询问当前工作台…" rows={2} disabled={busy&&mode!=="connected"}/><div><button type="button" className="assistant-clear" onClick={onClear}>清空</button><button type="button" className="assistant-gear" onClick={()=>setSettings(!settings)} aria-label="DeepSeek 设置"><Settings2/></button>{busy?<button type="button" className="btn" onClick={onStop}>停止</button>:<button type="submit" className="btn primary" disabled={!input.trim()||mode!=="connected"}><Send/>发送</button>}</div></form></aside></>}
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

function AcceptedJobsView({jobs,total,query,open}:{jobs:DecisionJob[];total:number;query:string;open:(job:DecisionJob,tab?:"judgement"|"engagement"|"trail"|"replay")=>void}){
 const isFiltered=Boolean(query.trim());
 return <div className="decision-home accepted-home">
  <Heading code="ACCEPTED / ACTIVE DELIVERY" title="已确定" desc="这里集中显示你已经确认接单、正在推进的职位。"/>
  <section className="accepted-summary"><div><span>{isFiltered?"当前显示":"当前已确定"}</span><b>{isFiltered?`${jobs.length}/${total}`:total}</b><small>{isFiltered?"个匹配职位":"个职位进入交付列表"}</small></div><p>从精选盘点击“确定”后的职位，会在这里持续跟进。</p></section>
  <div className="accepted-list">{jobs.length?jobs.map(job=><article className="accepted-card" key={job.id}>
   <div className="accepted-card-top"><span>{decisionGroupMeta[job.group].title}</span><strong>{job.finalScore}</strong></div>
   <h2>{job.company}</h2><p>{job.role}</p>
   <div className="accepted-card-fact"><span>当前进度</span><b>{job.recentSignal}</b></div>
   <button className="accepted-card-action" onClick={()=>open(job,"engagement")}>打开承接与结果 <ChevronRight/></button>
  </article>):<div className="empty accepted-empty"><Search/><b>没有匹配的已确定职位</b><p>试试输入公司名、职位名或当前阶段。</p></div>}</div>
 </div>;
}

function DecisionToday({activeJobId,completed,jobs,engagement,sync,open,onAction,onFeedback,showVerification=true,tray,onToggleTray,onRemoveTray,onConfirmTray,folders,folderMode,onFolderMode,onAssignFolder,onCreateFolder}:{activeJobId:string|null;completed:string[];jobs:DecisionJob[];engagement:Record<string,EngagementState>;sync:SyncStatus;open:(job:DecisionJob,tab?:"judgement"|"engagement"|"trail"|"replay")=>void;onAction:(job:DecisionJob,action:DecisionAction)=>void;onFeedback:(job:DecisionJob)=>void;showVerification?:boolean;tray:string[];onToggleTray:(id:string)=>void;onRemoveTray:(id:string)=>void;onConfirmTray:()=>void;folders:PickFolder[];folderMode:boolean;onFolderMode:()=>void;onAssignFolder:(jobId:string,folderId:string)=>void;onCreateFolder:(name:string)=>void}){
 const acceptedJobs=jobs.filter(job=>engagement[job.id]==="ACCEPTED");
 const pendingJobs=[...jobs.filter(job=>engagement[job.id]!=="ACCEPTED"),...verificationJobs];
 const pendingShown=showVerification?pendingJobs:pendingJobs.filter(job=>!verificationJobs.includes(job));
 const allJobs=[...acceptedJobs,...pendingShown];
 const trayJobs=tray.map(id=>allJobs.find(job=>job.id===id)).filter((job):job is DecisionJob=>!!job);
 const isContext=activeJobId!==null&&pendingShown.some(job=>job.id===activeJobId);
  return <div className="decision-home">
  <PickTray trayJobs={trayJobs} allJobs={allJobs} folderMode={folderMode} onFolderMode={onFolderMode} folders={folders} onRemoveTray={onRemoveTray} onConfirmTray={onConfirmTray} onAssignFolder={onAssignFolder} onCreateFolder={onCreateFolder} open={open}/>
  {sync.state==="INCOMPLETE"||sync.state==="ERROR"?<section className="decision-blocked"><AlertTriangle/><div><b>{sync.state==="INCOMPLETE"?"本次同步不完整":"同步失败"}</b><p>为避免误导，当前不展示新的项目判断。</p></div><button className="btn" onClick={()=>open(jobs[0],"judgement")}>查看上次快照</button></section>:<DecisionZone tone="pending" title="未接单" subtitle="" jobs={pendingShown} isContext={isContext} completed={completed} engagement={engagement} open={open} onAction={onAction} onFeedback={onFeedback} tray={tray} onToggleTray={onToggleTray} folderMode={folderMode} folders={folders} onAssignFolder={onAssignFolder}/>}
  </div>
}

function PickTray({trayJobs,allJobs,folderMode,onFolderMode,folders,onRemoveTray,onConfirmTray,onAssignFolder,onCreateFolder,open}:{trayJobs:DecisionJob[];allJobs:DecisionJob[];folderMode:boolean;onFolderMode:()=>void;folders:PickFolder[];onRemoveTray:(id:string)=>void;onConfirmTray:()=>void;onAssignFolder:(jobId:string,folderId:string)=>void;onCreateFolder:(name:string)=>void;open:(job:DecisionJob)=>void}){
 if(folderMode)return <section className="pick-tray folder-mode" aria-label="职位文件夹">
  <div className="pick-tray-head"><div className="pick-tray-title"><span className="decision-zone-kicker">PICK FOLDERS</span><b>文件夹</b></div><button className="btn quiet" onClick={onFolderMode}><Sparkles/>返回精选盘</button></div>
  <div className="folder-create"><FolderPlus/><input className="field" placeholder="新建文件夹，如：周末回访" aria-label="新建文件夹名称" onKeyDown={e=>{const t=e.target as HTMLInputElement;if(e.key==="Enter"&&t.value.trim()){onCreateFolder(t.value);t.value=""}}}/><button className="btn" onClick={e=>{const input=(e.currentTarget.parentElement as HTMLElement).querySelector("input") as HTMLInputElement;if(input.value.trim()){onCreateFolder(input.value);input.value=""}}}>新建</button></div>
  <div className="folder-strips">{folders.map(f=><FolderStrip key={f.id} folder={f} jobs={allJobs.filter(j=>f.jobIds.includes(j.id))} open={open} onRemove={jobId=>onAssignFolder(jobId,"")}/>)}</div>
 </section>;
 return <section className="pick-tray" aria-label="精选盘">
  <div className="pick-tray-head"><div className="pick-tray-title"><span className="decision-zone-kicker">MY PICK TRAY</span><b>精选盘</b><em>{trayJobs.length} 盘</em></div><div className="pick-tray-actions"><button className="btn quiet" onClick={onFolderMode}><FolderOpen/>文件夹模式</button><button className="btn primary" onClick={onConfirmTray} disabled={trayJobs.length===0}><Check/>确定</button></div></div>
  {trayJobs.length>0&&<div className="pick-tray-plates">{trayJobs.map(job=><PlateChip key={job.id} job={job} open={open} onRemove={onRemoveTray}/>)}</div>}
 </section>
}

function PlateChip({job,open,onRemove}:{job:DecisionJob;open:(job:DecisionJob)=>void;onRemove:(id:string)=>void}){
 return <div className="plate"><button className="plate-open" onClick={()=>open(job)}><b>{job.company}</b><small>{job.role}</small></button><span className="plate-score">{job.finalScore}</span><button className="plate-remove" onClick={()=>onRemove(job.id)} aria-label={`从精选盘移除 ${job.company}`}><X/></button></div>
}

function FolderStrip({folder,jobs,open,onRemove}:{folder:PickFolder;jobs:DecisionJob[];open:(job:DecisionJob)=>void;onRemove:(jobId:string)=>void}){
 const track=useRef<HTMLDivElement>(null);
 const drag=useRef<{pointerId:number;startX:number;scrollLeft:number;moved:boolean}|null>(null);
 const start=(e:React.PointerEvent<HTMLDivElement>)=>{if(e.button!==0)return;const el=track.current;if(!el)return;drag.current={pointerId:e.pointerId,startX:e.clientX,scrollLeft:el.scrollLeft,moved:false};el.classList.add("is-dragging");el.setPointerCapture(e.pointerId)};
 const move=(e:React.PointerEvent<HTMLDivElement>)=>{const d=drag.current,el=track.current;if(!d||!el||d.pointerId!==e.pointerId)return;const dx=e.clientX-d.startX;if(!d.moved&&Math.abs(dx)<6)return;d.moved=true;el.scrollLeft=d.scrollLeft-dx};
 const end=()=>{const el=track.current;if(el)el.classList.remove("is-dragging");drag.current=null};
 return <div className="folder-strip">
  <div className="folder-strip-head"><b>{folder.name}</b><em>{jobs.length}</em></div>
  <div className="folder-cards" ref={track} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
   {jobs.length?jobs.map(job=><article className="folder-card" key={job.id} onClick={()=>open(job)}><div className="folder-card-top"><b>{job.company}</b><button className="folder-card-x" onClick={e=>{e.stopPropagation();onRemove(job.id)}} aria-label={`从 ${folder.name} 移除 ${job.company}`}><X/></button></div><span>{job.role}</span><div className="folder-card-scores"><DecisionMetric label="推进" value={job.globalScore}/><DecisionMetric label="最终" value={job.finalScore} emphasis="final"/></div><small>{job.recentSignal}</small></article>):<div className="folder-empty" aria-hidden="true"/>}
  </div>
 </div>
}

function DecisionZone({tone,title,subtitle,jobs,isContext,completed,engagement,open,onAction,onFeedback,tray,onToggleTray,folderMode,folders,onAssignFolder}:{tone:"accepted"|"pending";title:string;subtitle:string;jobs:DecisionJob[];isContext:boolean;completed:string[];engagement:Record<string,EngagementState>;open:(job:DecisionJob,tab?:"judgement"|"engagement"|"trail"|"replay")=>void;onAction:(job:DecisionJob,action:DecisionAction)=>void;onFeedback:(job:DecisionJob)=>void;tray:string[];onToggleTray:(id:string)=>void;folderMode:boolean;folders:PickFolder[];onAssignFolder:(jobId:string,folderId:string)=>void}){return <section className={`decision-zone ${tone}${isContext?" is-context":""}`}><div className="decision-group-head"><div><span className="decision-zone-kicker">{tone==="accepted"?"TODAY'S COMMITMENTS":"NOT YET ACCEPTED"}</span><h2>{title}</h2></div><span>{isContext?`当前查看 · ${jobs.length}`:`${jobs.length} 个`}</span></div><div className="pick-grid">{jobs.map((job,index)=><DecisionCard key={job.id} job={{...job,rank:index+1}} completed={completed} engagement={engagement[job.id]||"NEW"} open={open} onAction={onAction} onFeedback={onFeedback} inTray={tray.includes(job.id)} onToggleTray={onToggleTray} folderMode={folderMode} folders={folders} onAssignFolder={onAssignFolder}/>)}</div></section>}

function DecisionCard({job,completed,engagement,open,onAction,onFeedback,inTray,onToggleTray,folderMode,folders,onAssignFolder}:{job:DecisionJob;completed:string[];engagement:EngagementState;open:(job:DecisionJob,tab?:"judgement"|"engagement"|"trail"|"replay")=>void;onAction:(job:DecisionJob,action:DecisionAction)=>void;onFeedback:(job:DecisionJob)=>void;inTray:boolean;onToggleTray:(id:string)=>void;folderMode:boolean;folders:PickFolder[];onAssignFolder:(jobId:string,folderId:string)=>void}){
 const action=job.actions.find(item=>!completed.includes(`${job.id}:${item.id}`))||job.actions[0];
 const actionComplete=completed.includes(`${job.id}:${action.id}`);
 return <article className={`pick-card${inTray?" in-tray":""}`} onClick={()=>open(job)}>
  <button className="pick-add" onClick={e=>{e.stopPropagation();onToggleTray(job.id)}} aria-label={inTray?"移出精选盘":"收藏到精选盘"} title={inTray?"移出精选盘":"收藏到精选盘"}>{inTray?<Check/>:<Star/>}</button>
  <button className="pick-card-feedback" onClick={e=>{e.stopPropagation();onFeedback(job)}} aria-label="不感兴趣" title="不感兴趣">×</button>
  <div className="pick-card-rank">No.{String(job.rank).padStart(2,"0")}</div>
  <div className="pick-card-title"><b>{job.company}</b><span>{job.role}</span></div>
  <div className="pick-card-tags"><em>{decisionGroupMeta[job.group].title}</em><em>{job.facts["职位关系"]}</em><em>{job.sourceMode==="COCKPIT_CONTEXT"?"驾驶舱上下文":"职位市场"}</em><em>{stateLabel[engagement]}</em></div>
  <p className="pick-card-reco">{job.recommendation}</p>
  <div className="pick-card-scores"><DecisionMetric label="推进" value={job.globalScore}/><DecisionMetric label="探索" value={job.explorationScore}/><DecisionMetric label="个人" value={job.personalScore}/><DecisionMetric label="最终" value={job.finalScore} emphasis="final"/></div>
  {folderMode&&<div className="pick-card-folder" onClick={e=>e.stopPropagation()}><FolderPlus/><select className="field" value="" onChange={e=>{if(e.target.value)onAssignFolder(job.id,e.target.value)}} aria-label={`将 ${job.company} 放入文件夹`}><option value="">放入文件夹…</option>{folders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></div>}
  <div className="pick-card-foot"><small>{job.recentSignal}</small><span className="pick-card-actions"><button className={`pick-card-action${actionComplete?" complete":""}`} onClick={e=>{e.stopPropagation();onAction(job,action)}} disabled={actionComplete}>{actionComplete?"已记录":action.label}<ChevronRight/></button></span></div>
 </article>
}

function DecisionMetric({label,value,emphasis,helpOpen,onHelpToggle}:{label:string;value:string|number;emphasis?:string;helpOpen?:boolean;onHelpToggle?:()=>void}){return <div className="decision-metric"><small>{label}</small>{onHelpToggle&&<button className="metric-help" type="button" onClick={onHelpToggle} aria-label={`解释${label}`} aria-expanded={helpOpen}>!</button>}<b className={emphasis}>{value}</b></div>}

function WorkbenchPanel({panel,motion,job,commitmentJobs,auth,sync,notifications,engagement,events,outcomes,completed,mode,legalMap,replayMap,dismissReasons,onReplay,onFactsUpdated,onClose,onOpenJob,onAction,onCommand,onOutcome,onSync,onSetSync,onAuth,onNotification,notify}:{panel:Panel;motion:"idle"|"entering"|"open"|"closing";job:DecisionJob|null;commitmentJobs:DecisionJob[];auth:AuthStatus;sync:SyncStatus;notifications:Notification[];engagement:Record<string,EngagementState>;events:Record<string,DecisionEvent[]>;outcomes:Record<string,Outcome[]>;completed:string[];mode:"connecting"|"connected"|"offline";legalMap:Record<string,EngagementCommand[]>;replayMap:Record<string,BrainxReplay>;dismissReasons:string[];onReplay:(jobId:string,data:BrainxReplay)=>void;onFactsUpdated:()=>Promise<void>;onClose:()=>void;onOpenJob:(job:DecisionJob,tab?:"judgement"|"engagement"|"trail"|"replay")=>void;onAction:(job:DecisionJob,action:DecisionAction)=>void;onCommand:(job:DecisionJob,command:EngagementCommand)=>void;onOutcome:(job:DecisionJob,stage:Outcome["stage"],rating?:number,note?:string)=>void;onSync:()=>void;onSetSync:(sync:SyncStatus)=>void;onAuth:(auth:AuthStatus)=>void;onNotification:(notification:Notification)=>void;notify:(text:string)=>void}){
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
 return <aside className={`decision-drawer workbench-panel panel-${motion}${dragOffset!==null?" is-dragging":""}`} style={{"--panel-drag-offset":`${dragOffset??0}px`} as React.CSSProperties} aria-label="工作台详情面板"><div className="drawer-drag-handle" aria-label="向右滑动关闭详情" onPointerDown={startPanelDrag} onPointerMove={movePanelDrag} onPointerUp={finishPanelDrag} onPointerCancel={finishPanelDrag}><i/></div><button className="drawer-close" onClick={onClose} aria-label="关闭详情"><X/></button>{panel?.kind==="job"&&job?<DecisionDrawer job={job} tab={panel.tab} completed={completed} engagement={engagement[job.id]||"NEW"} events={events[job.id]||[]} outcomes={outcomes[job.id]||[]} mode={mode} legalMap={legalMap} replayData={replayMap[job.id]} onReplay={onReplay} onFactsUpdated={onFactsUpdated} notify={notify} onTab={tab=>onOpenJob(job,tab)} onAction={onAction} onCommand={onCommand} onOutcome={onOutcome}/>:panel?.kind==="sync"?<SyncPanel sync={sync} onSync={onSync} onSetSync={onSetSync} notify={notify} mode={mode}/>:panel?.kind==="identity"?<IdentityPanel auth={auth} onAuth={onAuth} notify={notify} mode={mode}/>:panel?.kind==="commitments"?<CommitmentsPanel jobs={commitmentJobs} engagement={engagement} onOpen={job=>onOpenJob(job,"engagement")}/>:<NotificationPanel items={notifications} onOpen={onNotification} notify={notify}/>}</aside>
}

function CommitmentsPanel({jobs,engagement,onOpen}:{jobs:DecisionJob[];engagement:Record<string,EngagementState>;onOpen:(job:DecisionJob)=>void}){return <><div className="panel-heading"><BriefcaseBusiness/><div><h1>我的承接</h1><p>关注、接单和需要继续处理的职位</p></div></div><div className="mobile-commitment-list">{jobs.length?jobs.map(job=><button key={job.id} onClick={()=>onOpen(job)}><span><b>{job.company} · {job.role}</b><small>{engagement[job.id]==="ACCEPTED"?"接单中 · 推进交付或记录结果":"关注中 · 评估后接单或取消关注"}</small></span><ChevronRight/></button>):<p>暂无承接职位。</p>}</div></>}

function DecisionDrawer({job,tab,completed,engagement,events,outcomes,mode,legalMap,replayData,onReplay,onFactsUpdated,notify,onTab,onAction,onCommand,onOutcome}:{job:DecisionJob;tab:"judgement"|"engagement"|"trail"|"replay";completed:string[];engagement:EngagementState;events:DecisionEvent[];outcomes:Outcome[];mode:"connecting"|"connected"|"offline";legalMap:Record<string,EngagementCommand[]>;replayData?:BrainxReplay;onReplay:(jobId:string,data:BrainxReplay)=>void;onFactsUpdated:()=>Promise<void>;notify:(text:string)=>void;onTab:(tab:"judgement"|"engagement"|"trail"|"replay")=>void;onAction:(job:DecisionJob,action:DecisionAction)=>void;onCommand:(job:DecisionJob,command:EngagementCommand)=>void;onOutcome:(job:DecisionJob,stage:Outcome["stage"],rating?:number,note?:string)=>void}){
 const [replayLoading,setReplayLoading]=useState(false);
 const [factEditRequest,setFactEditRequest]=useState(0);
 const requestFactEdit=()=>setFactEditRequest(value=>value+1);
 const verifyComplete=job.actions.some(action=>action.kind==="verify"&&completed.includes(`${job.id}:${action.id}`));
 useEffect(()=>{if(verifyComplete&&mode!=="connecting")requestFactEdit()},[job.id,verifyComplete,mode]);
 useEffect(()=>{if(mode!=="connected"||!job?.brainxDecisionId||replayData)return;let cancelled=false;setReplayLoading(true);brainxFetch<BackendReplay>(`/api/v1/decisions/${encodeURIComponent(job.brainxDecisionId)}/replay`).then(data=>{if(!cancelled)onReplay(job.id,mapReplayData(data))}).catch(()=>{}).finally(()=>{if(!cancelled)setReplayLoading(false)});return()=>{cancelled=true}},[mode,job?.id,job?.brainxDecisionId,replayData,onReplay]);
 const tabOptions=["judgement","engagement","trail","replay"] as const;
 const tabLabel={judgement:"判断",engagement:"承接与结果",trail:"决策轨迹",replay:"回放"} as const;
 return <><div className="drawer-title"><h1>{job.company} <span>·</span> {job.role}</h1><span className={`decision-state ${job.eligibility.toLowerCase()}`}>{stateLabel[engagement]} · {decisionGroupMeta[job.group].title}</span></div><DirectGlassSegment value={tab} options={tabOptions.map(value=>({value,label:tabLabel[value]}))} onChange={onTab} className="drawer-tabs" ariaLabel="职位详情视图"/>{tab==="judgement"?<><div className="drawer-metrics"><DecisionMetric label="项目推进" value={job.globalScore}/><DecisionMetric label="探索机会" value={job.explorationScore}/><DecisionMetric label="个人适配" value={job.personalScore}/><DecisionMetric label="最终得分" value={job.finalScore} emphasis="final"/></div><ManualFactSection job={job} mode={mode} onUpdated={onFactsUpdated} notify={notify}/><DrawerSection title="为什么现在做"><ul className="explanations">{job.scoreNotes.map(note=><li key={note}>{note}</li>)}</ul></DrawerSection>{job.risks.length>0&&<DrawerSection title="风险与缺失"><ul className="explanations risks">{job.risks.map(note=><li key={note}>{note}</li>)}</ul></DrawerSection>}<DrawerSection title="证据来源"><div className="evidence-list">{job.evidence.map(item=><span key={item}>{item}</span>)}</div><p className="snapshot-note">冻结快照 · {job.id} · Policy v1.2</p></DrawerSection><TalentSupplySection job={job} mode={mode}/><DrawerSection title="当前建议"><div className="drawer-actions">{job.actions.map(action=>{const complete=completed.includes(`${job.id}:${action.id}`);return <button key={action.id} className={complete?"completed":""} onClick={()=>onAction(job,action)} disabled={complete}><span><b>{complete?"已记录：":""}{action.label}</b><small>{action.detail}</small></span>{complete?<Check/>:<ChevronRight/>}</button>})}</div></DrawerSection></>:tab==="engagement"?<EngagementPanel job={job} state={engagement} outcomes={outcomes} completed={completed} mode={mode} legalMap={legalMap} onAction={onAction} onCommand={onCommand} onOutcome={onOutcome}/>:tab==="trail"?<DrawerSection title="决策轨迹"><div className="trail-list">{events.length?events.map(event=><div key={event.id}><time>{event.at}</time><b>{event.type}</b><small>{event.reason||"顾问工作台"}</small></div>):<p className="muted">尚无操作记录</p>}</div></DrawerSection>:<ReplayPanel job={job} events={events} outcomes={outcomes} replayData={replayData} loading={replayLoading}/>}</>
}

function engagementStateMessage(state:EngagementState){
 return ({
  NEW:"尚未纳入个人承接；可先关注，或在判断面板核验后再处理。",
  RECOMMENDED:"已获得推荐；可先关注，或在判断面板核验后再处理。",
  VIEWED:"已查看当前判断；可加入关注或暂不考虑。",
  WATCHED:"已保留关注位；评估完成后可接单。",
  ACCEPTED:"已进入你的交付列表；请持续推进并回写结果。",
  DISMISSED:"已记录暂不考虑；如出现新信号，可重新关注并回到承接流程。",
  RELEASED:"已从当前工作区释放；如需继续推进，可重新关注后再接单。",
  COMPLETED:"本轮承接已完成；结果已归档，可在回放中查看完整过程。",
  EXPIRED:"关注超过 90 天无动作，已自动过期；可重新关注后继续评估。",
 } satisfies Record<EngagementState,string>)[state];
}

function engagementCommandLabel(command:EngagementCommand,state:EngagementState){
 if(command==="WATCH"&&(state==="RELEASED"||state==="DISMISSED"))return "重新关注";
 return actionLabel[command];
}

const factFieldByLabel:Record<string,ManualFactField>={"职位状态":"active_state","当前阶段":"current_stage","剩余 HC":"remaining_hc","历史 Pipeline":"pipeline_snapshot","下一步动作":"next_action","备注":"notes"};
const factEditorLabels:Record<ManualFactField,string>={active_state:"职位状态",current_stage:"当前阶段",pipeline_snapshot:"Pipeline",remaining_hc:"剩余 HC",next_action:"下一步动作",notes:"备注"};
const factSourceLabels={SYNC:"同步",MANUAL:"手动修正",UNKNOWN:"未知",LOCAL:"本机草稿"} as const;
type LocalFactOverride=Partial<Record<ManualFactField,string|number>>;
const LOCAL_FACT_STORAGE_KEY="brainx-manual-fact-overrides-v1";
function readLocalFactOverrides():Record<string,LocalFactOverride>{if(typeof window==="undefined")return {};try{return JSON.parse(localStorage.getItem(LOCAL_FACT_STORAGE_KEY)||"{}")}catch{return {}}}
function writeLocalFactOverrides(value:Record<string,LocalFactOverride>){if(typeof window!=="undefined")localStorage.setItem(LOCAL_FACT_STORAGE_KEY,JSON.stringify(value))}

function ManualFactSection({job,mode,onUpdated,notify,editRequest=0}:{job:DecisionJob;mode:"connecting"|"connected"|"offline";onUpdated:()=>Promise<void>;notify:(text:string)=>void;editRequest?:number}){
 const [editing,setEditing]=useState(false);
 const [saving,setSaving]=useState(false);
 const [localOverrides,setLocalOverrides]=useState<Record<string,LocalFactOverride>>({});
 const [values,setValues]=useState<Record<ManualFactField,string>>({active_state:"",current_stage:"",pipeline_snapshot:"",remaining_hc:"",next_action:"",notes:""});
 const [clearFields,setClearFields]=useState<ManualFactField[]>([]);
 useEffect(()=>setLocalOverrides(readLocalFactOverrides()),[job.id]);
 const local=localOverrides[job.id]||{};
 const fallbackValue=(field:ManualFactField):string|number|null=>{
  if(field==="active_state"){const state=job.facts["职位状态"];return ({招聘中:"OPEN",冷却期:"COOLING",已关闭:"CLOSED",已完成:"COMPLETED"} as Record<string,string>)[state]||null}
  if(field==="current_stage")return job.facts["当前阶段"]||null;
  if(field==="remaining_hc"){const hc=job.facts["剩余 HC"];return hc&&hc!=="UNKNOWN"?Number(hc):null}
  if(field==="pipeline_snapshot")return job.facts["历史 Pipeline"]&&job.facts["历史 Pipeline"]!=="暂无记录"?job.facts["历史 Pipeline"]:null;
  if(field==="next_action")return job.facts["下一步动作"]||null;
  return job.facts["备注"]||null;
 };
 const effectiveValue=(field:ManualFactField)=>local[field]??job.factFields?.[field]?.effective_value??fallbackValue(field);
 const sourceOfField=(field:ManualFactField)=>local[field]!==undefined?{source:"LOCAL" as const,effective_value:local[field]}:job.factFields?.[field];
 const readValues=()=>Object.fromEntries((Object.keys(factEditorLabels) as ManualFactField[]).map(field=>[field,String(effectiveValue(field)??"")])) as Record<ManualFactField,string>;
 const beginEdit=()=>{setValues(readValues());setClearFields([]);setEditing(true)};
 useEffect(()=>{
  const openFacts=(event:Event)=>{if((event as CustomEvent<string>).detail===job.id&&mode!=="connecting")beginEdit()};
  window.addEventListener("brainx:edit-facts",openFacts);
  return()=>window.removeEventListener("brainx:edit-facts",openFacts);
 },[job.id,mode,editRequest]);
 const toggleClear=(field:ManualFactField)=>setClearFields(current=>current.includes(field)?current.filter(item=>item!==field):[...current,field]);
 const saveLocal=(changes:Partial<Record<ManualFactField,string|number>>,clears:Set<ManualFactField>)=>{
  const all=readLocalFactOverrides();const next={...(all[job.id]||{})};
  clears.forEach(field=>delete next[field]);Object.assign(next,changes);
  const saved={...all,[job.id]:next};writeLocalFactOverrides(saved);setLocalOverrides(saved);setEditing(false);
  notify("事实已保存到当前浏览器；后端上线后再重新生成评分");
 };
 const save=async(event:React.FormEvent)=>{
  event.preventDefault();
  if(mode==="connecting")return;
 const changes:Partial<Record<ManualFactField,string|number>>={};
  const clears=new Set<ManualFactField>(clearFields);
  const textFields:ManualFactField[]=["active_state","current_stage","pipeline_snapshot","next_action","notes"];
  for(const field of textFields){if(clears.has(field))continue;const value=values[field].trim();if(value)changes[field]=value;else if(job.factFields?.[field]?.source==="MANUAL")clears.add(field)}
  if(!clears.has("remaining_hc")&&values.remaining_hc.trim()){
   const n=Number(values.remaining_hc);if(!Number.isInteger(n)||n<0){notify("剩余 HC 必须是 0 或更大的整数");return}changes.remaining_hc=n;
  }else if(!values.remaining_hc.trim()&&job.factFields?.remaining_hc?.source==="MANUAL")clears.add("remaining_hc");
  if(mode==="offline"){saveLocal(changes,clears);return}
  setSaving(true);
  try{
   const result=await updateOpportunityFacts(job.id,{changes,clear_fields:Array.from(clears),idempotency_key:makeIdempotencyKey(`facts:${job.id}`)});
   await onUpdated();setEditing(false);notify(result.recompute?.blocked?"事实已保存，但当前快照暂未重算":"事实已更新，判断已重新生成");
  }catch(error){
   if(error instanceof BrainxApiError&&[0,404,502,503].includes(error.status)){saveLocal(changes,clears);notify("后端尚未更新，事实已先保存到当前浏览器")}
   else notify(`保存失败：${error instanceof Error?error.message:"后端未响应"}`)
  }finally{setSaving(false)}
 };
 const sourceOf=(label:string)=>{const field=factFieldByLabel[label];return field?sourceOfField(field):undefined};
 const editable=mode!=="connecting";
 const displayFacts={...job.facts};
 (Object.keys(factFieldByLabel) as string[]).forEach(label=>{const field=factFieldByLabel[label];const value=effectiveValue(field);if(value!==null&&value!==undefined&&value!=="")displayFacts[label]=field==="active_state"?(({OPEN:"招聘中",COOLING:"冷却期",CLOSED:"已关闭",COMPLETED:"已完成"} as Record<string,string>)[String(value)]||String(value)):String(value)});
 return <DrawerSection title="当前事实" action={editable?<button type="button" className="fact-edit-trigger" onClick={editing?()=>setEditing(false):beginEdit}>{editing?"取消编辑":"修正事实"}</button>:<span className="fact-readonly">正在连接</span>}>
  <dl className="facts">{Object.entries(displayFacts).map(([key,value])=>{const source=sourceOf(key);return <div key={key}><dt>{key}</dt><dd className={value==="UNKNOWN"?"unknown":""}>{value}{source&&<small className={`fact-source ${source.source.toLowerCase()}`}>{factSourceLabels[source.source]}</small>}</dd></div>})}</dl>
  {editing&&<form className="fact-edit-form" onSubmit={save}>
   <label>职位状态<select value={values.active_state} onChange={e=>{setValues(v=>({...v,active_state:e.target.value}));setClearFields(v=>v.filter(f=>f!=="active_state"))}}><option value="">请选择</option><option value="OPEN">活跃 / 招聘中</option><option value="COOLING">冷却期</option><option value="CLOSED">已关闭</option><option value="COMPLETED">已完成</option></select></label>
   <label>当前阶段<input value={values.current_stage} onChange={e=>{setValues(v=>({...v,current_stage:e.target.value}));setClearFields(v=>v.filter(f=>f!=="current_stage"))}} placeholder="例如：INTERVIEW / OFFER"/></label>
   <label>剩余 HC<input type="number" min="0" step="1" value={values.remaining_hc} onChange={e=>setValues(v=>({...v,remaining_hc:e.target.value}))} placeholder="未知可留空"/></label>
   <label>Pipeline<input value={values.pipeline_snapshot} onChange={e=>{setValues(v=>({...v,pipeline_snapshot:e.target.value}));setClearFields(v=>v.filter(f=>f!=="pipeline_snapshot"))}} placeholder="例如：推荐 3 · 面试 1"/></label>
   <label>下一步动作<input value={values.next_action} onChange={e=>{setValues(v=>({...v,next_action:e.target.value}));setClearFields(v=>v.filter(f=>f!=="next_action"))}} placeholder="例如：确认客户反馈"/></label>
   <label>备注<textarea value={values.notes} onChange={e=>{setValues(v=>({...v,notes:e.target.value}));setClearFields(v=>v.filter(f=>f!=="notes"))}} placeholder="补充事实来源或判断依据"/></label>
   <div className="fact-restore-list">{(Object.keys(factEditorLabels) as ManualFactField[]).filter(field=>job.factFields?.[field]?.source==="MANUAL").map(field=><button key={field} type="button" className={clearFields.includes(field)?"selected":""} onClick={()=>toggleClear(field)}>{clearFields.includes(field)?"将恢复同步值":"恢复同步值"} · {factEditorLabels[field]}</button>)}</div>
   <div className="fact-edit-actions"><button type="button" className="btn" onClick={()=>setEditing(false)}>取消</button><button type="submit" className="btn primary" disabled={saving}>{saving?"保存并重算…":"保存并重新判断"}</button></div>
   <p className="fact-edit-caption">{mode==="connected"?"只修正当前账号的事实；保存后按后端规则重算，不直接修改分数。":"当前后端未连接；先保存本机草稿。确认事实后，必须完成重新判断，分数才会更新。"}</p>
  </form>}
 </DrawerSection>
}

function EngagementPanel({job,state,outcomes,completed,mode,legalMap,onAction,onCommand,onOutcome}:{job:DecisionJob;state:EngagementState;outcomes:Outcome[];completed:string[];mode:"connecting"|"connected"|"offline";legalMap:Record<string,EngagementCommand[]>;onAction:(job:DecisionJob,action:DecisionAction)=>void;onCommand:(job:DecisionJob,command:EngagementCommand)=>void;onOutcome:(job:DecisionJob,stage:Outcome["stage"],rating?:number,note?:string)=>void}){
 const [stage,setStage]=useState<Outcome["stage"]>("推荐采纳");
 const [rating,setRating]=useState("4");
 const [note,setNote]=useState("");
 // 连接后端时，允许动作一律以后端 legal_actions 为准，不在前端自行推断权限
 const actions=mode==="connected"?legalMap[job.id]||[]:legalActions(job,state);
 const prerequisite=engagementPrerequisite(job,state);
 const prerequisiteComplete=!!prerequisite.action&&completed.includes(`${job.id}:${prerequisite.action.id}`);
 const canRecordOutcome=state==="ACCEPTED";
 const stageOptions:FilterSelectOption[]=["推荐采纳","面试","Offer","入职","关闭","反馈"].map(value=>({value,label:value}));
 const ratingOptions:FilterSelectOption[]=[{value:"",label:"不打分"},...[1,2,3,4,5].map(value=>({value:String(value),label:`${value} 分`}))];
 return <>
  <DrawerSection title="承接状态">
   <div className="engagement-state"><span>{stateLabel[state]}</span><p>{engagementStateMessage(state)}</p></div>
   <div className="command-grid">{actions.length?actions.map(command=><button key={command} className={command==="ACCEPT"?"primary":""} onClick={()=>onCommand(job,command)}>{engagementCommandLabel(command,state)}<ChevronRight/></button>):prerequisite.action?<div className="engagement-prerequisite"><div><span>承接前置条件</span><b>{prerequisite.title}</b><p>{prerequisite.detail}</p></div><button className={prerequisiteComplete?"completed":""} onClick={()=>onAction(job,prerequisite.action!)} disabled={prerequisiteComplete}>{prerequisiteComplete?"已记录":prerequisite.action.label}{prerequisiteComplete?<Check/>:<ChevronRight/>}</button><small>核验完成后，后端会返回允许关注或接单的操作。</small></div>:<div className="engagement-empty"><b>{prerequisite.title}</b><p>{prerequisite.detail}</p></div>}</div>
  </DrawerSection>
  <DrawerSection title={canRecordOutcome?"记录结果":"结果记录"}>
   {canRecordOutcome&&<form className="outcome-form" onSubmit={event=>{event.preventDefault();onOutcome(job,stage,rating?Number(rating):undefined,note||undefined);setNote("")}}><FilterSelect value={stage} onChange={value=>setStage(value as Outcome["stage"])} ariaLabel="结果阶段" options={stageOptions}/><FilterSelect value={rating} onChange={setRating} ariaLabel="结果评分" options={ratingOptions}/><input value={note} onChange={event=>setNote(event.target.value)} placeholder="备注（可选）"/><button className="btn primary" type="submit"><ClipboardCheck/>记录</button></form>}
   <div className="outcome-list">{outcomes.length?outcomes.map(item=><div key={item.id}><b>{item.stage}</b><span>{item.rating!==undefined?`${item.rating} 分 · `:""}{item.note||"已记录"}</span><time>{item.at}</time></div>):<p className="muted">{canRecordOutcome?"尚无结果记录；可从上方开始回写。":"尚无结果记录；接单后可回写推荐、面试、Offer、入职、关闭或反馈。"}</p>}</div>
  </DrawerSection>
 </>}

function ReplayPanel({job,events,outcomes,replayData,loading}:{job:DecisionJob;events:DecisionEvent[];outcomes:Outcome[];replayData?:BrainxReplay;loading?:boolean}){const replay=replayData?{decisionId:replayData.decisionId,runId:replayData.decisionId,snapshotAt:replayData.snapshotAt,policyVersion:replayData.policyVersion,rank:replayData.rank,reasons:replayData.reasons,risks:replayData.risks,evidence:replayData.evidence}:{decisionId:`D-${job.id.slice(4)}`,runId:"RUN-1842",snapshotAt:"2026-08-10 11:28",policyVersion:"Policy v1.2",rank:job.rank,reasons:job.scoreNotes,risks:job.scoreNotes.slice(0,1),evidence:job.evidence};const shownEvents=replayData?replayData.events:events;const shownOutcomes=replayData?replayData.outcomes:outcomes;return <><DrawerSection title="冻结决策快照"><dl className="facts"><div><dt>快照时间</dt><dd>{loading&&!replayData?"读取中…":replay.snapshotAt}</dd></div><div><dt>策略版本</dt><dd>{replay.policyVersion}</dd></div><div><dt>当时排名</dt><dd>第 {replay.rank} 位</dd></div><div><dt>决策编号</dt><dd>{replay.decisionId}</dd></div></dl></DrawerSection><DrawerSection title="当时理由与风险"><ul className="explanations">{replay.reasons.map(item=><li key={item}>{item}</li>)}</ul><div className="evidence-list">{replay.evidence.map(item=><span key={item}>{item}</span>)}</div></DrawerSection><DrawerSection title="后续操作"><div className="trail-list">{shownEvents.map(item=><div key={item.id}><time>{item.at}</time><b>{item.type}</b><small>{item.reason||"顾问工作台"}</small></div>)}</div></DrawerSection><DrawerSection title="后续结果">{shownOutcomes.length?<div className="outcome-list">{shownOutcomes.map(item=><div key={item.id}><b>{item.stage}</b><span>{item.note||"已记录"}</span><time>{item.at}</time></div>)}</div>:<p className="muted">暂无结果记录；回放以上方冻结数据为准。</p>}</DrawerSection></>}

function SyncPanel({sync,onSync,onSetSync,notify,mode}:{sync:SyncStatus;onSync:()=>void;onSetSync:(sync:SyncStatus)=>void;notify:(text:string)=>void;mode:"connecting"|"connected"|"offline"}){const setDemo=(state:SyncStatus["state"]):void=>{onSetSync({...sync,state,errors:state==="ERROR"?["飞书消息源超时"]:state==="INCOMPLETE"?["职位事实未完整返回"]:[]});notify(state==="INCOMPLETE"?"已切换为同步不完整演示状态":"已切换为同步失败演示状态")};return <><div className="panel-heading"><ShieldCheck/><div><h1>同步状态</h1><p>当前推荐只使用完整快照</p></div></div><DrawerSection title="当前快照"><dl className="facts"><div><dt>状态</dt><dd>{sync.state==="READY"?"已同步":sync.state==="RUNNING"?"同步中":sync.state==="INCOMPLETE"?"本次同步不完整":sync.state==="AUTH_EXPIRED"?"飞书授权已过期":sync.state==="ERROR"?"同步失败":"尚未同步"}</dd></div><div><dt>读取进度</dt><dd>{sync.rowsRead??0} / {sync.rowsExpected??"—"}</dd></div><div><dt>更新时间</dt><dd>{sync.updatedAt||"—"}</dd></div>{sync.errors&&sync.errors.length>0&&<div><dt>错误</dt><dd className="unknown">{sync.errors[0]}</dd></div>}</dl></DrawerSection><div className="drawer-actions"><button onClick={onSync}><span><b>重新同步</b><small>{mode==="connected"?"拉取 fixture 快照并生成新推荐":"生成新的完整推荐快照"}</small></span><ChevronRight/></button>{mode!=="connected"&&<><button onClick={()=>setDemo("INCOMPLETE")}><span><b>模拟同步不完整</b><small>验证推荐阻断界面</small></span><AlertTriangle/></button><button onClick={()=>setDemo("ERROR")}><span><b>模拟同步失败</b><small>验证异常与恢复提示</small></span><X/></button></>}</div><p className="panel-caption">{mode==="connected"?"已连接 Brain X 后端；状态来自 sync_runs，重新同步会触发 fixture 同步并冻结新推荐。":"当前为前端演示。后端接入后，这里映射 sync_runs 与推荐生成状态。"}</p></>}

function IdentityPanel({auth,onAuth,notify,mode}:{auth:AuthStatus;onAuth:(auth:AuthStatus)=>void;notify:(text:string)=>void;mode:"connecting"|"connected"|"offline"}){const [consultants,setConsultants]=useState<{consultant_id:string;display_name:string}[]|null>(null);const [loginBusy,setLoginBusy]=useState<string|null>(null);useEffect(()=>{brainxFetch<BackendConsultants>("/api/v1/consultants").then(d=>setConsultants(d.items||[])).catch(()=>setConsultants([]))},[]);const devLogin=(consultantId:string)=>void(async()=>{setLoginBusy(consultantId);try{await brainxFetch<null>("/api/v1/session",{method:"POST",body:{consultant_id:consultantId}});notify("已登录 Brain X，正在加载后端快照…");window.setTimeout(()=>window.location.reload(),600)}catch(error){notify(`登录失败：${error instanceof Error?error.message:"后端未响应"}`);setLoginBusy(null)}})();const logout=()=>void(async()=>{try{await brainxFetch<null>("/api/v1/session",{method:"DELETE"})}catch{}notify("已退出 Brain X 会话");window.setTimeout(()=>window.location.reload(),400)})();return <><div className="panel-heading"><CircleUserRound/><div><h1>{auth.consultant}</h1><p>{mode==="connected"?"Brain X 顾问会话与数据授权":"本地演示身份与后端登录"}</p></div></div><DrawerSection title="账户状态"><dl className="facts"><div><dt>登录状态</dt><dd>{mode==="connected"?"Brain X 已登录":mode==="connecting"?"正在探测后端…":"演示模式（未连接后端）"}</dd></div><div><dt>飞书授权</dt><dd className={auth.needsReauth?"unknown":""}>{mode==="connected"?auth.needsReauth?"已过期":"正常":"—"}</dd></div></dl></DrawerSection>{mode==="connected"?<div className="drawer-actions"><button onClick={logout}><span><b>退出登录</b><small>清除 Brain X 会话并回到演示模式</small></span><ChevronRight/></button></div>:<><DrawerSection title="登录 Brain X 后端（开发后门）"><p className="panel-caption">后端需以 BRAINX_DEV_AUTH=1 启动；正式环境请使用飞书授权登录。</p><div className="drawer-actions">{consultants===null?<p className="muted">正在读取顾问花名册…</p>:consultants.length?consultants.map(c=><button key={c.consultant_id} onClick={()=>devLogin(c.consultant_id)} disabled={loginBusy!==null}><span><b>{loginBusy===c.consultant_id?"登录中…":c.display_name}</b><small>以该顾问身份进入 Brain X 工作台</small></span>{loginBusy===c.consultant_id?<Clock3/>:<ChevronRight/>}</button>):<p className="muted">后端不可达或花名册为空。</p>}</div></DrawerSection><DrawerSection title="演示状态"><div className="drawer-actions"><button onClick={()=>{onAuth({...auth,needsReauth:!auth.needsReauth,authorized:auth.needsReauth});notify(auth.needsReauth?"已恢复授权演示状态":"已切换为授权过期演示状态")}}><span><b>{auth.needsReauth?"恢复授权状态":"模拟授权过期"}</b><small>用于验证后端授权恢复入口</small></span><ShieldCheck/></button><button onClick={()=>notify("已退出演示会话；刷新页面将恢复本地演示身份")}><span><b>退出演示</b><small>不影响任何外部账号</small></span><ChevronRight/></button></div></DrawerSection></>}</>}

function NotificationPanel({items,onOpen,notify}:{items:Notification[];onOpen:(item:Notification)=>void;notify:(text:string)=>void}){return <><div className="panel-heading"><BellRing/><div><h1>今日提醒</h1><p>同步、承接与每日推荐摘要</p></div></div><div className="notification-list">{items.map(item=><button key={item.id} className={item.read?"read":""} onClick={()=>onOpen(item)}><i/><span><b>{item.title}</b><small>{item.detail}</small></span><ChevronRight/></button>)}</div><DrawerSection title="推送预览"><div className="push-preview"><b>今日职位判断</b><span>Top 3 已生成 · 1 个承接待处理</span></div><button className="btn" onClick={()=>notify("已模拟发送到 Felix 的飞书提醒") }><Send/>模拟发送</button><p className="panel-caption">仅展示推送内容，不会发送到外部系统。</p></DrawerSection></>}

function CommandConfirm({pending,reasons,onClose,onConfirm}:{pending:{job:DecisionJob;command:EngagementCommand};reasons:string[];onClose:()=>void;onConfirm:(reason?:string)=>void}){const list=reasons&&reasons.length?reasons:["无资源","不符合方向","客户/职位质量不足","当前没精力","已有其他顾问推进","信息不完整","其他"];const [reason,setReason]=useState(list[0]);const dismiss=pending.command==="DISMISS";const reasonOptions:FilterSelectOption[]=list.map(value=>({value,label:value}));return <div className="command-mask" role="presentation"><section className="command-modal" role="dialog" aria-modal="true" aria-label="确认承接操作"><h2>{dismiss?"暂不考虑这个职位？":"确认接单？"}</h2><p>{dismiss?"选择原因后会记录到决策轨迹。":"接单后该职位将进入你的交付列表。"}</p>{dismiss&&<FilterSelect value={reason} onChange={setReason} ariaLabel="暂不考虑原因" options={reasonOptions}/>}<div><button className="btn" onClick={onClose}>取消</button><button className="btn primary" onClick={()=>onConfirm(dismiss?reason:undefined)}>{dismiss?"记录原因":"确认接单"}</button></div></section></div>}

function DrawerSection({title,children,action}:{title:string;children:React.ReactNode;action?:React.ReactNode}){return <section className="drawer-section"><div className="drawer-section-head"><h2>{title}</h2>{action}</div>{children}</section>}

// —— 候选供给（人才侧适配层的前端呈现）——
// 数据形状对齐后端 talent-supply.js 的 TalentSupplySnapshot（GET /opportunities/:id/talent-supply）。
// 供给分析【旁路】：只做展示，绝不并入 job.finalScore（与后端「不进入基础评分」纪律一致）。
// 数据来源：真库匹配算法 supply-match-v1（技能0.5 + 意向0.3 + 摘要0.2）。前端不再造数——
// connected 且开关开启时拉真实结果；未登录/未开启/失败则显示占位说明，绝不伪造数字。
const supplyDifficultyMeta:Record<"low"|"medium"|"high",{label:string;tone:string}>={low:{label:"供给充足",tone:"ok"},medium:{label:"供给适中",tone:"warn"},high:{label:"供给偏紧",tone:"risk"}};
function TalentSupplySection({job,mode}:{job:DecisionJob;mode:"connecting"|"connected"|"offline"}){
 const [snap,setSnap]=useState<TalentSupplySnapshot|null>(null);
 const [state,setState]=useState<"idle"|"loading"|"ready"|"disabled"|"error">("idle");
 useEffect(()=>{
  if(mode!=="connected"){setState("disabled");return;}
  let alive=true;setState("loading");
  getTalentSupply(job.id)
   .then(s=>{if(!alive)return;if(s&&s.enabled){setSnap(s);setState("ready");}else{setState("disabled");}})
   .catch(()=>{if(alive)setState("error");});
  return()=>{alive=false;};
 },[job.id,mode]);

 if(state==="ready"&&snap){
  const meta=supplyDifficultyMeta[snap.supplyDifficulty||"high"];
  return <DrawerSection title="候选供给（人才侧参考）">
   <div className="supply-head">
    <div className="supply-count"><strong>{snap.matchableTalentCount??0}</strong><span>可匹配候选</span></div>
    <span className={`supply-badge ${meta.tone}`}>{meta.label}</span>
    {(snap.reactivatableTalentCount??0)>0&&<span className="supply-reactivate">可激活沉睡 {snap.reactivatableTalentCount} 人</span>}
   </div>
   <p className="supply-suggestion">{snap.matchingSuggestion}</p>
   {(snap.topMatches?.length??0)>0&&<div className="supply-matches">{snap.topMatches!.map(m=><div key={m.talentId} className="supply-match"><b>{m.name}</b><span>匹配 {Math.round(m.score*100)}%{m.matched?.length?` · ${m.matched.slice(0,3).join("、")}`:""}</span></div>)}</div>}
   <p className="snapshot-note">来源 {snap.algo||"talent-supply"} · 真库匹配 · 不计入最终得分</p>
  </DrawerSection>;
 }
 return <DrawerSection title="候选供给（人才侧参考）">
  <p className="supply-suggestion muted">
   {state==="loading"?"正在从人才库计算候选供给…":
    state==="error"?"供给计算暂不可用（人才库接口未响应）":
    mode!=="connected"?"离线演示态不显示供给；登录并连通后端后展示真库匹配结果。":
    "供给分析未开启（需设 BRAINX_TALENT_SUPPLY=1）或人才库暂无候选。"}
  </p>
  <p className="snapshot-note">旁路只读 · 不计入最终得分</p>
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

function JobsView({jobs,status,setStatus,sort,setSort,view,setView,selected,setSelected,openJob,notify,mode}:any){
 const [clientFilter,setClientFilter]=useState("全部客户");
 const [cityFilter,setCityFilter]=useState("全部城市");
 const [typeFilter,setTypeFilter]=useState("全部职位类型");
 const [sourceFilter,setSourceFilter]=useState("全部来源");
 const [compareOpen,setCompareOpen]=useState(false);
 const statusOptions:FilterSelectOption[]=[{value:"全部状态",label:"全部状态"},{value:"待同步",label:"待同步"},...statusOrder.map(value=>({value,label:value}))];
 const sortOptions:FilterSelectOption[]=[{value:"score",label:"综合分数 ↓"},{value:"hc",label:"HC ↓"}];
 const positionTypes:PositionType[]=["产品","运营","技术","算法","设计","商业化"];
 const clientOptions:FilterSelectOption[]=[{value:"全部客户",label:"全部客户"},...Array.from(new Set<string>(jobs.map((job:Job)=>job.client))).sort().map((value:string)=>({value,label:value}))];
 const cityOptions:FilterSelectOption[]=[{value:"全部城市",label:"全部城市"},...Array.from(new Set<string>(jobs.map((job:Job)=>job.city))).sort().map((value:string)=>({value,label:value}))];
 const typeOptions:FilterSelectOption[]=[{value:"全部职位类型",label:"全部职位类型"},...positionTypes.map(value=>({value,label:`${value} · ${jobs.filter((job:Job)=>job.positionType===value).length}`}))];
 const sourceOptions:FilterSelectOption[]=[{value:"全部来源",label:"全部来源"},{value:"驾驶舱导入",label:`驾驶舱导入 · ${jobs.filter((job:Job)=>job.source==="驾驶舱导入").length}`},{value:"市场信号",label:`市场信号 · ${jobs.filter((job:Job)=>job.source==="市场信号").length}`}];
 const visibleJobs=jobs.filter((job:Job)=>(clientFilter==="全部客户"||job.client===clientFilter)&&(cityFilter==="全部城市"||job.city===cityFilter)&&(typeFilter==="全部职位类型"||job.positionType===typeFilter)&&(sourceFilter==="全部来源"||job.source===sourceFilter));
 const comparedJobs=visibleJobs.filter((job:Job)=>selected.includes(job.id));
 const toggle=(id:Job["id"])=>{setCompareOpen(false);if(selected.includes(id))setSelected(selected.filter((value:Job["id"])=>value!==id));else if(selected.length<3)setSelected([...selected,id]);else notify("最多对比 3 个职位")};
 return <><Heading code="JOB SIGNAL RADAR" title="职位雷达" desc="把新鲜度、招聘意愿、反馈、转化与竞争信号放在同一决策面上。" action={<button className="btn primary" onClick={()=>notify("新建职位表单已准备（演示数据不写入真实系统）")}><Plus/>新增职位</button>}/>
 <div className="radar-source-summary"><Database/><span>{mode==="connected"?<><b>职位雷达数据池已接入 Brain X</b> · {jobs.filter((job:Job)=>job.source==="驾驶舱导入").length} 个驾驶舱条目 · {jobs.filter((job:Job)=>job.source==="市场信号").length} 个市场条目</>:<><b>驾驶舱全景图已导入</b> · {cockpitRadarJobs.length} 个职位条目来自 93 家公司</>}</span><small>{mode==="connected"?"关系、HC 与阶段来自后端事实；评分与转化指标待后端模型":"评分、HC 与流程指标待后端同步"}</small></div>
 <div className="toolbar"><FilterSelect value={status} onChange={setStatus} ariaLabel="职位状态" options={statusOptions}/><FilterSelect value={typeFilter} onChange={setTypeFilter} ariaLabel="职位类型筛选" options={typeOptions}/><FilterSelect value={sourceFilter} onChange={setSourceFilter} ariaLabel="数据来源筛选" options={sourceOptions}/><FilterSelect value={sort} onChange={setSort} ariaLabel="排序方式" options={sortOptions}/><FilterSelect value={clientFilter} onChange={setClientFilter} ariaLabel="客户筛选" options={clientOptions}/><FilterSelect value={cityFilter} onChange={setCityFilter} ariaLabel="城市筛选" options={cityOptions}/><DirectGlassSegment value={view} options={[{value:"list",label:<><ListFilter/>决策列表</>},{value:"rail",label:<><Activity/>信号轨道</>}]} onChange={setView} className="glass-seg" ariaLabel="职位视图"/>{comparedJobs.length>1&&<button className="btn primary" onClick={()=>setCompareOpen(true)}><GitCompareArrows/>对比 {comparedJobs.length}</button>}</div>
 <section className="card">{view==="list"?<div className="table-wrap"><table className="data-table"><thead><tr><th>对比</th><th>职位 / 客户</th><th>分数</th><th>状态与判断</th><th>HC</th><th>最近反馈</th><th>推荐</th><th>面试</th><th>Offer</th><th>操作</th></tr></thead><tbody>{visibleJobs.map((j:Job)=><tr key={j.id} className={j.source==="驾驶舱导入"?"cockpit-imported-row":""}><td><input type="checkbox" checked={selected.includes(j.id)} onChange={()=>toggle(j.id)} /></td><td className="name-cell"><b>{j.name}</b><small><em>{j.positionType}</em>{j.client} · {j.city}</small></td><td className="score">{j.score??"—"}</td><td><StatusTag s={j.status}/><div className="reason">{j.reason}</div></td><td className="mono">{j.hc??"—"}</td><td>{j.feedback}</td><td>{j.recommended??"—"}</td><td>{j.interview??"—"}</td><td>{j.offer??"—"}</td><td><button className="link" onClick={()=>openJob(j)}>详情 →</button></td></tr>)}</tbody></table>{visibleJobs.length===0&&<div className="empty"><Search/>没有符合当前筛选的职位</div>}</div>:<SignalRail jobs={visibleJobs} open={openJob}/>}</section>
 {compareOpen&&<Compare jobs={comparedJobs} close={()=>setCompareOpen(false)}/>}</>
}
function SignalRail({jobs,open}:{jobs:Job[];open:(j:Job)=>void}){return <div className="rail">{jobs.map(j=>{if(j.status==="待同步")return <div className="rail-row cockpit-rail-row" key={j.id}><div className="rail-name"><button className="link" onClick={()=>open(j)}><b>{j.name}</b></button><small>{j.positionType} · {j.client}</small></div><div className="cockpit-signal-pending"><Database/><span>驾驶舱岗位已导入，实时信号待同步</span></div><div className="reason">{j.industry}</div></div>;const ix=statusOrder.indexOf(j.status);const color=j.status==="已关闭"?"#b32636":j.status==="拥挤"||j.status==="降温"?"#7d8795":"#2f6b60";return <div className="rail-row" key={j.id}><div className="rail-name"><button className="link" onClick={()=>open(j)}><b>{j.name}</b></button><small>{j.positionType} · {j.client} · 评分 {j.score??"—"}</small></div><div><div className="track" style={{"--progress":`${ix/(statusOrder.length-1)*100}%`,"--track-color":color} as React.CSSProperties}>{statusOrder.map((s,i)=><i key={s} className={`node ${i<=ix?"done":""} ${i===ix?"current":""}`} style={{left:`${i/(statusOrder.length-1)*100}%`}} title={s}/>)}</div><div className="track-labels">{statusOrder.map(s=><span key={s}>{s}</span>)}</div></div><div className="reason">{j.reason}</div></div>})}</div>}
function Compare({jobs,close}:{jobs:Job[];close:()=>void}){const dims=["综合评分","职位新鲜度","招聘意愿","HC / 紧急程度","反馈速度","推荐→面试","面试→Offer","竞争程度","主要风险","建议动作"];const metric=(value:number|null)=>value===null?"—":value;return <><div className="drawer-backdrop" onClick={close}/><div className="modal"><div className="modal-head"><b>职位横向对比</b><button className="icon-btn" onClick={close}><X/></button></div><div className="modal-body compare-grid"><div></div>{jobs.map(j=><div key={j.id}><b>{j.name}</b></div>)}{dims.flatMap((d,i)=><><div key={d}>{d}</div>{jobs.map(j=><div key={`${d}${j.id}`}>{i===0?<span className="score">{metric(j.score)}</span>:i===1?j.score===null?"待同步":`${Math.max(7,j.score-72)}/15`:i===2?j.score===null?"待同步":`${Math.max(8,j.score-72)}/20`:i===3?j.hc===null?"待同步":`${j.hc} HC · ${j.hc>2?"紧急":"正常"}`:i===4?j.feedback:i===5?j.recommended&&j.interview?`${Math.round(j.interview/j.recommended*100)}%`:"—":i===6?j.interview&&j.offer!==null?`${Math.round(j.offer/j.interview*100)}%`:"—":i===7?j.status==="待同步"?"待同步":j.status==="拥挤"?"高":"中":i===8?j.reason:j.status==="待同步"?"先同步实时事实":j.status==="拥挤"?"提高推荐门槛":"优先推进"}</div>)}</>)}</div></div></>}

function JobTable({rows,open}:{rows:Job[];open:(j:Job)=>void}){return <div className="table-wrap"><table className="data-table"><thead><tr><th>职位 / 客户</th><th>综合分</th><th>状态与原因</th><th>HC</th><th>最近反馈</th><th>推荐</th><th>面试</th><th>Offer</th><th>今日建议</th></tr></thead><tbody>{rows.map(j=><tr key={j.id}><td className="name-cell"><button className="link" onClick={()=>open(j)}><b>{j.name}</b></button><small>{j.client}</small></td><td className="score">{j.score}</td><td><StatusTag s={j.status}/><div className="reason">{j.reason}</div></td><td className="mono">{j.hc}</td><td>{j.feedback}</td><td>{j.recommended}</td><td>{j.interview}</td><td>{j.offer}</td><td>{j.status==="拥挤"?"提高标准":j.status==="降温"?"确认预算":"优先推进"}</td></tr>)}</tbody></table></div>}

function CockpitJobDetail({job,onBack,notify}:{job:Job;onBack:()=>void;notify:(text:string)=>void}){return <><button className="back" onClick={onBack}><ArrowLeft/>返回职位雷达</button><div className="detail-top cockpit-detail-top"><div className="detail-title"><span className="eyebrow">COCKPIT IMPORT · {job.sourceColumn}</span><h1>{job.name}</h1><div className="meta"><span>{job.client}</span><span>{job.industry}</span><span>{job.city}</span><span>职位类型 · {job.positionType}</span></div></div><div className="imported-fact"><Database/><span>已导入</span></div></div><div className="conclusion"><div className="spark"><Database/></div><div><b>已从 TTC 驾驶舱全景图带入基础岗位信息</b><p>评分、HC、招聘阶段和转化数据当前没有来源，等待后端同步后再参与职位判断。</p></div></div><div className="grid g2"><section className="card"><div className="card-head"><h2>已导入字段</h2><span>原始工作簿</span></div><dl className="facts card-body"><div><dt>公司</dt><dd>{job.client}</dd></div><div><dt>业务方向</dt><dd>{job.industry}</dd></div><div><dt>地点</dt><dd>{job.city}</dd></div><div><dt>岗位分类</dt><dd>{job.sourceColumn}</dd></div><div><dt>职位类型</dt><dd>{job.positionType}</dd></div></dl></section><section className="card"><div className="card-head"><h2>待同步事实</h2><span>不做前端推断</span></div><div className="card-body side-list">{["当前 HC 与关闭状态","招聘流程及候选人漏斗","最近反馈与客户优先级","评分与推荐排序"].map((item,index)=><div className="mini-item" key={item}><span className="num">0{index+1}</span><div><b>{item}</b><p>等待后端数据适配层返回</p></div></div>)}</div></section></div><button className="btn primary cockpit-copy-action" onClick={()=>notify("岗位基础信息已复制到演示剪贴板")}>复制岗位基础信息 <ChevronRight/></button></>}

function JobDetail({job,onBack,weights,eventType,setEventType,hc,setHc,notify}:any){
 if(job.source==="驾驶舱导入")return <CockpitJobDetail job={job} onBack={onBack} notify={notify}/>;
 const score=job.score??0;const remainingHc=job.hc??0;const recommended=job.recommended??0;const interview=job.interview??0;const offer=job.offer??0;
 const [events2,setEvents2]=useState(events.slice(0,3));
 const detailWeights=[20,15,15,15,10,10,10,5];
 const add=()=>{setEvents2([[new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}),eventType,eventType==="HC变化"?`HC更新为 ${hc}`:"用户新增项目事件"],...events2]);notify("事件已记录，状态与评分已重新计算")};
 return <><button className="back" onClick={onBack}><ArrowLeft/>返回职位雷达</button><div className="detail-top"><div className="detail-title"><span className="eyebrow">JOB / {String(job.id).padStart(4,"0")}</span><h1>{job.name}</h1><div className="meta"><span>{job.client}</span><span>PM · {job.pm}</span><span>{job.city}</span><span>{job.salary}</span><span>HC {remainingHc}</span><span>更新 {job.feedback}</span></div></div><div className="big-score" style={{"--score":score} as React.CSSProperties}><span>{score}</span></div></div>
 <div className="conclusion"><div className="spark"><Sparkles/></div><div><b>建议优先投入</b><p>{job.reason}。当前推荐到面试转化较高，主要风险是面试池逐渐拥挤，建议提高推荐标准。</p></div><StatusTag s={job.status}/></div>
 <div className="grid g2"><section className="card"><div className="card-head"><h2>评分依据</h2><span>规则计算 + AI推断</span></div><div className="card-body score-bars">{["客户真实招聘意愿","职位新鲜度","HC 和紧急程度","客户反馈速度","推荐到面试转化","面试到 Offer 转化","当前竞争程度","历史交付风险"].map((n,i)=><div className="score-line" key={n}><span>{n}</span><div className="bar"><i style={{width:`${Math.min(100,(detailWeights[i]-(i%3))*100/detailWeights[i])}%`}}/></div><strong>{detailWeights[i]-(i%3)} / {detailWeights[i]}</strong></div>)}</div></section><section className="card"><div className="card-head"><h2>建议动作</h2><span>按影响排序</span></div><div className="card-body side-list">{["向PM确认剩余HC","确认当前面试进度","提高推荐标准","48小时无反馈则降低优先级"].map((x,i)=><div className="mini-item" key={x}><span className="num">0{i+1}</span><div><b>{x}</b><p>{i<2?"今天完成 · 高影响":"本周完成 · 中影响"}</p></div><button className="icon-btn" onClick={()=>notify(`已完成：${x}`)}><Check/></button></div>)}</div></section></div>
 <section className="card section"><div className="card-head"><h2>职位信号轨道</h2><span>每次判断均可追溯</span></div><SignalRail jobs={[job]} open={()=>{}}/></section>
 <div className="grid g2 section"><section className="card"><div className="card-head"><h2>招聘漏斗</h2><span>近 90 天</span></div><div className="card-body funnel">{[["推荐",recommended],["客户查看",Math.max(1,recommended-2)],["初面",interview],["复试",Math.max(1,interview-1)],["终面",offer+1],["Offer",offer],["入职",0]].map(x=><div className="funnel-step" key={x[0]}><b>{x[1]}</b><small>{x[0]}</small></div>)}</div></section><section className="card"><div className="card-head"><h2>当前竞争</h2><span>趋势上升</span></div><div className="card-body g3 grid">{[["参与顾问","4"],["已推荐",recommended],["面试 / Offer",`${interview} / ${offer}`]].map(x=><div className="mini-item" key={x[0]}><div><p>{x[0]}</p><b className="score">{x[1]}</b></div></div>)}</div></section></div>
 <div className="grid g2 section"><section className="card"><div className="card-head"><h2>客户反馈摘要</h2><span>AI结构化提取</span></div><div className="card-body side-list">{["最近反馈：商业化经验通过，需验证团队管理跨度","高频淘汰：行业深度不足、英文沟通欠缺","重点关注：AI广告客户资源、0→1团队经验","待确认：剩余HC与下一轮面试排期"].map(x=><div className="mini-item" key={x}><Sparkles/><b>{x}</b></div>)}</div></section><section className="card"><div className="card-head"><h2>新增项目事件</h2><span>将触发重新计算</span></div><div className="card-body"><div className="toolbar"><FilterSelect value={eventType} onChange={setEventType} ariaLabel="项目事件类型" options={["客户反馈","HC变化","面试变化","Offer变化","职位暂停","职位恢复","职位关闭"].map(value=>({value,label:value}))}/>{eventType==="HC变化"&&<input className="field" type="number" min={0} value={hc} onChange={e=>setHc(+e.target.value)}/>}<button className="btn primary" onClick={add}><Plus/>记录并重算</button></div><div className="timeline">{events2.map((e:string[],i:number)=><div className="event" key={`${e[0]}${i}`}><time>{e[0]}</time><i className="event-dot"/><div><b>{e[1]}</b><p>{e[2]}</p></div></div>)}</div></div></section></div></>
}

function ClientsView({clients,open,notify}:any){const [compare,setCompare]=useState<string[]>([]);const [stateFilter,setStateFilter]=useState("全部合作状态");const [sortBy,setSortBy]=useState("score");const [compareOpen,setCompareOpen]=useState(false);const visibleClients=[...clients].filter((client:any)=>stateFilter==="全部合作状态"||client.state===stateFilter).sort((a:any,b:any)=>sortBy==="feedback"?parseInt(a.feedback)-parseInt(b.feedback):sortBy==="hc"?(b.hc??-1)-(a.hc??-1):(b.score??-1)-(a.score??-1));const comparedClients=visibleClients.filter((client:any)=>compare.includes(client.name));const toggle=(name:string)=>{setCompareOpen(false);if(compare.includes(name))setCompare(compare.filter(x=>x!==name));else if(compare.length<3)setCompare([...compare,name]);else notify("最多对比 3 个客户")};const reset=()=>{setStateFilter("全部合作状态");setSortBy("score");setCompare([]);setCompareOpen(false);notify("客户筛选已重置")};return <><Heading code="CLIENT INTELLIGENCE" title="客户洞察" desc="识别真实招聘窗口、合作温度与交付风险。" action={<button className="btn" onClick={reset}><RotateCcw/>重置筛选</button>}/><div className="toolbar"><FilterSelect value={stateFilter} onChange={setStateFilter} ariaLabel="合作状态筛选" options={["全部合作状态","招聘窗口期","稳定合作","反馈降温"].map(value=>({value,label:value}))}/><FilterSelect value={sortBy} onChange={setSortBy} ariaLabel="客户排序方式" options={[{value:"score",label:"优先级 ↓"},{value:"feedback",label:"反馈速度 ↑"},{value:"hc",label:"总 HC ↓"}]}/>{comparedClients.length>1&&<button className="btn primary" onClick={()=>setCompareOpen(true)}><GitCompareArrows/>对比 {comparedClients.length}</button>}</div><section className="card"><div className="table-wrap"><table className="data-table"><thead><tr><th>对比</th><th>客户 / 行业</th><th>合作状态</th><th>活跃职位</th><th>总HC</th><th>平均反馈</th><th>推荐→面试</th><th>面试→Offer</th><th>历史入职</th><th>意愿</th><th>优先级</th><th>主要风险</th></tr></thead><tbody>{visibleClients.map((c:any)=><tr key={c.name}><td><input type="checkbox" checked={compare.includes(c.name)} onChange={()=>toggle(c.name)}/></td><td className="name-cell"><button className="link" onClick={()=>open(c)}><b>{c.name}</b></button><small>{c.industry}</small></td><td><StatusTag s={c.state}/></td><td>{c.active}</td><td>{c.hc??"—"}</td><td>{c.feedback}</td><td>{c.r2i}</td><td>{c.i2o}</td><td>{c.hires??"—"}</td><td>{c.intent}</td><td className="score">{c.score??"—"}</td><td>{c.risk}</td></tr>)}</tbody></table>{visibleClients.length===0&&<div className="empty"><Search/>没有符合当前筛选的客户</div>}</div></section>{compareOpen&&<ClientCompare clients={comparedClients} close={()=>setCompareOpen(false)}/>}</>}
function ClientCompare({clients,close}:{clients:any[];close:()=>void}){const dims:[string,(client:any)=>React.ReactNode][]=[["合作状态",client=>client.state],["活跃职位",client=>client.active],["总 HC",client=>client.hc??"待同步"],["平均反馈",client=>client.feedback],["推荐→面试",client=>client.r2i],["面试→Offer",client=>client.i2o],["历史入职",client=>client.hires??"—"],["招聘意愿",client=>client.intent],["优先级",client=><span className="score">{client.score??"—"}</span>],["主要风险",client=>client.risk]];return <><div className="drawer-backdrop" onClick={close}/><div className="modal"><div className="modal-head"><b>客户横向对比</b><button className="icon-btn" onClick={close} aria-label="关闭对比"><X/></button></div><div className="modal-body compare-grid"><div></div>{clients.map(client=><div key={client.name}><b>{client.name}</b></div>)}{dims.flatMap(([label,value])=><><div key={label}>{label}</div>{clients.map(client=><div key={`${label}${client.name}`}>{value(client)}</div>)}</>)}</div></div></>}
function ClientTable({rows,open}:any){return <div className="table-wrap"><table className="data-table"><thead><tr><th>客户</th><th>状态</th><th>活跃职位</th><th>总 HC</th><th>平均反馈</th><th>招聘意愿</th><th>优先级</th><th>主要风险</th><th>建议动作</th></tr></thead><tbody>{rows.map((c:any)=><tr key={c.name}><td><button className="link" onClick={()=>open(c)}><b>{c.name}</b></button></td><td><StatusTag s={c.state}/></td><td>{c.active}</td><td>{c.hc??"—"}</td><td>{c.feedback}</td><td>{c.intent}</td><td className="score">{c.score??"—"}</td><td>{c.risk}</td><td>确认本周面试排期</td></tr>)}</tbody></table></div>}
function ClientDetail({c,onBack,notify}:any){return <><button className="back" onClick={onBack}><ArrowLeft/>返回客户洞察</button><Heading code={`CLIENT / ${c.industry}`} title={c.name} desc={`优先级 ${c.score??"—"} · ${c.state} · 平均反馈 ${c.feedback}`} action={<button className="btn primary" onClick={()=>notify("客户反馈已记录并触发重新判断")}><Plus/>添加客户反馈</button>}/><div className="conclusion"><div className="spark"><Sparkles/></div><div><b>{c.name}当前处于集中招聘窗口期</b><p>近30天新增 {c.active} 个职位，平均反馈时间缩短至 {c.feedback}，建议提高交付优先级。</p></div></div><div className="grid g3">{[["活跃职位",c.active],["总 HC",c.hc??"—"],["历史入职",c.hires??"—"]].map(x=><div className="card card-body" key={x[0]}><span className="eyebrow">{x[0]}</span><div className="score" style={{fontSize:28,marginTop:8}}>{x[1]}</div></div>)}</div><div className="grid g2 section"><section className="card"><div className="card-head"><h2>当前活跃职位</h2><span>{c.active} 个</span></div><JobTable rows={jobs.filter(j=>j.client===c.name).concat(jobs.slice(0,Math.max(0,3-jobs.filter(j=>j.client===c.name).length)))} open={()=>notify("已打开关联职位")}/></section><section className="card"><div className="card-head"><h2>合作判断</h2><span>近6个月</span></div><div className="card-body side-list">{["人才偏好：头部AI商业化经验、团队从0到1","高频淘汰：缺少复杂销售经验","需求变更：近30天 2 次，处于可控范围","合作风险：面试标准近期小幅抬高","建议动作：锁定本周业务负责人面试档期"].map((x,i)=><div className="mini-item" key={x}><span className="num">0{i+1}</span><b>{x}</b></div>)}</div></section></div><section className="card section"><div className="card-head"><h2>客户事件时间线</h2><span>可追溯</span></div><div className="card-body timeline">{events.concat([["06-28","新增职位","新增 AI 解决方案销售，HC 3"],["06-04","需求变化","薪资上限提高 15%"]]).map(e=><div className="event" key={e[0]}><time>{e[0]}</time><i className="event-dot"/><div><b>{e[1]}</b><p>{e[2]}</p></div></div>)}</div></section></>}

function Alerts({setExtraTasks,notify,setDrawer}:any){const alerts=["云帆智能连续7天未反馈","商业化增长经理转化率下降12%","海外增长负责人面试池已拥挤","星河科技进入招聘窗口期","Creator Partnership负责人新增2个HC","棱镜互动近14天需求变更3次","AI解决方案销售参与顾问增至6人","用户增长负责人产生Offer"];const [handled,setHandled]=useState<number[]>([]);const [riskFilter,setRiskFilter]=useState("全部风险等级");const [clientFilter,setClientFilter]=useState("全部客户");return <><Heading code="DYNAMIC ALERTS" title="动态预警" desc="聚合需要人工确认的机会、变化和失活信号。"/><div className="toolbar"><FilterSelect value={riskFilter} onChange={setRiskFilter} ariaLabel="预警风险等级" options={["全部风险等级","高风险","机会"].map(value=>({value,label:value}))}/><FilterSelect value={clientFilter} onChange={setClientFilter} ariaLabel="预警客户筛选" options={[{value:"全部客户",label:"全部客户"},...clients.map(client=>({value:client.name,label:client.name}))]}/></div><section className="card"><div className="actions">{alerts.map((x,i)=><div className="action-row" key={x} style={{opacity:handled.includes(i)?.5:1}}><StatusTag s={i%3===0?"高风险":i%3===1?"关注":"机会"}/><div className="action-main"><b>{x}</b><small>{i%2?"基于近7天业务事件变化":"超过预设阈值，建议今天确认"}</small></div><div className="impact"><strong>{i%3===2?"机会升温":"需人工确认"}</strong>置信度 {88+i}%</div><div className="row-actions"><button className="btn" onClick={()=>setDrawer(x)}>依据</button><button className="btn" onClick={()=>{setExtraTasks((v:string[])=>v.includes(x)?v:[...v,x]);notify("已转为今日任务")}}>转任务</button><button className="icon-btn" onClick={()=>{setHandled([...handled,i]);notify("预警已处理")}}><Check/></button></div></div>)}</div></section></>}
function Rules({weights,setWeights,notify,mode,policy,keywords,note,onSaveKeywords}:any){const names=["项目推进","探索机会","个人适配"];const notes=["阶段、动量、转化、HC 空间与竞争度","新鲜度、方向匹配、有效 HC 与低竞争","顾问关系、容量、历史交付与战略方向"];const total=weights.reduce((a:number,b:number)=>a+b,0);const canApply=total===100;const [keywordDraft,setKeywordDraft]=useState((keywords||[]).join("、"));const [noteDraft,setNoteDraft]=useState(note||"");const [nlDraft,setNlDraft]=useState("");const [nlResult,setNlResult]=useState<string|null>(null);const applyNaturalLanguage=()=>{const text=nlDraft.trim();if(!text){notify("先写一句你的判断偏好");return}const intent={process:0,explore:0,personal:0};if(/推进|在途|收口|交付|项目|阶段|动能|推进力/.test(text))intent.process+=12;if(/探索|新机会|新方向|广度|尝新|验证/.test(text))intent.explore+=12;if(/个人|匹配|擅长|方向|经历|偏好/.test(text))intent.personal+=12;if(/均衡|平衡|默认|恢复/.test(text)){setWeights([60,25,15]);setNlResult("已恢复默认：推进 60% · 探索 25% · 个人 15%");notify("策略已按均衡偏好重置");return}const strength=Math.max(1,intent.process+intent.explore+intent.personal);const w=[60,25,15];const idx={process:0,explore:1,personal:2} as const;(Object.keys(idx) as (keyof typeof idx)[]).forEach(k=>{w[idx[k]]+=Math.round(intent[k]*60/strength)});const w2=w.map(n=>Math.max(5,Math.min(80,n)));const sum=w2.reduce((a,b)=>a+b,0);w2[w2.indexOf(Math.max(...w2))]+=100-sum;setWeights(w2);const matched=["项目推进","探索机会","个人适配"].filter((_,i)=>w2[i]!==[60,25,15][i]);setNlResult(`Agent 已理解：${matched.length?matched.join("、")+" 偏好":"保持默认侧重"} → 推进 ${w2[0]}% · 探索 ${w2[1]}% · 个人 ${w2[2]}%`);notify("已按自然语言生成策略，确认后保存")};return <><Heading code="POLICY / FELIX V1.3" title="判断逻辑" desc="调整关注侧重点，不等于手工指定职位排名；HC、已入职和关闭状态始终是硬规则。" action={<div className={`tag ${canApply?"blue":"orange"}`}>当前合计 {total}%{canApply?"":" · 需为 100%"}</div>}/>{mode==="connected"&&<section className="card section"><div className="card-head"><h2>Brain X 后端策略</h2><span>Policy {policy||"—"}</span></div><div className="card-body"><p className="panel-caption">分数与排序由后端六维确定性评分决定（policy_version：{policy||"—"}）；前端只展示结果，不在浏览器内重新计算。</p>{BACKEND_WEIGHTS.map(w=><div className="mini-item" key={w.dim}><div><b>{w.label}</b><p>后端固定权重，不可在前端调整</p></div><strong style={{marginLeft:"auto",color:"var(--blue)"}}>{w.weight}</strong></div>)}<div className="toolbar" style={{marginTop:14}}><input className="field" value={keywordDraft} onChange={e=>setKeywordDraft(e.target.value)} placeholder="画像关键词（顿号分隔，如：增长、投放、广告）"/><input className="field" value={noteDraft} onChange={e=>setNoteDraft(e.target.value)} placeholder="画像备注（可选）"/><button className="btn primary" onClick={()=>onSaveKeywords(keywordDraft.split(/[、,，\s]+/).filter(Boolean),noteDraft)}><Check/>保存画像</button></div></div></section>}<section className="card section nl-rule-card"><div className="card-head"><h2>自然语言描述偏好</h2></div><div className="card-body"><div className="toolbar nl-toolbar"><textarea className="field nl-input" value={nlDraft} onChange={e=>setNlDraft(e.target.value)} placeholder="例：我更看重在途项目的推进，少花时间在探索新机会上"/><button className="btn primary" onClick={applyNaturalLanguage}><Sparkles/>生成策略</button></div>{nlResult&&<p className="nl-result"><Check/>{nlResult}</p>}</div></section><div className="grid g2"><section className="card"><div className="card-head"><h2>三层软权重</h2><button className="link" onClick={()=>{setWeights([60,25,15]);notify("已恢复默认策略")}}>恢复默认</button></div><div className="card-body strategy-rules">{names.map((n,i)=><label className="rule-row" key={n}><span><b>{n}</b><small>{notes[i]}</small></span><input type="range" min="5" max="80" value={weights[i]} onChange={e=>{const w=[...weights];w[i]=+e.target.value;setWeights(w)}}/><output>{weights[i]}%</output></label>)}<button className="btn primary" style={{marginTop:16}} disabled={!canApply} onClick={()=>notify("策略已保存；后端将生成新的 policy_version 和推荐快照")}><Check/>保存并生成新推荐</button>{!canApply&&<p className="rule-validation">三层权重总和需为 100%，才能提交给 Agent 重新计算。</p>}<p className="policy-boundary"><ShieldCheck/>不可调整：HC、已入职、职位关闭、项目归属与数据冲突规则。</p></div></section><section className="card"><div className="card-head"><h2>影响预览</h2><span>由 Agent 返回</span></div><div className="card-body"><div className="conclusion"><div className="spark"><Activity/></div><div><b>只预览软排序变化</b><p>正式保存前展示哪些职位上升、下降，以及仍被硬规则拦截的职位。</p></div></div>{[["项目推进","当前 60%","强化在途项目与真实反馈"],["探索机会","当前 25%","保留新项目验证空间"],["个人适配","当前 15%","只做个人修正，不覆盖项目事实"]].map(x=><div className="mini-item" key={x[0]}><div><b>{x[0]}</b><p>{x[2]}</p></div><strong style={{marginLeft:"auto",color:"var(--blue)"}}>{x[1]}</strong></div>)}</div></section></div></>}
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
function Sources({notify}:any){return <><Heading code="DATA SOURCES" title="数据源" desc="演示数据源面板；当前后端没有对应的统一数据源 API，不代表真实外部账号已连接。"/><div className="source-grid"><TalentBackendCard/>{sourceNames.map((n,i)=><section className="card source" key={n}><div className="source-head"><div className="source-icon"><Database/></div><StatusTag s="演示"/></div><h3>{n}</h3><p>演示状态 · 尚未接入 BrainX 数据源接口</p><div className="completeness"><span>数据完整度</span><b>—</b></div><div className="bar"><i style={{width:"0%",background:"var(--orange)"}}/></div><button className="btn" style={{marginTop:14}} onClick={()=>notify("数据源字段查看仍为演示交互，不会写入真实系统")}><Settings2/>查看字段</button></section>)}</div></>}
