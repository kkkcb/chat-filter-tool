"""对话历史 Schema"""
from typing import Optional, List
from pydantic import BaseModel


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    reasoning: str = ""
    message_type: str = "chat"
    meta_json: str = "{}"
    created_at: str = ""
    # raw_request/raw_response 体积大，不随对话详情下发，
    # 由 GET /api/messages/{id} 按需拉取


class ConversationOut(BaseModel):
    id: int
    title: str
    position: int = 0
    created_at: str = ""
    updated_at: str = ""
    last_message: str = ""
    message_count: int = 0


class ConversationDetail(BaseModel):
    id: int
    title: str
    position: int = 0
    messages: List[MessageOut] = []


class CreateConversationRequest(BaseModel):
    title: str = "新对话"


class UpdateConversationRequest(BaseModel):
    title: Optional[str] = None
    position: Optional[int] = None


class ReorderRequest(BaseModel):
    ordered_ids: List[int]
