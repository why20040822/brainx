# syntax=docker/dockerfile:1
# BrainX 一体化镜像：单容器同时跑「node:http 后端(:3000)」+「vinext 前端(:4321)」。
# 后端通过 spawn 拉起前端子进程并反向代理，故只需暴露 3000 这一个入口端口。
#
# 分两阶段：builder 装全量依赖并构建前端产物；runner 只带运行期所需文件，镜像更小。

# ---------- 1) builder：装依赖 + 构建前端 ----------
FROM node:22.13-bookworm-slim AS builder
WORKDIR /app

# 先只拷贝依赖清单，最大化利用 Docker layer 缓存（依赖没变就不重装）。
COPY package.json package-lock.json* ./
COPY frontend/btex-frontend/package.json frontend/btex-frontend/package-lock.json* ./frontend/btex-frontend/

# 后端依赖（mysql2 等）
RUN npm install --no-audit --no-fund
# 前端依赖（vinext / next / react …）
RUN npm --prefix frontend/btex-frontend install --no-audit --no-fund

# 拷贝全部源码后构建前端静态/worker 产物。
COPY . .
RUN npm run build

# ---------- 2) runner：精简运行期 ----------
FROM node:22.13-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# 只带运行期需要的东西：源码、已装依赖、已构建前端产物。
COPY --from=builder /app ./

# 单一对外端口（后端入口；前端由后端 spawn 并代理，不单独对外）。
ENV BRAINX_PORT=3000
ENV BRAINX_HOST=0.0.0.0
ENV BRAINX_FRONTEND_PORT=4321
EXPOSE 3000

# 非 root 运行（node 基础镜像自带 node 用户），降低容器逃逸面。
USER node

# 入口：启动后端，后端会自行拉起并代理前端。
CMD ["node", "src/server.js"]
