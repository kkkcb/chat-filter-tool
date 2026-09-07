#!/usr/bin/env bash
# 更新 VPS 上的 ICE 工作台：打包本机代码（后端 + 前端 dist）→ 上传解包 → 重启服务。
# 用法：bash deploy-vps.sh            # 只同步代码
#       bash deploy-vps.sh --data     # 代码 + 数据库/素材一起同步（本机会覆盖线上）
# 密码：环境变量 VPS_PW=xxx 传入，否则交互输入
set -euo pipefail
cd "$(dirname "$0")"

VPS_IP="${VPS_IP:-YOUR_VPS_IP}"
VPS_USER="${VPS_USER:-root}"

echo "→ 部署前先备份线上数据（防数据同步/误操作事故）"
python backup_vps.py || echo "（备份失败不阻塞部署，查看 backups/backup.log）"

echo "→ 打包本机代码（后端 + 前端 dist）"
cd frontend && npm run build --silent >/dev/null 2>&1 || npm run build >/dev/null 2>&1
cd ..
# 版本戳：部署后回读比对，防止"解包静默失败仍显示部署成功"
GIT_SHA=$(git rev-parse --short HEAD)
echo "$GIT_SHA $(date +%F\ %T)" > backend/DEPLOY_VERSION
tar czf ./.deploy-ice-code.tar.gz --exclude='__pycache__' --exclude='backend.log' --exclude='venv' \
  --exclude='migrations' backend/app backend/requirements.txt backend/DEPLOY_VERSION
tar czf ./.deploy-ice-dist.tar.gz -C frontend dist
WITH_DATA="${1:-}"

echo "→ 上传到 $VPS_IP 并部署（版本 $GIT_SHA）"
VPS_IP="$VPS_IP" VPS_USER="$VPS_USER" WITH_DATA="$WITH_DATA" LOCAL_SHA="$GIT_SHA" python - <<'PYEOF'
import os, tarfile, paramiko, sys

ip, user = os.environ["VPS_IP"], os.environ["VPS_USER"]
with_data = os.environ.get("WITH_DATA") == "--data"
local_sha = os.environ["LOCAL_SHA"]
pw = os.environ.get("VPS_PW") or input("VPS 密码: ")

if with_data:
    with tarfile.open("./.deploy-ice-data.tar.gz", "w:gz") as t:
        t.add("data"); t.add("../inbox", arcname="inbox") if os.path.isdir("../inbox") else None

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(ip, username=user, password=pw, timeout=15)
sftp = ssh.open_sftp()
# 上传/解包一律绝对路径：sftp 的相对路径落在登录家目录，曾导致解包静默失败
for name in ["ice-code", "ice-dist"]:
    sftp.put(f"./.deploy-{name}.tar.gz", f"/tmp/deploy-{name}.tar.gz")
if with_data:
    sftp.put("./.deploy-ice-data.tar.gz", "/tmp/deploy-ice-data.tar.gz")
sftp.close()

cmds = [
    "tar xzf /tmp/deploy-ice-code.tar.gz -C /opt/ice-workbench",
    "rm -rf /opt/ice-workbench/frontend/dist && tar xzf /tmp/deploy-ice-dist.tar.gz -C /tmp/deploy-dist-tmp 2>/dev/null || (mkdir -p /tmp/deploy-dist-tmp && tar xzf /tmp/deploy-ice-dist.tar.gz -C /tmp/deploy-dist-tmp)",
    "rm -rf /opt/ice-workbench/frontend/dist && mkdir -p /opt/ice-workbench/frontend && cp -r /tmp/deploy-dist-tmp/dist /opt/ice-workbench/frontend/dist",
]
if with_data:
    cmds.append("tar xzf /tmp/deploy-ice-data.tar.gz -C /opt/ice-workbench")
cmds += ["systemctl restart ice-workbench", "sleep 3",
         "systemctl is-active ice-workbench && curl -s http://127.0.0.1/api/health"]
failed = False
for c in cmds:
    _, out, err = ssh.exec_command(c, timeout=120)
    rc = out.channel.recv_exit_status()
    o, e = out.read().decode().strip(), err.read().decode().strip()
    if o: print(o)
    if rc != 0:
        print(f"[命令失败 rc={rc}] {c}\n{e[:300]}")
        failed = True
        break
if not failed:
    # 版本自检：解包后的 DEPLOY_VERSION 必须与本地 SHA 一致
    _, out, _ = ssh.exec_command("cat /opt/ice-workbench/backend/DEPLOY_VERSION", timeout=15)
    remote = out.read().decode().strip()
    if not remote.startswith(local_sha):
        print(f"[版本不一致] 本地 {local_sha} vs 线上 {remote!r} — 解包可能失败！")
        failed = True
    else:
        print(f"版本自检通过: {remote}")
_, out, _ = ssh.exec_command("rm -rf /tmp/deploy-ice-* /tmp/deploy-dist-tmp", timeout=15)
out.channel.recv_exit_status()
ssh.close()
sys.exit(1 if failed else 0)
PYEOF

echo "→ 线上地址: http://$VPS_IP"
