#!/bin/sh
# install-launchd.sh — 安装 Brain X 常驻服务（launchd，当前用户，登录自启 + 崩溃拉起）。
# 幂等：重复执行先 bootout 再 bootstrap。卸载：launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.brainx.web.plist
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
LABEL="com.brainx.web"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT=3100

# 端口冲突检查：手动起的 server 还占着端口时，KeepAlive 会陷入崩溃循环
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 $PORT 已被占用（多半是手动起的 server.js）。先停掉再装：" >&2
  lsof -nP -iTCP:$PORT -sTCP:LISTEN >&2
  exit 1
fi

mkdir -p "$ROOT/logs" "$HOME/Library/LaunchAgents"
sed -e "s|__ROOT__|$ROOT|g" -e "s|__NODE__|$NODE|g" "$ROOT/bin/$LABEL.plist" > "$DEST"
launchctl bootout "gui/$(id -u)" "$DEST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
ok=""
for _ in 1 2 3 4 5; do
  sleep 1
  curl -sf "http://127.0.0.1:$PORT/api/v1/oauth/status" >/dev/null && { ok=1; break; }
done
if [ -n "$ok" ]; then
  echo "已安装并启动：http://127.0.0.1:$PORT（日志 $ROOT/logs/launchd.*.log）"
else
  echo "服务未响应，看日志：tail $ROOT/logs/launchd.err.log" >&2
  exit 1
fi
