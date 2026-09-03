#!/usr/bin/env bash
# 完整上线：起隧道(后端) + 重新构建部署前端(Pages)。
#
# 何时需要重跑：
#   - 电脑重启 / 隧道进程挂了 → trycloudflare 域名变了 → 本脚本一键恢复
#   - 前端代码更新后想发布 → 重跑即可（隧道若还活着会复用，见下）
#
# 产出：
#   - 线上地址：https://ice-workbench.pages.dev（固定）
#   - 后端隧道：https://<随机>.trycloudflare.com（进程存活期间稳定）
#   - 访问令牌：workspace/.access-token.txt（首次打开线上页面时输入一次）
#
# 前提：后端(8000)在跑；wrangler 已登录（之前 OAuth 授权过）
set -euo pipefail
cd "$(dirname "$0")"

echo "→ [1/4] 确认后端在线"
curl -sf http://127.0.0.1:8000/api/health > /dev/null || {
  echo "  后端未启动，先拉起..."
  (cd backend && nohup python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 > backend.log 2>&1 &)
  sleep 6
  curl -sf http://127.0.0.1:8000/api/health > /dev/null || { echo "后端启动失败，查 backend/backend.log"; exit 1; }
}

echo "→ [2/4] 确保隧道在跑（活着则复用原域名）"
if ! grep -qo "https://[a-z0-9-]*\.trycloudflare\.com" tools/tunnel.log 2>/dev/null \
   || ! tasklist 2>/dev/null | grep -q cloudflared; then
  rm -f tools/tunnel.log
  (cd tools && nohup ./cloudflared.exe tunnel --url http://127.0.0.1:8000 > tunnel.log 2>&1 &)
  sleep 12
fi
TUNNEL=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" tools/tunnel.log | head -1)
[ -n "$TUNNEL" ] || { echo "未拿到隧道域名，查 tools/tunnel.log"; exit 1; }
echo "  后端隧道: $TUNNEL"

echo "→ [3/4] 构建前端（注入隧道地址）并部署 Pages"
(cd frontend && VITE_API_BASE="$TUNNEL" npm run build \
  && npx wrangler pages deploy dist --project-name=ice-workbench --branch=main --commit-dirty=true)

echo "→ [4/4] 完成"
echo ""
echo "  线上地址: https://ice-workbench.pages.dev"
echo "  访问令牌: $(cat .access-token.txt 2>/dev/null | head -1)"
echo "  注意: 电脑关机后线上不可用，开机后重跑 bash deploy-online.sh（约 1 分钟）"
