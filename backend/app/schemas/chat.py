"""对话 Schema"""
from typing import Optional
from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str = ""
    image: Optional[str] = ""
    mode: Optional[str] = "describe"
    thinking: Optional[bool] = False
    conversation_id: Optional[int] = None


class ChatResponse(BaseModel):
    type: str  # chat / vision / link
    reply: str
    success: bool = True
    action: Optional[str] = None  # confirm_save / already_saved
    entry: Optional[dict] = None


class SaveConfirmRequest(BaseModel):
    entry: dict


class SaveConfirmResponse(BaseModel):
    success: bool = True
    entry: Optional[dict] = None
    message: str = ""
