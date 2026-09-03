#!/usr/bin/env bash
# 把本工作台前端部署到 Cloudflare Pages。
#
# 凭证二选一：
#   A. 已 wrangler login（推荐，浏览器授权一次即可）—— 无需 .env.local
#   B. API 令牌：cp .env.local.example .env.local 填入 CLOUDFLARE_API_TOKEN / ACCOUNT_ID
#
# 后端地址：若已公网可达（cloudflared tunnel / 服务器），在 .env.local 设
# VITE_API_BASE=https://... 并在 backend/.env 设 APP_ACCESS_TOKEN=强令牌；
# 后端保持本机时 VITE_API_BASE 留空（线上为静态壳，对话/微信功能需后端在线）。
#
# 上线：bash deploy-pages.sh   （老地址自动变新；带哈希快照地址可用于回滚）
set -euo pipefail
cd "$(dirname "$0")"

# 凭证文件存在则读入（不存在则依赖 wrangler login 的 OAuth）
if [ -f .env.local ]; then
  set -a; source .env.local; set +a
fi

PROJECT="${PAGES_PROJECT_NAME:-ice-workbench}"

cd frontend
VITE_API_BASE="${VITE_API_BASE:-}" npm run build

# 项目不存在则先创建（新版 wrangler 不再隐式建项目）
if ! npx wrangler pages project list 2>/dev/null | grep -q "$PROJECT"; then
  echo "→ 创建 Pages 项目 $PROJECT"
  npx wrangler pages project create "$PROJECT" --production-branch=main
fi

npx wrangler pages deploy dist --project-name="$PROJECT" --branch=main --commit-dirty=true
