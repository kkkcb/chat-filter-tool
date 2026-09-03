#!/usr/bin/env bash
# 按《Cloudflare Pages 部署链路》笔记的流程，把本工作台前端部署到 Cloudflare Pages。
#
# 前置（一次性）：
#   1. cp .env.local.example .env.local
#   2. 填入 CLOUDFLARE_API_TOKEN（dash.cloudflare.com/profile/api-tokens 创建，
#      权限 Account → Cloudflare Pages → 编辑）与 CLOUDFLARE_ACCOUNT_ID
#   3. 若后端已公网可达（cloudflared tunnel / 服务器），填 VITE_API_BASE=https://...
#      并在 backend/.env 设置 APP_ACCESS_TOKEN=同一个强令牌（保护 GLM key 与数据）
#      后端保持本机时 VITE_API_BASE 留空（部署出的站点仅静态壳，微信/对话功能不可用）
#
# 上线：bash deploy-pages.sh   （老地址自动变新；带哈希快照地址可用于回滚）
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env.local ]; then
  echo "缺少 .env.local —— 先 cp .env.local.example .env.local 并填入凭证" >&2
  exit 1
fi

set -a; source .env.local; set +a

cd frontend
VITE_API_BASE="${VITE_API_BASE:-}" npm run build
npx wrangler pages deploy dist \
  --project-name="${PAGES_PROJECT_NAME:-ice-workbench}" \
  --branch=main --commit-dirty=true
