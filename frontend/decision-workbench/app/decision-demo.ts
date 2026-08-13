// Local, contract-shaped BrainX demo data. Replace this module with an API adapter when the backend is connected.
export type DecisionGroup = "RESULT_CLOSURE"|"ACTIVE_ADVANCEMENT"|"NEW_VALIDATION"|"MAINTENANCE"|"EXCLUDE";
export type Eligibility = "ELIGIBLE"|"VERIFY_REQUIRED"|"BLOCKED"|"EXCLUDED";
export type DecisionAction = {id:string;label:string;kind:"verify"|"advance"|"watch"|"skip";detail:string};
export type EngagementState = "NEW"|"RECOMMENDED"|"VIEWED"|"WATCHED"|"ACCEPTED"|"DISMISSED"|"RELEASED"|"COMPLETED";
export type EngagementCommand = "WATCH"|"UNWATCH"|"ACCEPT"|"DISMISS"|"RELEASE"|"COMPLETE";
export type SyncState = "READY"|"RUNNING"|"INCOMPLETE"|"AUTH_EXPIRED"|"ERROR"|"EMPTY";
export type SyncStatus = {state:SyncState;updatedAt:string|null;rowsRead?:number;rowsExpected?:number;errors?:string[]};
export type AuthStatus = {consultant:string;authorized:boolean;needsReauth:boolean};
export type DecisionEvent = {id:string;type:string;at:string;reason?:string};
export type Outcome = {id:string;stage:"推荐采纳"|"面试"|"Offer"|"入职"|"关闭"|"反馈";rating?:number;note?:string;at:string};
export type DecisionReplay = {decisionId:string;runId:string;snapshotAt:string;policyVersion:string;rank:number;reasons:string[];risks:string[];evidence:string[]};
export type Notification = {id:string;kind:"DAILY_TOP3"|"SYNC_ALERT"|"COMMITMENT";title:string;detail:string;jobId?:string;read:boolean};

export type DecisionJob = {
 id:string;rank:number;company:string;role:string;group:DecisionGroup;eligibility:Eligibility;
 globalScore:number;personalScore:number;finalScore:number;evidenceCoverage:number|null;
 recommendation:string;recentSignal:string;facts:Record<string,string>;scoreNotes:string[];evidence:string[];actions:DecisionAction[];
 engagementState:EngagementState;legalActions:EngagementCommand[];events:DecisionEvent[];outcomes:Outcome[];replay:DecisionReplay;
};

export const decisionGroupMeta:Record<DecisionGroup,{title:string;subtitle:string}>={
 RESULT_CLOSURE:{title:"结果收口",subtitle:"别丢单，先把当前结果确认下来"},
 ACTIVE_ADVANCEMENT:{title:"高动能推进",subtitle:"现在有真实动能，优先顺势推进"},
 NEW_VALIDATION:{title:"新机会验证",subtitle:"值得看，但先验证关键事实"},
 MAINTENANCE:{title:"维护观察",subtitle:"项目仍有效，暂不抢占今天注意力"},
 EXCLUDE:{title:"暂不推荐",subtitle:"硬条件不符合，不进入正式推荐"},
};

const replay=(id:string,rank:number,reasons:string[],risks:string[],evidence:string[]):DecisionReplay=>({decisionId:`D-${id.slice(4)}`,runId:"RUN-1842",snapshotAt:"2026-08-10 11:28",policyVersion:"Policy v1.2",rank,reasons,risks,evidence});
export const seedDecisionJobs:DecisionJob[]=[
 {id:"PRJ-1829",rank:1,company:"Nooklab",role:"DTC负责人",group:"RESULT_CLOSURE",eligibility:"VERIFY_REQUIRED",globalScore:82,personalScore:74,finalScore:79.6,evidenceCoverage:71,recommendation:"确认 Offer 状态和剩余 HC",recentSignal:"项目详情暂无权限查看",facts:{"职位关系":"OWNER","Offer 状态":"UNKNOWN","剩余 HC":"UNKNOWN","最近活动":"08-08","历史 Pipeline":"推荐 12 · 面试 3 · Offer 1"},scoreNotes:["当前有效 Offer 状态未确认，不能把历史 Offer 视为在途。","剩余 HC 未确认，机会空间不参与乐观推断。","Felix 与项目关系明确，但只作为个人修正。"],evidence:["项目快照 · 08-08 11:28","权限状态 · 项目详情受限","历史 Pipeline · 仅累计记录"],actions:[{id:"offer",label:"确认 Offer 状态",kind:"verify",detail:"补齐当前有效状态"},{id:"hc",label:"确认剩余 HC",kind:"verify",detail:"补齐机会空间事实"}],engagementState:"VIEWED",legalActions:["WATCH","DISMISS"],events:[{id:"evt-1",type:"已查看",at:"08-10 11:31"}],outcomes:[],replay:replay("PRJ-1829",1,["项目关系明确，当前阶段具备优先验证价值。"],["Offer 与 HC 为 UNKNOWN，不能按历史 Pipeline 乐观推断。"],["项目快照 · 08-08 11:28","权限状态 · 项目详情受限"])},
 {id:"PRJ-1674",rank:2,company:"科漫智能",role:"海外增长负责人",group:"ACTIVE_ADVANCEMENT",eligibility:"ELIGIBLE",globalScore:80,personalScore:68,finalScore:76.4,evidenceCoverage:91,recommendation:"建议继续推进",recentSignal:"2 天内新增客户反馈",facts:{"职位关系":"SHARED","当前阶段":"二面推进","剩余 HC":"2","最近活动":"08-09","历史 Pipeline":"推荐 9 · 面试 4 · Offer 0"},scoreNotes:["客户反馈持续且阶段发生跃迁。","剩余 HC 已确认，当前仍有可承接空间。","个人容量可用，但不改变项目优先级。"],evidence:["客户反馈 · 08-09","阶段事件 · 二面推进","职位快照 · HC 2"],actions:[{id:"advance",label:"继续推进",kind:"advance",detail:"今天补充高匹配候选人"},{id:"watch",label:"加入观察",kind:"watch",detail:"保留本周提醒"}],engagementState:"WATCHED",legalActions:["UNWATCH","ACCEPT","DISMISS"],events:[{id:"evt-2",type:"已关注",at:"08-09 16:20"}],outcomes:[],replay:replay("PRJ-1674",2,["反馈持续、二面推进，剩余 HC 已确认。"],["与项目为团队共享关系。"],["客户反馈 · 08-09","阶段事件 · 二面推进","职位快照 · HC 2"])},
 {id:"PRJ-1912",rank:3,company:"CurioSea",role:"GTM负责人",group:"NEW_VALIDATION",eligibility:"VERIFY_REQUIRED",globalScore:73,personalScore:70,finalScore:72.1,evidenceCoverage:58,recommendation:"先确认项目归属",recentSignal:"未加入 · 项目归属待确认",facts:{"职位关系":"NOT_JOINED","项目归属":"UNKNOWN","剩余 HC":"UNKNOWN","最近活动":"08-09","历史 Pipeline":"暂无可用记录"},scoreNotes:["新项目信号积极，但尚未确认归属。","未加入职位不能出现承接动作。","HC 未确认，证据覆盖不足。"],evidence:["职位发布 · 08-09","归属字段 · 缺失","项目状态 · 待确认"],actions:[{id:"ownership",label:"确认项目归属",kind:"verify",detail:"确认是否允许承接"},{id:"status",label:"确认项目状态",kind:"verify",detail:"确认当前是否有效"}],engagementState:"NEW",legalActions:[],events:[],outcomes:[],replay:replay("PRJ-1912",3,["新项目信号积极。"],["尚未加入项目，归属与 HC 都未确认。"],["职位发布 · 08-09","归属字段 · 缺失"])},
 {id:"PRJ-1733",rank:4,company:"Lynk & Co",role:"用户增长负责人",group:"ACTIVE_ADVANCEMENT",eligibility:"ELIGIBLE",globalScore:78,personalScore:71,finalScore:75.9,evidenceCoverage:88,recommendation:"锁定客户反馈窗口",recentSignal:"24 小时内完成初面反馈",facts:{"职位关系":"OWNER","当前阶段":"初面反馈","剩余 HC":"1","最近活动":"08-10","历史 Pipeline":"推荐 8 · 面试 3 · Offer 0"},scoreNotes:["反馈时效明显好于项目池中位数。","当前阶段具备推进动能。"],evidence:["客户反馈 · 08-10","阶段记录 · 初面","HC 字段 · 1"],actions:[{id:"schedule",label:"锁定反馈窗口",kind:"advance",detail:"确认下一轮面试排期"}],engagementState:"ACCEPTED",legalActions:["RELEASE","COMPLETE"],events:[{id:"evt-3",type:"已接单",at:"08-10 09:12"}],outcomes:[{id:"out-1",stage:"面试",rating:4,note:"已完成初面反馈",at:"08-10 10:18"}],replay:replay("PRJ-1733",4,["反馈窗口明确，阶段具备推进动能。"],["当前剩余 HC 仅 1。"],["客户反馈 · 08-10","HC 字段 · 1"])},
 {id:"PRJ-1608",rank:8,company:"零一万物",role:"海外产品负责人",group:"MAINTENANCE",eligibility:"ELIGIBLE",globalScore:65,personalScore:69,finalScore:66.2,evidenceCoverage:83,recommendation:"维持观察，不抢占今天注意力",recentSignal:"近 5 天无新增阶段事件",facts:{"职位关系":"SHARED","当前阶段":"推荐中","剩余 HC":"1","最近活动":"08-05","历史 Pipeline":"推荐 6 · 面试 1 · Offer 0"},scoreNotes:["项目仍有效，但近期未出现实质推进。"],evidence:["项目快照 · 08-05","HC 字段 · 1"],actions:[{id:"watch",label:"加入观察",kind:"watch",detail:"下次活动后重新判断"}],engagementState:"RECOMMENDED",legalActions:["WATCH","DISMISS"],events:[],outcomes:[],replay:replay("PRJ-1608",8,["职位仍有效。"],["近期无新增阶段事件。"],["项目快照 · 08-05"])},
 {id:"PRJ-1498",rank:22,company:"云帆智能",role:"海外渠道销售",group:"EXCLUDE",eligibility:"EXCLUDED",globalScore:31,personalScore:62,finalScore:40.3,evidenceCoverage:96,recommendation:"已确认 HC 为 0",recentSignal:"客户确认职位关闭",facts:{"职位关系":"OWNER","当前状态":"CLOSED","剩余 HC":"0","最近活动":"08-08","历史 Pipeline":"推荐 11 · 面试 1 · Offer 0"},scoreNotes:["剩余 HC 已确认 0，不能进入今日推荐。"],evidence:["客户确认 · 08-08","HC 字段 · 0"],actions:[{id:"skip",label:"查看排除原因",kind:"skip",detail:"保留审计记录"}],engagementState:"DISMISSED",legalActions:[],events:[{id:"evt-4",type:"已排除",at:"08-08 14:20",reason:"HC 已关闭"}],outcomes:[],replay:replay("PRJ-1498",22,["项目归属明确。"],["HC 已确认为 0，职位关闭。"],["客户确认 · 08-08","HC 字段 · 0"])},
];

export const seedSync:SyncStatus={state:"READY",updatedAt:"11:28",rowsRead:37,rowsExpected:37};
export const seedAuth:AuthStatus={consultant:"Felix",authorized:true,needsReauth:false};
export const seedNotifications:Notification[]=[
 {id:"daily",kind:"DAILY_TOP3",title:"三方向 Top 3 已生成",detail:"投放、增长负责人、市场负责人等待判断",jobId:"JU87P01",read:false},
 {id:"commit",kind:"COMMITMENT",title:"2 个承接需要处理",detail:"39-AI 与科漫智能仍有下一动作",jobId:"JVS2PHH",read:false},
 {id:"sync",kind:"SYNC_ALERT",title:"同步状态正常",detail:"当前完整快照已进入本轮职位判断",read:true},
];

export const actionLabel:Record<EngagementCommand,string>={WATCH:"关注",UNWATCH:"取消关注",ACCEPT:"接单",DISMISS:"暂不考虑",RELEASE:"释放",COMPLETE:"完成"};
export const stateLabel:Record<EngagementState,string>={NEW:"未开始",RECOMMENDED:"已推荐",VIEWED:"已查看",WATCHED:"关注中",ACCEPTED:"已接单",DISMISSED:"暂不考虑",RELEASED:"已释放",COMPLETED:"已完成"};
