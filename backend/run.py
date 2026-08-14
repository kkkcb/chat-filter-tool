#!/usr/bin/env python
"""启动脚本（开发模式加 --reload 开启热重载）"""
import sys

import uvicorn
from app.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload="--reload" in sys.argv,
    )
