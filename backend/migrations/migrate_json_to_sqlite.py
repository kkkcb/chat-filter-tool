"""从 index.json 迁移数据到 SQLite"""
import json
import sys
from pathlib import Path

# 添加 backend 到 path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import engine, SessionLocal, init_db, Base
from app.models.material import Material
from app.config import settings


def migrate():
    """执行迁移"""
    init_db()

    index_file = settings.inbox_path / "index.json"
    if not index_file.exists():
        print(f"[迁移] index.json 不存在: {index_file}")
        return

    with open(index_file, "r", encoding="utf-8") as f:
        items = json.load(f)

    print(f"[迁移] 读取到 {len(items)} 条记录")

    db = SessionLocal()
    try:
        existing = db.query(Material).count()
        if existing > 0:
            print(f"[迁移] SQLite 已有 {existing} 条记录，跳过迁移")
            return

        count = 0
        for item in items:
            md_file = item.get("file", "")
            md_path = Path(settings.inbox_path) / md_file if md_file else None

            material = Material(
                title=item.get("title", "未知标题"),
                url=item.get("url", ""),
                source_type=item.get("source", "web"),
                category=item.get("category", "待分类"),
                summary=item.get("summary", ""),
                tags=json.dumps(item.get("tags", []), ensure_ascii=False),
                md_path=str(md_file),
                created_at=item.get("date", "") or None,
            )
            db.add(material)
            count += 1

        db.commit()
        print(f"[迁移] 成功迁移 {count} 条记录到 SQLite")

        # 验证
        total = db.query(Material).count()
        print(f"[迁移] 验证: SQLite 中现有 {total} 条记录")

    except Exception as e:
        db.rollback()
        print(f"[迁移] 失败: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    migrate()
