# Brain X · 职位决策工作台 — 开箱即用

## 0. 云版（零安装，推荐）

**http://47.110.93.137:3100** — 浏览器打开 → 飞书授权 → 自己的工作台。
mia / felix / york 在花名册内（fail-closed：不在册一律拒登）。
服务器：阿里云 47.110.93.137 `/opt/brainx`，systemd `brainx.service` 常驻
（unit 见 `bin/brainx.service`；桥接已开，3 分钟一轮拉飞书 Bitable + 三个群）。
以下本地玩法仅在需要离线演示/二开时用。

## 0.1 按人数据隔离（2026-08-10 起）

每个人的消息数据用**他自己的飞书授权**拉取：登录时令牌加密入库（AES-256-GCM，
密钥 = `data/.secret`），桥接以各人身份读他实际所在的群。看不到的群 = 一条消息都没有。
**老用户需重新登录一次**激活按人同步（工作台顶部会出现「启用飞书实时同步」胶囊，点它即可）。

⚠️ 打包/分发纪律：`data/brainx.db` 现含加密令牌——**任何归档必须排除 `data/.secret`**
（没了密钥令牌就是乱码；密钥和库一起给出去等同明文外发所有人的飞书令牌）。

## 1. 解包启动（30 秒）

```bash
tar -xzf brainx-*.tar.gz && cd brainx
node src/server.js          # 默认 http://127.0.0.1:3000
# 或常驻（登录自启 + 崩溃拉起 + 桥接定时跑）：
sh bin/install-launchd.sh   # → http://127.0.0.1:3100
```

浏览器打开 → 飞书授权登录（mia/felix/york 在册）。

## 2. 唯一需要补的一件东西：.env

压缩包**不含** `.env`（里面有飞书 App Secret，按纪律不进归档）。没有它 OAuth 登录不可用。
从 1Password 或原机器复制，格式见 `.env.example`，两项即可：

```
BRAINX_FEISHU_APP_SECRET=<飞书应用 secret>
BRAINX_BASE_URL=http://127.0.0.1:3100
```

## 3. 外部依赖：lark-cli（桥接/推送用）

```bash
lark-cli --version   # 没有则先装并登录（Device Flow 授权）
```

没有 lark-cli 也能跑：工作台/推荐/回放全部可用，只是桥接器拉不到飞书新数据
（日志报 sync_error，页面正常）。设 `BRAINX_BRIDGE_OFF=1` 可彻底关掉桥接。

## 4. 数据

- `data/brainx.db` 已随包带上（职位/推荐/群消息/花名册）。删掉它会自动重建：
  migrations 自动跑 + 花名册从 fixtures/roster.json 播种 + 桥接器下一轮把飞书数据拉回来。
- 想验证：`npm test`（35 例，全绿约 3 秒）。

## 5. 常用开关（环境变量）

| 变量 | 默认 | 作用 |
|---|---|---|
| `BRAINX_PORT` | 3000（plist 里 3100） | 端口 |
| `BRAINX_BRIDGE_INTERVAL_MS` | 180000 | 桥接轮询间隔 |
| `BRAINX_BRIDGE_OFF` | — | =1 关桥接 |
| `BRAINX_PUSH_AUTO` | 关 | =1 重大变化自动推卡（仅推本人，绝不推群） |
| `BRAINX_DEV_AUTH` | 关 | =1 开离线演示登录（绕过 OAuth） |

细节与验证报告：`docs/VERIFICATION.md`。
