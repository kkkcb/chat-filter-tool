#!/usr/bin/env bash
# 更新 VPS 上的 ICE 工作台：打包本机代码（可选带数据）→ 上传解包 → 重启服务。
# 用法：bash deploy-vps.sh            # 只同步代码
#       bash deploy-vps.sh --data     # 代码 + 数据库/素材一起同步（本机会覆盖线上）
# 密码：环境变量 VPS_PW=xxx 传入，否则交互输入
set -euo pipefail
cd "$(dirname "$0")"

VPS_IP="${VPS_IP:-YOUR_VPS_IP}"
VPS_USER="${VPS_USER:-root}"

echo "→ 打包本机代码"
tar czf /tmp/ice-code.tar.gz --exclude='__pycache__' --exclude='backend.log' --exclude='venv' \
  --exclude='migrations' backend/app backend/requirements.txt
WITH_DATA="${1:-}"

echo "→ 上传到 $VPS_IP 并部署"
VPS_IP="$VPS_IP" VPS_USER="$VPS_USER" WITH_DATA="$WITH_DATA" python - <<'PYEOF'
import os, subprocess, tarfile, paramiko

ip, user = os.environ["VPS_IP"], os.environ["VPS_USER"]
with_data = os.environ.get("WITH_DATA") == "--data"
pw = os.environ.get("VPS_PW") or input("VPS 密码: ")

if with_data:
    with tarfile.open("/tmp/ice-data.tar.gz", "w:gz") as t:
        t.add("data"); t.add("../inbox", arcname="inbox") if os.path.isdir("../inbox") else None

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(ip, username=user, password=pw, timeout=15)
sftp = ssh.open_sftp()
sftp.put("/tmp/ice-code.tar.gz", "/tmp/ice-code.tar.gz")
if with_data:
    sftp.put("/tmp/ice-data.tar.gz", "/tmp/ice-data.tar.gz")
sftp.close()

cmds = ["cd /opt/ice-workbench && tar xzf /tmp/ice-code.tar.gz"]
if with_data:
    cmds.append("cd /opt/ice-workbench && tar xzf /tmp/ice-data.tar.gz")
cmds += ["systemctl restart ice-workbench", "sleep 3",
         "systemctl is-active ice-workbench && curl -s http://127.0.0.1/api/health"]
for c in cmds:
    _, out, err = ssh.exec_command(c, timeout=90)
    o, e = out.read().decode().strip(), err.read().decode().strip()
    if o: print(o)
    if e and "tar:" not in e: print("ERR:", e[:200])
ssh.close()
print("部署完成")
PYEOF

echo "→ 线上地址: http://$VPS_IP"
