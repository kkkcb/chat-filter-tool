"""灵感记录 ORM 模型"""
from datetime import datetime
from sqlalchemy import Column, Integer, Text

from app.core.database import Base


class Inspiration(Base):
    __tablename__ = "inspirations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    action = Column(Text, nullable=False)              # topics / titles / angle
    topic = Column(Text)
    result = Column(Text, nullable=False)              # JSON result
    created_at = Column(Text, nullable=False, default=lambda: datetime.now().isoformat())
