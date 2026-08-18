#!/usr/bin/env bash
# BrainX 一键部署编排 —— 本地/服务器通用。
# 拓扑：node:http 后端(:3000) 反向代理 vinext 前端(:4321)，单入口 3000。
#
# 用法：
#   ./scripts/deploy.sh build    # 装依赖 + 构建前端产物
#   ./scripts/deploy.sh start    # 启动一体化服务（前台）
#   ./scripts/deploy.sh docker   # 构建并运行 Docker 镜像
#   ./scripts/deploy.sh          # = build 然后 start
set -euo pipefail
cd "$(dirname "$0")/.."

: "${BRAINX_PORT:=3000}"
: "${BRAINX_HOST:=0.0.0.0}"
: "${BRAINX_FRONTEND_PORT:=4321}"
export BRAINX_PORT BRAINX_HOST BRAINX_FRONTEND_PORT

log(){ printf '\033[36m[deploy]\033[0m %s\n' "$*"; }

cmd_build(){
  log "安装后端依赖…";  npm install --no-audit --no-fund
  log "安装前端依赖…";  npm --prefix frontend/btex-frontend install --no-audit --no-fund
  log "构建前端产物 (vinext build)…"; npm run build
  log "构建完成。前端产物：frontend/btex-frontend/dist/"
}

cmd_start(){
  log "启动一体化服务：后端 :$BRAINX_PORT（代理前端 :$BRAINX_FRONTEND_PORT）"
  exec node src/server.js
}

cmd_docker(){
  log "构建镜像 brainx:latest …"
  docker build -t brainx:latest .
  log "运行容器（映射 $BRAINX_PORT，注入 .env）…"
  docker run --rm -p "${BRAINX_PORT}:3000" \
    ${ENV_FILE:+--env-file "$ENV_FILE"} \
    $([ -f .env ] && echo "--env-file .env") \
    --name brainx brainx:latest
}

case "${1:-all}" in
  build)  cmd_build ;;
  start)  cmd_start ;;
  docker) cmd_docker ;;
  all)    cmd_build; cmd_start ;;
  *) echo "未知命令：$1（可用：build | start | docker）"; exit 1 ;;
esac
