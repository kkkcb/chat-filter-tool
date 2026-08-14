"""SQLite 数据库引擎、Session 工厂、建表"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},  # SQLite 多线程
    echo=False,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    """FastAPI 依赖注入：获取数据库 Session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """创建所有表并重建全文索引"""
    from app.models import material, conversation  # noqa: F401
    Base.metadata.create_all(bind=engine)

    # 重建 FTS5 索引（捕获迁移/手工改动；失败则回退关键词扫描）
    from app.core import fts
    try:
        with SessionLocal() as db:
            fts.rebuild(db)
    except Exception as e:
        print(f"[FTS] 索引初始化失败，检索将回退关键词扫描: {e}")
