"""对话历史 ORM 模型"""
from datetime import datetime
from sqlalchemy import Column, Integer, Text, ForeignKey, Index

from app.core.database import Base


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(Text, default="新对话")
    position = Column(Integer, default=0)
    created_at = Column(Text, nullable=False, default=lambda: datetime.now().isoformat())
    updated_at = Column(Text, default=lambda: datetime.now().isoformat())
    # 上下文压缩（借鉴 deepseek-harness compaction 策略）：
    # LLM 生成的结构化检查点 + 已覆盖到的消息边界
    compacted_summary = Column(Text, nullable=True)
    compacted_upto = Column(Integer, nullable=True)


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    role = Column(Text, nullable=False)                    # user / assistant
    content = Column(Text, nullable=False, default="")
    reasoning = Column(Text, default="")                    # 思考过程
    message_type = Column(Text, default="chat")            # chat / vision / link
    meta_json = Column(Text, default="{}")                  # JSON: image url, link card, etc.
    raw_request = Column(Text, default="")                  # 原始请求 JSON
    raw_response = Column(Text, default="")                 # 原始返回 JSON
    created_at = Column(Text, nullable=False, default=lambda: datetime.now().isoformat())

    __table_args__ = (
        Index("idx_messages_conv", "conversation_id"),
    )
