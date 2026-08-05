"""创作灵感服务 — 选题/标题/角度"""
from sqlalchemy.orm import Session

from app.services.llm_service import llm_service
from app.services.material_service import MaterialService


class InspireService:
    """创作灵感生成"""

    def __init__(self, db: Session):
        self.db = db
        self.material_svc = MaterialService(db)

    async def generate_topics(self) -> list:
        """基于知识库生成选题"""
        kb_context = self.material_svc.get_kb_context() or "（暂无素材）"
        return await llm_service.generate_topics(kb_context)

    async def generate_titles(self, topic: str) -> list:
        """为话题生成标题"""
        if not topic:
            return []
        return await llm_service.generate_titles(topic)

    async def generate_angles(self, topic: str) -> list:
        """挖掘科普角度"""
        if not topic:
            return []
        kb_context = self.material_svc.get_kb_context(limit=10)
        return await llm_service.generate_angles(topic, kb_context)
