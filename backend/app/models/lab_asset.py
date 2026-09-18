"""模型实验室生成资产 —— 图片/视频结果持久化。

生成结果原先只存前端内存，切页/刷新即丢（视频轮询也随之停止）。
落库后前端从后端加载展示，刷新不丢、切页回来 pending 任务恢复轮询。
"""
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime

from app.core.database import Base


class LabAsset(Base):
    __tablename__ = "lab_assets"

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String(10), index=True)      # image / video
    model = Column(String(50))                 # agnes-image-2.5-flash ...
    prompt = Column(Text)                      # 生成提示词
    params = Column(Text)                      # JSON：size/ratio/aspect/seconds/mode 等
    url = Column(Text, nullable=True)          # 结果地址（图片直链 / 视频 mp4）
    b64 = Column(Text, nullable=True)          # 图片 base64（上游返回 b64 时）
    # 视频任务字段
    video_id = Column(String(100), index=True, nullable=True)
    status = Column(String(20), default="pending")  # pending/in_progress/completed/failed
    progress = Column(Integer, default=0)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
