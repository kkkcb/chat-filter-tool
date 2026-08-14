"""FTS5 全文检索 — 中文 bigram 分词

SQLite FTS5 的 unicode61 分词器会把连续中文整串当作一个 token，
因此入库和查询都必须先做 bigram 预处理（"浏览器自动化" → "浏览 览器 器自 自动 动化"）。

所有函数都设计为"尽力而为"：FTS5 不可用或索引损坏时抛异常/返回 None，
调用方（material_service）回退到关键词暴力扫描，主流程不受影响。
"""
import re

from sqlalchemy import text

FTS_TABLE = "materials_fts"

# 标记 FTS 是否可用，避免每次查询都重复失败的 DDL
_fts_available: bool | None = None

_CJK_RE = re.compile(r"[\u4e00-\u9fff]+")
_WORD_RE = re.compile(r"[A-Za-z0-9_]+")


def bigramize(text: str) -> str:
    """文本 → 空格分隔的 token 串（英文小写化 + 中文 2-gram）"""
    if not text:
        return ""
    tokens = [w.lower() for w in _WORD_RE.findall(text)]
    for run in _CJK_RE.findall(text):
        if len(run) == 1:
            tokens.append(run)
        else:
            tokens.extend(run[i:i + 2] for i in range(len(run) - 1))
    return " ".join(tokens)


def _material_text(m) -> str:
    """拼接索引文本；标题重复两次提高权重"""
    raw = f"{m.title} {m.title} {m.summary or ''} {m.tags or ''} {m.category or ''} {m.extra_text or ''}"
    return bigramize(raw)


def rebuild(db) -> int:
    """全量重建索引，返回索引条数。FTS5 不支持时抛异常。"""
    global _fts_available
    from app.models.material import Material

    db.execute(text(f"DROP TABLE IF EXISTS {FTS_TABLE}"))
    db.execute(
        text(f"CREATE VIRTUAL TABLE {FTS_TABLE} USING fts5(text, material_id UNINDEXED)")
    )
    for m in db.query(Material).all():
        db.execute(
            text(f"INSERT INTO {FTS_TABLE}(text, material_id) VALUES (:t, :i)"),
            {"t": _material_text(m), "i": m.id},
        )
    db.commit()
    _fts_available = True
    return db.query(Material).count()


def upsert(db, material) -> None:
    """写入/更新单条索引（best-effort，失败静默——下次 rebuild 会修复）"""
    try:
        remove(db, material.id)
        db.execute(
            text(f"INSERT INTO {FTS_TABLE}(text, material_id) VALUES (:t, :i)"),
            {"t": _material_text(material), "i": material.id},
        )
        db.commit()
    except Exception:
        pass


def remove(db, material_id: int) -> None:
    """删除单条索引（best-effort）"""
    try:
        db.execute(
            text(f"DELETE FROM {FTS_TABLE} WHERE material_id = :i"), {"i": material_id}
        )
        db.commit()
    except Exception:
        pass


def search(db, query: str, limit: int = 5) -> list[int] | None:
    """全文检索，返回按相关度排序的 material id 列表。

    返回 None 表示 FTS 不可用（调用方应回退到暴力扫描）；
    返回 [] 表示正常查询但无命中。
    """
    global _fts_available
    if _fts_available is False:
        return None

    tokens = bigramize(query).split()
    if not tokens:
        return []

    try:
        # 首次使用时自动建索引（比如建表之后从没 rebuild 过）
        db.execute(text(f"SELECT count(*) FROM {FTS_TABLE}")).scalar()
    except Exception:
        try:
            rebuild(db)
        except Exception:
            _fts_available = False
            return None

    match_expr = " OR ".join(f'"{t}"' for t in tokens)
    try:
        rows = db.execute(
            text(f"SELECT material_id FROM {FTS_TABLE} WHERE text MATCH :m "
                 f"ORDER BY rank LIMIT :l"),
            {"m": match_expr, "l": limit},
        ).fetchall()
        return [r[0] for r in rows]
    except Exception:
        return None
