"""Markdown 文件读写抽象层"""
import re
import hashlib
from datetime import datetime
from pathlib import Path

from app.config import settings


def save_markdown(entry: dict) -> tuple[str, str]:
    """
    保存为 Markdown 文件，返回 (相对路径, content_hash)。
    entry 需包含: title, url, source_type, category, tags, summary, content, extra_text
    """
    inbox = settings.inbox_path
    cat = entry.get("category", "待分类")
    cat_dir = inbox / cat
    cat_dir.mkdir(parents=True, exist_ok=True)

    safe_title = re.sub(r'[\\/:*?"<>|]', "_", entry.get("title", "untitled"))[:50]
    date_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{date_str}_{safe_title}.md"
    filepath = cat_dir / filename

    tags = entry.get("tags", [])
    tags_str = ", ".join(tags) if tags else ""

    md_content = f"""---
title: "{entry.get('title', '')}"
url: {entry.get('url', '')}
source: {entry.get('source_type', 'web')}
date: {datetime.now().isoformat()}
category: {cat}
tags: [{tags_str}]
summary: "{entry.get('summary', '')}"
"""
    if entry.get("extra_text"):
        md_content += f'meta: "{entry["extra_text"]}"\n'
    md_content += "---\n\n"
    md_content += f"# {entry.get('title', '')}\n\n"
    if entry.get("summary"):
        md_content += f"> {entry['summary']}\n\n"
    md_content += f"🔗 [原文链接]({entry.get('url', '')})\n\n"
    if entry.get("extra_text"):
        md_content += f"📊 {entry['extra_text']}\n\n"
    md_content += "---\n\n"
    md_content += entry.get("content", "")
    md_content += "\n"

    filepath.write_text(md_content, encoding="utf-8")

    # content hash for dedup
    content_hash = hashlib.md5(
        entry.get("content", "").encode("utf-8")
    ).hexdigest()

    rel_path = str(filepath.relative_to(inbox))
    return rel_path, content_hash


def read_markdown(md_path: str) -> str:
    """读取 Markdown 文件正文（自动剥离 YAML frontmatter）"""
    inbox = settings.inbox_path
    filepath = inbox / md_path
    if not filepath.exists():
        return ""
    content = filepath.read_text(encoding="utf-8")

    # 剥离 YAML frontmatter（--- ... --- 包裹的元数据块）
    if content.startswith("---"):
        end = content.find("\n---", 3)
        if end != -1:
            content = content[end + 4:].strip()

    return content
