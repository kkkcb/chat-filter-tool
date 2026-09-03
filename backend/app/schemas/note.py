"""个人知识库笔记 Schema"""
from typing import Optional, List
from pydantic import BaseModel


class NoteCreate(BaseModel):
    title: str
    content: str = ""
    tags: List[str] = []


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    tags: Optional[List[str]] = None


class SummarizeRequest(BaseModel):
    conversation_id: int
    instruction: str = ""   # 可选：用户指定本次总结的侧重点
