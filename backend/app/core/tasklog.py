"""模型实验室任务日志 —— 结构化 JSON 行 + 轮转文件。

选型（调研结论）：单服务个人应用用 stdlib 结构化日志即可，
OpenTelemetry 需要 Collector/导出基建，此处不上；将来要迁移 OTel
时 JSON 字段直接映射 span 属性，无需重写调用点。

日志位置：data/lab-tasks.log（5MB × 3 轮转），同时输出 stdout
（VPS 上 journalctl 可查）。每行一个 JSON 对象，grep/jq 友好。
"""
import json
import logging
import logging.handlers
from pathlib import Path
from datetime import datetime, timezone

from app.config import settings

_logger = None


def _get_logger() -> logging.Logger:
    global _logger
    if _logger is not None:
        return _logger
    log_dir = Path(settings.database_path).parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("lab")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    fmt = logging.Formatter("%(message)s")

    file_handler = logging.handlers.RotatingFileHandler(
        log_dir / "lab-tasks.log", maxBytes=5 * 1024 * 1024,
        backupCount=3, encoding="utf-8")
    file_handler.setFormatter(fmt)
    logger.addHandler(file_handler)

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(fmt)
    logger.addHandler(stream_handler)

    _logger = logger
    return logger


def log_task(event: str, **fields) -> None:
    """记录一条任务事件。event 用点分命名：video.create / video.status_change ..."""
    record = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "event": event,
        **{k: v for k, v in fields.items() if v is not None},
    }
    _get_logger().info(json.dumps(record, ensure_ascii=False, default=str))
