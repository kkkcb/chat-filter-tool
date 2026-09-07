"""素材服务 — CRUD + 统计，编排 storage + repository"""
import json
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.material import Material
from app.core import fts
from app.core.storage import save_markdown, read_markdown
from app.services.llm_service import llm_service
from app.services.clip_service import clip_service
from app.config import settings


class MaterialService:
    """素材管理：编排抓取、AI 分类、文件存储、数据库写入"""

    def __init__(self, db: Session):
        self.db = db

    def list(self, category: str | None = None, page: int = 1, size: int = 50) -> list[dict]:
        """素材列表（支持分类筛选+分页）"""
        query = self.db.query(Material)
        if category:
            query = query.filter(Material.category == category)
        query = query.order_by(Material.created_at.desc())
        offset = (page - 1) * size
        items = query.offset(offset).limit(size).all()
        return [self._to_dict(m) for m in items]

    def get(self, material_id: int) -> dict | None:
        """素材详情（含正文）"""
        m = self.db.query(Material).filter(Material.id == material_id).first()
        if not m:
            return None
        result = self._to_dict(m)
        result["content"] = read_markdown(m.md_path)
        return result

    def stats(self) -> dict:
        """统计数据（SQL 聚合，不加载全表）"""
        total = self.db.query(func.count(Material.id)).scalar() or 0
        cat_rows = (
            self.db.query(Material.category, func.count(Material.id))
            .group_by(Material.category)
            .all()
        )
        recent = (
            self.db.query(Material)
            .order_by(Material.created_at.desc())
            .limit(5)
            .all()
        )
        return {
            "total": total,
            "categories": {cat: cnt for cat, cnt in cat_rows},
            "recent": [self._to_dict(m) for m in recent],
        }

    def get_kb_context(self, limit: int = 20) -> str:
        """构建知识库上下文摘要（供 AI 对话用）"""
        materials = self.db.query(Material).order_by(
            Material.created_at.desc()
        ).limit(limit).all()
        if not materials:
            return ""
        return "\n".join(
            f"- [{m.category}] {m.title}: {m.summary}"
            for m in materials
        )

    def search_relevant(self, question: str, limit: int = 5) -> list:
        """检索最相关的素材（优先 FTS5 全文索引，不可用时回退关键词扫描）"""
        ids = fts.search(self.db, question, limit=limit)
        if ids is not None:
            if not ids:
                return []
            materials = self.db.query(Material).filter(Material.id.in_(ids)).all()
            by_id = {m.id: m for m in materials}
            return [self._to_dict(by_id[i]) for i in ids if i in by_id]
        return self._search_relevant_scan(question, limit)

    def _search_relevant_scan(self, question: str, limit: int = 5) -> list:
        """关键词暴力扫描（FTS 不可用时的回退方案）"""
        materials = self.db.query(Material).order_by(
            Material.created_at.desc()
        ).all()
        if not materials:
            return []

        # 中文分词：提取 2-4 字的子串作为关键词
        import re
        # 去除停用词和标点
        clean_q = re.sub(r"[，。、？！（）()[]【】《》""''的了吗呢吧在是有和与什么怎么如何如何可适合做主题关于]", "", question)

        # 提取 2-3 字关键词组合
        keywords = set()
        for length in [4, 3, 2]:
            for i in range(len(clean_q) - length + 1):
                word = clean_q[i:i+length]
                if len(word) >= 2:
                    keywords.add(word)

        # 也加入原始问题中的英文单词
        for word in question.lower().split():
            clean_word = word.strip("，。、？！（）()[]【】")
            if len(clean_word) >= 2:
                keywords.add(clean_word)

        results = []
        for m in materials:
            score = 0
            text = f"{m.title} {m.summary} {m.tags or ''} {m.category} {m.extra_text or ''}".lower()

            for kw in keywords:
                if kw.lower() in text:
                    score += 2
                    if kw.lower() in (m.title or "").lower():
                        score += 3
                    if kw.lower() in (m.tags or "").lower():
                        score += 3
                    if kw.lower() in (m.summary or "").lower():
                        score += 1

            if score > 0:
                results.append((score, m))

        results.sort(key=lambda x: x[0], reverse=True)
        return [self._to_dict(m) for _, m in results[:limit]]

    def build_rag_context(self, question: str) -> tuple[str, list]:
        """构建 RAG 上下文 + 引用列表 — 关键词覆盖度过滤，不够相关的直接丢弃"""
        from app.core.relevance import is_relevant
        relevant = [
            m for m in self.search_relevant(question, limit=5)
            if is_relevant(question, " ".join(filter(None, [
                m["title"], m.get("summary") or "", " ".join(m.get("tags", [])),
            ])))
        ]

        if not relevant:
            return "", []

        context_parts = []
        citations = []
        for i, m in enumerate(relevant, 1):
            context_parts.append(
                f"[{i}] {m['title']}\n"
                f"    分类: {m['category']}\n"
                f"    摘要: {m['summary']}\n"
                f"    标签: {', '.join(m.get('tags', []))}\n"
                f"    链接: {m.get('url', '无')}"
            )
            citations.append(m)

        return "\n\n".join(context_parts), citations

    async def create_from_url(self, url: str) -> dict:
        """从 URL 抓取 → AI分类 → 存档，返回结果"""
        # 1. 抓取
        page_data = await clip_service.fetch(url)
        if not page_data:
            return {"success": False, "error": "抓取失败"}
        if page_data.get("dead_link"):
            # 死链/被删文章：给出明确原因，不浪费一次 AI 分类调用
            return {"success": False, "error": f"链接无法访问（{page_data.get('summary', '已失效')}），请确认文章未被删除或链接复制完整"}

        # 2. AI 分类
        ai_result = await llm_service.classify(
            page_data["title"],
            page_data.get("content", ""),
            page_data.get("summary", ""),
        )

        category = "待分类"
        tags = []
        if ai_result:
            category = ai_result.get("category", "待分类")
            if category not in settings.categories:
                category = "待分类"
            tags = ai_result.get("tags", [])
            if ai_result.get("summary"):
                page_data["summary"] = ai_result["summary"]

        # 3. 检查重复
        existing = self.db.query(Material).filter(Material.url == url).first()
        if existing:
            return {"success": False, "error": "已存在", "entry": self._to_dict(existing)}

        # 4. 保存 Markdown
        entry = {
            **page_data,
            "url": url,
            "source_type": clip_service.detect_source(url),
            "category": category,
            "tags": tags,
        }
        md_path, content_hash = save_markdown(entry)

        # 5. 写入数据库
        material = Material(
            title=page_data["title"],
            url=url,
            source_type=entry["source_type"],
            category=category,
            summary=page_data.get("summary", ""),
            tags=json.dumps(tags, ensure_ascii=False),
            extra_text=page_data.get("extra_text", ""),
            md_path=md_path,
            content_hash=content_hash,
            created_at=datetime.now().isoformat(),
        )
        self.db.add(material)
        self.db.commit()
        self.db.refresh(material)
        fts.upsert(self.db, material)

        return {"success": True, "entry": self._to_dict(material)}

    def check_exists(self, url: str) -> dict | None:
        """检查 URL 是否已存在"""
        existing = self.db.query(Material).filter(Material.url == url).first()
        return self._to_dict(existing) if existing else None

    async def preview_url(self, url: str) -> dict:
        """抓取 + AI 分类，但不存库（用于对话确认流程）"""
        # 1. 检查重复
        existing = self.check_exists(url)
        if existing:
            return {"success": False, "error": "已存在", "entry": existing}

        # 2. 抓取
        page_data = await clip_service.fetch(url)
        if not page_data:
            return {"success": False, "error": "抓取失败"}
        if page_data.get("dead_link"):
            # 死链/被删文章：给出明确原因，不浪费一次 AI 分类调用
            return {"success": False, "error": f"链接无法访问（{page_data.get('summary', '已失效')}），请确认文章未被删除或链接复制完整"}

        # 3. AI 分类
        ai_result = await llm_service.classify(
            page_data["title"],
            page_data.get("content", ""),
            page_data.get("summary", ""),
        )

        category = "待分类"
        tags = []
        if ai_result:
            category = ai_result.get("category", "待分类")
            if category not in settings.categories:
                category = "待分类"
            tags = ai_result.get("tags", [])
            if ai_result.get("summary"):
                page_data["summary"] = ai_result["summary"]
            if ai_result.get("title_cn"):
                page_data["original_title"] = page_data["title"]
                page_data["title"] = ai_result["title_cn"]
            if ai_result.get("bilingual"):
                page_data["extra_text"] = ai_result["bilingual"]
            # 用中文翻译替换原始英文正文
            if ai_result.get("content_cn"):
                page_data["content"] = ai_result["content_cn"]

        entry = {
            **page_data,
            "url": url,
            "source_type": clip_service.detect_source(url),
            "category": category,
            "tags": tags,
        }
        return {"success": True, "entry": entry}

    def save_entry(self, entry: dict) -> dict:
        """将 preview 返回的 entry 存入数据库"""
        existing = self.check_exists(entry["url"])
        if existing:
            return {"success": False, "error": "已存在", "entry": existing}

        md_path, content_hash = save_markdown(entry)

        material = Material(
            title=entry["title"],
            url=entry["url"],
            source_type=entry.get("source_type", "web"),
            category=entry.get("category", "待分类"),
            summary=entry.get("summary", ""),
            tags=json.dumps(entry.get("tags", []), ensure_ascii=False),
            extra_text=entry.get("extra_text", ""),
            md_path=md_path,
            content_hash=content_hash,
            created_at=datetime.now().isoformat(),
        )
        self.db.add(material)
        self.db.commit()
        self.db.refresh(material)
        fts.upsert(self.db, material)

        return {"success": True, "entry": self._to_dict(material)}

    def update(self, material_id: int, category: str = None, tags: list = None) -> dict | None:
        """更新素材分类/标签"""
        m = self.db.query(Material).filter(Material.id == material_id).first()
        if not m:
            return None
        if category:
            m.category = category
        if tags is not None:
            m.tags = json.dumps(tags, ensure_ascii=False)
        m.updated_at = datetime.now().isoformat()
        self.db.commit()
        self.db.refresh(m)
        fts.upsert(self.db, m)
        return self._to_dict(m)

    @staticmethod
    def _to_dict(m: Material) -> dict:
        return {
            "id": m.id,
            "title": m.title,
            "url": m.url,
            "source": m.source_type,
            "category": m.category,
            "summary": m.summary,
            "tags": json.loads(m.tags) if m.tags else [],
            "extra_text": m.extra_text or "",
            "date": m.created_at,
            "md_path": m.md_path,
        }
