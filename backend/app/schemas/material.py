"""素材 Schema"""
from pydantic import BaseModel


class MaterialOut(BaseModel):
    id: int
    title: str
    url: str | None = None
    source: str = "web"
    category: str = "待分类"
    summary: str = ""
    tags: list[str] = []
    extra_text: str = ""
    date: str | None = None
    md_path: str = ""
    content: str | None = None  # 仅详情接口返回


class MaterialUpdate(BaseModel):
    category: str | None = None
    tags: list[str] | None = None
    summary: str | None = None   # 大纲/概要可编辑（用户读后补想法）


class StatsResponse(BaseModel):
    total: int
    categories: dict[str, int]
    recent: list[dict] = []
