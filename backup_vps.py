# -*- coding: utf-8 -*-
"""VPS 数据自动备份（Windows 计划任务调用，每天首次登录触发，幂等跳过）。

备份内容：服务器 /opt/ice-workbench 的 data/ + inbox/ → 本机 backups/vps-日期/
日志：backups/backup.log（成功/失败静默记录，不打扰用户）
密码：读 workspace/.vps-pass（gitignored，不进仓库）
"""
import os
import sys
import datetime
import subprocess

WORKSPACE = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR = os.path.join(WORKSPACE, "backups")
LOG_FILE = os.path.join(BACKUP_DIR, "backup.log")
PASS_FILE = os.path.join(WORKSPACE, ".vps-pass")

VPS_IP = os.environ.get("VPS_IP", "YOUR_VPS_IP")
VPS_USER = "root"


def log(msg):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}\n")


def main():
    stamp = datetime.datetime.now().strftime("%Y%m%d")
    dest = os.path.join(BACKUP_DIR, f"vps-{stamp}")
    # 幂等：今天的归档已存在（任何时刻）则跳过——计划任务每次登录都触发，
    # 一天只真正备份一次
    if os.path.exists(os.path.join(dest, "data")):
        log(f"今日已备份（{dest}），跳过")
        return

    try:
        with open(PASS_FILE, encoding="utf-8") as f:
            pw = f.read().strip()
        import paramiko
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(VPS_IP, username=VPS_USER, password=pw, timeout=20)
        _, out, _ = ssh.exec_command(
            "cd /opt/ice-workbench && tar czf /tmp/ice-backup.tar.gz data inbox 2>/dev/null", timeout=120)
        out.channel.recv_exit_status()
        sftp = ssh.open_sftp()
        os.makedirs(dest, exist_ok=True)
        sftp.get("/tmp/ice-backup.tar.gz", os.path.join(dest, "ice-backup.tar.gz"))
        sftp.close()
        ssh.exec_command("rm -f /tmp/ice-backup.tar.gz")
        ssh.close()
        # 解包（python tarfile：Windows 自带 tar.exe 对中文路径会 exit 1）
        import tarfile
        with tarfile.open(os.path.join(dest, "ice-backup.tar.gz")) as t:
            t.extractall(dest, filter="data")
        os.remove(os.path.join(dest, "ice-backup.tar.gz"))
        # 只保留最近 30 份归档
        archives = sorted(d for d in os.listdir(BACKUP_DIR) if d.startswith("vps-"))
        for old in archives[:-30]:
            subprocess.run(["rm", "-rf", os.path.join(BACKUP_DIR, old)], capture_output=True)
        log(f"备份成功 → {dest}")
    except Exception as e:
        log(f"备份失败: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
