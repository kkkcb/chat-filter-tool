"""个人知识库笔记 ORM 模型"""
from datetime import datetime
from sqlalchemy import Column, Integer, Text, Index

from app.core.database import Base


class Note(Base):
    __tablename__ = "notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(Text, nullable=False)
    content = Column(Text, nullable=False, default="")          # Markdown 正文
    tags = Column(Text, default="[]")                            # JSON array string
    category = Column(Text, default="")                          # 大分类（如 技术原理/个人规划；空=未分类）
    source_conversation_id = Column(Integer)                     # 由哪个对话总结而来（手建为 NULL）
    created_at = Column(Text, nullable=False, default=lambda: datetime.now().isoformat())
    updated_at = Column(Text, default=lambda: datetime.now().isoformat())

    __table_args__ = (
        Index("idx_notes_conv", "source_conversation_id"),
    )
