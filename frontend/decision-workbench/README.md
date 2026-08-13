# 客户与职位决策工作台

面向猎头顾问和 Team Leader 的 AI-native 业务决策原型。当前 MVP 只覆盖客户、职位、项目动态、评分、预警与今日行动，不包含候选人、人才库或搜寻功能。

## 启动

```bash
npm install
npm run dev
```

生产构建：`npm run build`。

## 页面结构

- 今日决策：业务结论、今日动作、重点职位/客户、今日变化
- 职位雷达：决策列表、信号轨道、筛选排序和 2–3 项对比
- 职位详情：评分依据、信号轨道、漏斗、反馈、竞争、事件新增与重算
- 客户洞察与详情：招聘窗口、合作温度、风险、活跃职位和事件
- 动态预警：处理、稍后、转今日任务
- 决策规则：权重调整、影响预览、保存和恢复默认
- 数据源：模拟连接、权限、同步和字段完整度

用户处理状态、今日任务和评分权重保存在浏览器 `localStorage`。

## 数据模型

`Job` 包含客户、PM、地点、薪资、HC、状态、评分、反馈时间、推荐/面试/Offer 数和判断原因。客户聚合活跃职位、总 HC、反馈速度、转化、招聘意愿、优先级与合作风险。事件是所有评分变化的可追溯来源。

## 未来人才侧接口

当前评分不依赖人才数据。未来应在独立适配层 `adapters/talent-supply.ts` 接入：

```ts
export interface TalentSupplySnapshot {
  jobId: string;
  matchableTalentCount: number;
  supplyDifficulty: "low" | "medium" | "high";
  matchingSuggestion: string;
  reactivatableTalentCount: number;
  calculatedAt: string;
  source: string;
}
```

建议提供 `GET /api/jobs/:jobId/talent-supply`，由适配层转换为上述快照；在开关启用前不得进入客户或职位基础评分。
