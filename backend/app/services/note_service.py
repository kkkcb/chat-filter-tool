"""个人知识库笔记服务 — CRUD + FTS 检索 + 对话总结沉淀"""
from __future__ import annotations

import json
import re
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.note import Note
from app.models.conversation import Message
from app.core.fts import bigramize
from app.services.llm_service import llm_service

NOTES_FTS = "notes_fts"
_fts_available = None  # None=未探测 True/False=探测结果


def _note_text(n: Note) -> str:
    """笔记索引文本；标题重复两次提高权重"""
    raw = f"{n.title} {n.title} {n.content or ''} {n.tags or ''}"
    return bigramize(raw)


def _rebuild_fts(db: Session) -> None:
    global _fts_available
    from sqlalchemy import text as sql_text
    db.execute(sql_text(f"DROP TABLE IF EXISTS {NOTES_FTS}"))
    db.execute(sql_text(
        f"CREATE VIRTUAL TABLE {NOTES_FTS} USING fts5(txt, note_id UNINDEXED)"
    ))
    for n in db.query(Note).all():
        db.execute(
            sql_text(f"INSERT INTO {NOTES_FTS}(txt, note_id) VALUES (:t, :i)"),
            {"t": _note_text(n), "i": n.id},
        )
    db.commit()
    _fts_available = True


def _fts_upsert(db: Session, note: Note) -> None:
    try:
        from sqlalchemy import text as sql_text
        db.execute(sql_text(f"DELETE FROM {NOTES_FTS} WHERE note_id = :i"), {"i": note.id})
        db.execute(
            sql_text(f"INSERT INTO {NOTES_FTS}(txt, note_id) VALUES (:t, :i)"),
            {"t": _note_text(note), "i": note.id},
        )
        db.commit()
    except Exception:
        pass


def _fts_remove(db: Session, note_id: int) -> None:
    try:
        from sqlalchemy import text as sql_text
        db.execute(sql_text(f"DELETE FROM {NOTES_FTS} WHERE note_id = :i"), {"i": note_id})
        db.commit()
    except Exception:
        pass


class NoteService:
    """个人知识库：笔记的增删改查、全文检索、对话总结"""

    def __init__(self, db: Session):
        self.db = db

    # ===== CRUD =====

    def list(self, q: str = "", tag: str = "") -> list[dict]:
        query = self.db.query(Note).order_by(Note.updated_at.desc())
        notes = query.all()
        q_lower = (q or "").lower()
        result = []
        for n in notes:
            d = self._to_dict(n)
            if q_lower and q_lower not in (n.title or "").lower() \
                    and q_lower not in (n.content or "").lower() \
                    and not any(q_lower in t.lower() for t in d["tags"]):
                continue
            if tag and tag not in d["tags"]:
                continue
            result.append(d)
        return result

    def get(self, note_id: int) -> dict | None:
        n = self.db.query(Note).filter(Note.id == note_id).first()
        return self._to_dict(n) if n else None

    def create(self, title: str, content: str = "", tags: list | None = None,
               source_conversation_id: int | None = None) -> dict:
        now = datetime.now().isoformat()
        n = Note(
            title=title or "未命名笔记",
            content=content or "",
            tags=json.dumps(tags or [], ensure_ascii=False),
            source_conversation_id=source_conversation_id,
            created_at=now, updated_at=now,
        )
        self.db.add(n)
        self.db.commit()
        self.db.refresh(n)
        _fts_upsert(self.db, n)
        return self._to_dict(n)

    def update(self, note_id: int, title: str | None = None, content: str | None = None,
               tags: list | None = None) -> dict | None:
        n = self.db.query(Note).filter(Note.id == note_id).first()
        if not n:
            return None
        if title is not None:
            n.title = title or "未命名笔记"
        if content is not None:
            n.content = content
        if tags is not None:
            n.tags = json.dumps(tags, ensure_ascii=False)
        n.updated_at = datetime.now().isoformat()
        self.db.commit()
        self.db.refresh(n)
        _fts_upsert(self.db, n)
        return self._to_dict(n)

    def delete(self, note_id: int) -> bool:
        n = self.db.query(Note).filter(Note.id == note_id).first()
        if not n:
            return False
        self.db.delete(n)
        self.db.commit()
        _fts_remove(self.db, note_id)
        return True

    def stats(self) -> dict:
        total = self.db.query(func.count(Note.id)).scalar() or 0
        tag_counter: dict[str, int] = {}
        for n in self.db.query(Note.tags).all():
            try:
                for t in json.loads(n[0] or "[]"):
                    tag_counter[t] = tag_counter.get(t, 0) + 1
            except (json.JSONDecodeError, TypeError):
                continue
        return {"total": total, "tags": tag_counter}

    # ===== 检索（对话 RAG 用） =====

    def search_relevant(self, question: str, limit: int = 3) -> list[dict]:
        global _fts_available
        if _fts_available is False:
            return self._scan(question, limit)

        tokens = bigramize(question).split()
        if not tokens:
            return []

        from sqlalchemy import text as sql_text
        try:
            db = self.db
            try:
                db.execute(sql_text(f"SELECT count(*) FROM {NOTES_FTS}")).scalar()
            except Exception:
                _rebuild_fts(db)
        except Exception:
            _fts_available = False
            return self._scan(question, limit)

        match_expr = " OR ".join(f'"{t}"' for t in tokens)
        try:
            rows = db.execute(
                sql_text(f"SELECT note_id FROM {NOTES_FTS} WHERE txt MATCH :m "
                         f"ORDER BY rank LIMIT :l"),
                {"m": match_expr, "l": limit},
            ).fetchall()
            ids = [r[0] for r in rows]
        except Exception:
            return self._scan(question, limit)

        if not ids:
            return []
        notes = self.db.query(Note).filter(Note.id.in_(ids)).all()
        by_id = {n.id: n for n in notes}
        return [self._to_dict(by_id[i]) for i in ids if i in by_id]

    def _scan(self, question: str, limit: int) -> list[dict]:
        """FTS 不可用时的暴力回退：按关键词包含匹配标题/正文/标签"""
        kws = [w for w in re.split(r"[\s，。、？！]+", question) if len(w) >= 2]
        if not kws:
            return []
        scored = []
        for n in self.db.query(Note).all():
            text = f"{n.title} {n.content} {n.tags}".lower()
            score = sum(1 for k in kws if k.lower() in text)
            if score > 0:
                scored.append((score, n))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [self._to_dict(n) for _, n in scored[:limit]]

    def build_note_context(self, question: str, limit: int = 3) -> tuple[str, list]:
        """构建笔记 RAG 上下文块 + 引用列表（编号独立于素材）"""
        relevant = self.search_relevant(question, limit=limit)
        if not relevant:
            return "", []
        parts, citations = [], []
        for i, n in enumerate(relevant, 1):
            excerpt = (n["content"] or "")[:600]
            parts.append(
                f"[N{i}] {n['title']}\n"
                f"    标签: {', '.join(n['tags'])}\n"
                f"    内容节选: {excerpt}"
            )
            citations.append({**n, "source_type": "note"})
        header = "以下是用户的**个人知识库笔记**（历史对话沉淀的经验，编号 N1..）：\n\n"
        return header + "\n\n".join(parts), citations

    # ===== 对话总结沉淀 =====

    async def summarize_from_conversation(self, conversation_id: int, instruction: str = "") -> dict:
        """把一段对话总结成笔记并保存，返回新笔记"""
        msgs = (
            self.db.query(Message)
            .filter(Message.conversation_id == conversation_id)
            .order_by(Message.id.asc())
            .all()
        )
        transcript_parts = []
        for m in msgs:
            if m.role not in ("user", "assistant"):
                continue
            content = (m.content or "").strip()
            if not content:
                continue
            transcript_parts.append(f"{'用户' if m.role == 'user' else '助手'}: {content[:2000]}")
        if not transcript_parts:
            raise ValueError("该对话没有可总结的内容")

        transcript = "\n\n".join(transcript_parts)[-30000:]  # 防 prompt 过长
        result = await llm_service.summarize_note(transcript, instruction)
        if not result or not result.get("content"):
            raise RuntimeError("AI 总结失败，请稍后重试")

        return self.create(
            title=result.get("title") or "对话总结笔记",
            content=result["content"],
            tags=result.get("tags") or [],
            source_conversation_id=conversation_id,
        )

    @staticmethod
    def _to_dict(n: Note) -> dict:
        try:
            tags = json.loads(n.tags) if n.tags else []
        except (json.JSONDecodeError, TypeError):
            tags = []
        excerpt = re.sub(r"[#*`>\-\[\]()!]+", " ", n.content or "")
        excerpt = re.sub(r"\s+", " ", excerpt).strip()
        return {
            "id": n.id,
            "title": n.title,
            "content": n.content or "",
            "excerpt": excerpt[:160],
            "tags": tags,
            "source_conversation_id": n.source_conversation_id,
            "created_at": n.created_at,
            "updated_at": n.updated_at,
        }
