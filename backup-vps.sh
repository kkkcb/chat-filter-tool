#!/usr/bin/env bash
# 备份 VPS 上的 ICE 数据库与素材 → 本机 backups/ 归档（带时间戳）。
# 用法：bash backup-vps.sh        （VPS_PW=xxx 环境变量传密码）
# 何时跑：服务器到期前 / 换服务器前 / 想留档时（建议每月一次）
set -euo pipefail
cd "$(dirname "$0")"

VPS_IP="${VPS_IP:-YOUR_VPS_IP}"
VPS_USER="${VPS_USER:-root}"
STAMP=$(date +%Y%m%d-%H%M%S)
DEST="backups/vps-${STAMP}"
mkdir -p "${DEST}"

echo "→ 拉取 VPS 数据到 ${DEST}/"
VPS_IP="$VPS_IP" VPS_USER="$VPS_USER" DEST="$DEST" python - <<'PYEOF'
import os, paramiko

ip, user, dest = os.environ["VPS_IP"], os.environ["VPS_USER"], os.environ["DEST"]
pw = os.environ.get("VPS_PW") or input("VPS 密码: ")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(ip, username=user, password=pw, timeout=15)
sftp = ssh.open_sftp()

# 数据库 + 素材目录（先在服务器上打包成单文件再拉，避免逐文件慢）
_, out, _ = ssh.exec_command(
    "cd /opt/ice-workbench && tar czf /tmp/ice-backup.tar.gz data inbox 2>/dev/null; "
    "ls -la /tmp/ice-backup.tar.gz", timeout=120)
print(out.read().decode().strip())
sftp.get("/tmp/ice-backup.tar.gz", f"{dest}/ice-backup.tar.gz")
sftp.close()
_, out, _ = ssh.exec_command("rm -f /tmp/ice-backup.tar.gz", timeout=15)
out.channel.recv_exit_status()
ssh.close()
PYEOF

echo "→ 解包归档"
tar xzf "${DEST}/ice-backup.tar.gz" -C "${DEST}"
rm -f "${DEST}/ice-backup.tar.gz"

echo "→ 完成：${DEST}/"
ls -la "${DEST}/data/" | head -5
echo ""
echo "  数据库: ${DEST}/data/workbench.db（含线上全部对话/笔记/素材）"
echo "  恢复方法（新服务器部署好后）：把此 db 覆盖到 /opt/ice-workbench/data/ 并重启服务"
