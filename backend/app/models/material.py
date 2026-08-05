"""素材 ORM 模型"""
from datetime import datetime
from sqlalchemy import Column, Integer, Text, Index

from app.core.database import Base


class Material(Base):
    __tablename__ = "materials"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(Text, nullable=False)
    url = Column(Text, unique=True)
    source_type = Column(Text, nullable=False, default="web")       # github / wechat / web
    category = Column(Text, nullable=False, default="待分类")
    summary = Column(Text, default="")
    tags = Column(Text, default="[]")                                 # JSON array string
    extra_text = Column(Text, default="")
    md_path = Column(Text, nullable=False)                            # Markdown file relative path
    content_hash = Column(Text)                                       # dedup
    created_at = Column(Text, nullable=False, default=lambda: datetime.now().isoformat())
    updated_at = Column(Text)

    __table_args__ = (
        Index("idx_materials_category", "category"),
        Index("idx_materials_source", "source_type"),
    )
