# Brain X 决策工作台前端

这是独立的 React/Next 前端原型，保留在 Brain X 仓库中，避免覆盖当前 `public/` 的零依赖生产界面。

它呈现同步、授权、推荐、承接、结果、决策轨迹、冻结回放和通知的完整可演示状态；全部数据位于 `app/decision-demo.ts`，不会调用飞书、推送服务或 Brain X 接口。

## 启动

```bash
cd frontend/decision-workbench
npm install
npm run dev
```

## 后端接入点

未来将 `app/decision-demo.ts` 的本地状态适配为 Brain X 的 `workbench`、`recommendations`、`opportunities`、`engagement`、`outcomes`、`replay` 与同步接口即可。界面不会自行计算排序，也不会将 `UNKNOWN` 当作 0。

当前的 `public/` 界面仍保持不变；两套前端可以并存，待接口契约确认后再决定是否替换入口。
