# B-tex 职位决策台

面向猎头顾问的职位判断与承接工作台前端原型。它把候选职位、判断依据、承接状态、结果回写、同步状态与通知收在一个可交互的本地演示中。

> 在 BrainX 单地址运行模式下，工作台、承接、结果、回放、雷达、客户洞察、画像、同步和 SSE 通知均通过 `app/brainx-api.ts` 使用真实后端接口。后端不可达或未登录时才回退到本地演示状态；动态预警、数据源展示和推送预览仍明确标记为演示模块。

## 先在本地跑起来

前提：安装可运行本仓库依赖的 Node.js 与 npm。

```bash
npm install
npm run dev
```

集成到 BrainX 后，打开 <http://127.0.0.1:3100>。BrainX 会自动启动内部 Vinext 服务并代理页面；独立开发时才使用终端输出的前端端口。

常用验证命令：

```bash
# 构建并运行仓库的工作台验证
npm test

# 生产构建
npm run build

# 静态检查
npm run lint
```

如果想从干净的演示状态重新开始，请在浏览器开发者工具中删除 `localStorage` 的 `decision-workbench` 键，或清除该站点的本地数据后刷新。

## 这个项目能做什么

| 模块 | 用途 | 关键交互 |
| --- | --- | --- |
| 什么值得做 | 把职位按实时承接状态分为“已接单区”和“待接单区” | 点击任意职位打开右侧详情；详情打开时，当前所在分区自动排在前面 |
| 职位雷达 | 浏览市场信号和驾驶舱导入岗位 | 搜索、职位类型/状态筛选、排序、列表/信号轨道切换 |
| 客户洞察 | 查看客户招聘窗口、风险与职位概况 | 过滤、排序、最多三家客户对比 |
| 动态预警 | 处理需要确认的变化 | 查看依据、转成今日任务、标记已处理 |
| 判断策略 | 调整三层软权重 | 只有总和为 100% 才允许保存演示策略 |
| 同步、身份与通知 | connected 模式使用 BrainX；离线时为演示回退 | 全部在同一右侧面板内打开，不离开当前页面 |

## 职位承接与结果：先理解这条状态流

首页分区不是固定的职位清单，而是由当前 `engagement` 状态计算。初始有 3 个已接单、10 个待接单；释放或接单后，职位会自动移动到对应区域。

| 当前状态 | 合法下一步 | 结果区域表现 |
| --- | --- | --- |
| 未开始 / 已推荐 / 已查看 | 关注、暂不考虑 | 说明需先接单才能回写结果 |
| 关注中 | 取消关注、接单、暂不考虑 | 说明需接单后才能回写结果 |
| 已接单 | 释放、完成 | 可记录推荐采纳、面试、Offer、入职、关闭、反馈 |
| 已释放 | 重新关注、暂不考虑 | 保留已记录结果；重新关注后可再次接单 |
| 暂不考虑 | 重新关注 | 保留拒绝原因与轨迹 |
| 已完成 | 无新的承接动作 | 结果归档，可在“回放”查看当时判断与后续结果 |

重要业务边界：

- `职位关系 = 未加入` 或 `eligibility !== ELIGIBLE` 时，前端不得显示关注或接单；只能先做后端允许的核验动作。
- `UNKNOWN` 是未知事实，不可展示成 `0`，也不可被前端拿去做乐观判断。
- HC 已确认 `0` 的职位不能进入正式推荐。
- 分数由后端决定；前端仅展示 `项目推进`、`探索机会`、`个人适配` 与 `最终得分`，不在浏览器内重新计算排序。

## 给接手 Agent 的代码地图

| 路径 | 职责 | 先看什么 |
| --- | --- | --- |
| [`app/page.tsx`](./app/page.tsx) | 页面入口 | 只挂载 `DecisionWorkbench` |
| [`app/workbench.tsx`](./app/workbench.tsx) | 主界面、交互、局部 mock、右侧面板与持久化 | `DecisionWorkbench`、`DecisionToday`、`EngagementPanel`、`applyCommand` |
| [`app/decision-demo.ts`](./app/decision-demo.ts) | 与 BrainX 对齐的前端领域类型和演示状态 | `EngagementState`、`EngagementCommand`、`SyncStatus`、`Outcome`、`Notification` |
| [`app/cockpit-radar-data.ts`](./app/cockpit-radar-data.ts) | 由 TTC 驾驶舱工作簿整理出的职位雷达基础数据 | 仅保留原始导入事实，不补造运营指标 |
| [`app/globals.css`](./app/globals.css) | Apple/liquid-glass 样式、响应式布局与抽屉动画 | `.decision-zones`、`.decision-drawer`、移动端断点 |
| [`tests/rendered-html.test.mjs`](./tests/rendered-html.test.mjs) | 工作台关键约束回归测试 | 分区、承接权限、UNKNOWN、响应式抽屉、驾驶舱导入 |

`app/workbench.tsx` 目前集中承载了界面和演示数据，便于原型迭代。接入真实服务时，优先拆出数据适配层，而不是让页面组件直接请求接口。

## 后端接入时如何替换 mock

建议保留现有领域类型和页面行为，只替换数据与命令的来源。

1. 用 `workbench`、`recommendations`、`opportunities`、`engagement`、`outcomes`、`replay` 的真实响应替代 `decisionSeeds`、`verificationJobs`、`seedSync` 等演示数据。
2. 后端返回每个职位的 `eligibility`、`engagementState` 与 `legalActions`；前端只渲染这些允许动作，不能自行推断权限。
3. 将 `applyCommand`、`recordOutcome`、`runDecisionAction` 改为调用命令接口；仅在成功响应后更新本地视图，失败时展示可理解的错误提示。
4. 将当前 `localStorage` 写入逻辑保留为离线演示或 optimistic UI 缓存，而不是业务事实来源。
5. 保持“回放”使用后端提供的冻结快照；当前事实和后续结果不得改写当时判断。

下面是接入方向，不是当前仓库已经存在的接口：

```ts
type WorkbenchAdapter = {
  getSnapshot(): Promise<{
    jobs: DecisionJob[];
    sync: SyncStatus;
    notifications: Notification[];
  }>;
  runEngagementCommand(jobId: string, command: EngagementCommand, reason?: string): Promise<void>;
  recordOutcome(jobId: string, outcome: Omit<Outcome, "id" | "at">): Promise<void>;
};
```

## 后端已接入：Brain X（`btex/brainx`）

本仓库已完成与 [Brain X 后端](https://github.com/zhongxiaomi06-sudo/brainx)（零依赖 Node ≥22.5 + SQLite + 飞书 OAuth）的对接。适配层集中在 `app/brainx-api.ts`，并为已接入 API 定义响应契约类型：

- 纯函数映射器（`mapRecommendation` / `mapSyncStatus` / `mapEvents` / `mapOutcomes` / `mapReplayData` 等）把后端 snake_case 响应映射为工作台类型；HC 为 `null` 时展示 `UNKNOWN`，绝不当成 0。
- `brainxFetch<T>()` 统一处理成功响应、两种错误信封和 401/409/422/5xx 错误分类；connected 交互只使用后端返回的 `legal_actions`。
- `getSnapshot()` 一次拉取 工作台概览 + Top10 推荐 + 逐职位详情（承接态 / `legal_actions` / 事件 / 结果 / 决策编号）+ 画像。
- 承接命令走 `POST /api/v1/opportunities/:id/engagement`：每个手势生成幂等键，`ACCEPT` 二次确认（`confirm:true`），`DISMISS` 必传后端枚举原因；允许动作**一律以后端返回的 `legal_actions` 为准**，前端不自行推断权限。
- 结果回写 `POST /api/v1/outcomes`、回放 `GET /api/v1/decisions/:id/replay`（冻结快照）、同步 `POST /api/v1/sync-runs` + `POST /api/v1/recommendations/run`、通知 `GET /api/v1/events`（SSE）、画像 `GET/PUT /api/v1/profile`。

### 一起跑起来

```bash
# 1. 后端（BrainX 根目录）
cp .env.example .env      # 本地开发写入：BRAINX_DEV_AUTH=1、BRAINX_BRIDGE_OFF=1
node src/server.js        # http://127.0.0.1:3100，自动启动并代理本前端

# 2. 独立前端开发（可选）
npm run dev -- -H 0.0.0.0 -p 4320
```

打开页面后点右上角身份 → 「登录 Brain X 后端」选择顾问（felix/mia/york 等，开发后门 `BRAINX_DEV_AUTH=1`）。首次登录若同步面板显示「尚未同步」，点「重新同步」即可拉取 fixture 快照并冻结新推荐（也可在后端跑 `node bin/brainx-sync.mjs && node bin/brainx-recommend.mjs`）。

想让职位雷达带上驾驶舱条目（`cockpit_facts`，20 个），在后端跑一次适配器（无 LLM Key 走确定性关键词回退）：

```bash
cd ../brainx && node bin/brainx-adapter.mjs
```

### 运行模式

| 模式 | 触发条件 | 表现 |
| --- | --- | --- |
| **connected** | 后端可达且已登录 | 侧栏底部显示「BrainX 已连接」+ 后端 policy_version；数据全部来自 API；顶栏快照号为真实 snapshot id |
| **offline（演示回退）** | 后端不可达 / 未登录 | 沿用 seed 数据 + `localStorage`，侧栏标注「演示模式」；身份面板仍提供后端登录入口 |

正式环境的飞书 OAuth 登录流程已由后端实现（`/api/v1/oauth/*`），本地无 App Secret 时用开发后门即可。

### 与后端的对齐修正

后端 `src/engagement.js` 的状态机原缺「已释放 / 暂不考虑 → 重新关注」迁移（其冷却期守卫因此永远不可达）。已在 `btex/brainx` 本地补上 `WATCH.from += RELEASED/DISMISSED`、`DISMISS.from += RELEASED`，与前端交付契约一致；`DISMISSED` 重新关注仍受 30 天冷却期拦截。

### 验证

- `npm test`：构建 + 8 个 rendered-html 回归 + 10 个适配器映射单测（`tests/brainx-adapter.test.mjs`）。
- `node tests/e2e-browser-check.mjs`：headless Chrome 全链路（登录 → 连接 → 关注 → 接单确认 → 回写结果 → 刷新持久化 → 暂不考虑原因枚举 → 冷却期拦截 → 同步 → 退出回退），需前后端都已启动。
- 后端测试：`cd ../brainx && npm test`（96 例）。

### 明确保持演示态的模块

动态预警、数据源页和推送预览仍是本地演示数据（后端暂无对应端点）；这些页面会明确显示演示/尚未接入说明。判断策略页的三层滑块编辑器在离线模式下可用，connected 模式展示后端固定六维权重与 `policy_version`，并通过 `/api/v1/profile` 编辑画像关键词。

职位雷达与客户洞察已接入后端：

- `GET /api/v1/radar`：候选池职位（`job_facts` + `cockpit_facts` 按 project_id 合并，20 个驾驶舱条目）+ 关系标注 + 承接态；connected 模式下雷达列表与「驾驶舱导入/市场信号」过滤全部来自该接口。
- `GET /api/v1/clients`：按公司聚合候选池职位，只呈现可数事实（职位数、活跃职位、已知 HC、最近活动）；评分/转化/招聘意愿等运营指标显示「待后端」，不补造。

## 手动验收清单

在提交或交接前，至少验证：

- 点击一整行职位可以打开右侧详情；重复点击同一行或点击关闭按钮可以收起；`Esc` 也能关闭。
- 打开“承接与结果”后，已接单职位可记录结果；释放后出现“重新关注”，并从已接单区移动到待接单区。
- 未加入项目不会出现接单按钮；核验职位显示前置条件而不是伪造可执行操作。
- 切换“判断 / 承接与结果 / 决策轨迹 / 回放”不会打开新页面。
- 缩窄窗口或打开详情抽屉时，主内容会重排，不被侧栏遮挡；移动端详情为全宽面板。
- 刷新页面后，已执行的演示操作、结果记录、同步/授权状态仍保留。

## 验证依据

当前自动测试覆盖接口映射、错误分类、双分区、承接状态驱动分区、权限边界、结果回写入口、回放、同步、通知、侧栏承接列表、策略硬规则，以及驾驶舱数据导入不虚构运营事实。

```bash
npm test
```

如果 `npm run lint` 报展示页的 `<a>` / `Link` 规则错误，请先确认报错是否位于 `app/showcase/`。这些展示页规则与主工作台的功能验证相互独立，修复时不要顺手改动工作台逻辑。

## 当前限制

- 真实飞书 OAuth 仍需后端配置 App Secret；本地可用 `BRAINX_DEV_AUTH=1`。
- 动态预警、数据源和推送预览没有对应后端 API，不能视作生产事实。
- offline 的本地状态、演示提示或 UI 截图不能作为后端已经写入的证据。
