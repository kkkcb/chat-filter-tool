"""检索结果相关性过滤 — 只有真正命中问题语义的素材/笔记才进入 RAG 上下文。

背景：FTS bigram 匹配过于宽松（命中只言片语即返回），导致弱相关甚至无关的
素材被注入、AI 被迫硬凑引用。此模块在检索后按 bigram 覆盖度做后过滤。
（中文无分词，整句精确匹配会过严——"浏览器自动化工具"匹配不上"浏览器
自动化指南"，故用 2-gram 滑窗覆盖比例。）
"""
import re

# 高频虚词/口语词，切词后剔除
_STOPWORDS = {
    "什么", "怎么", "怎样", "如何", "为什么", "哪些", "这个", "那个", "一下",
    "可以", "应该", "能帮", "帮我", "请问", "有没有", "是不是", "还是",
    "关于", "对于", "目前", "现在", "今天", "昨天", "觉得", "感觉", "可能",
    "他们", "我们", "你们", "自己", "出来", "进去", "看看", "说说", "讲讲",
    "介绍", "告诉", "知道", "意思", "东西", "问题", "内容", "方面", "时候",
    "哪些", "所有", "全部", "一些", "非常", "特别", "比较",
}


def extract_keywords(question: str) -> list[str]:
    """从问题提取实词（≥2 字、去停用词与停用子串、去纯数字）。

    中文整句常无分隔（"部署链路怎么配"是一整个词），停用词必须按
    子串剥除——否则"怎么"混进 bigram 池稀释命中比例。
    """
    words = [w for w in re.split(r"[\s，。、？！；：,.?!;:（）()\[\]【】\"'`]+", question) if len(w) >= 2]
    cleaned = []
    for w in words:
        if w in _STOPWORDS or w.isdigit():
            continue
        for sw in _STOPWORDS:
            if sw in w:
                w = w.replace(sw, "")
        if len(w) >= 2:
            cleaned.append(w)
    return cleaned


def _bigrams(word: str) -> set[str]:
    return {word[i:i + 2] for i in range(len(word) - 1)} if len(word) >= 2 else {word}


def is_relevant(question: str, candidate_text: str,
                min_hits: int = 2, min_ratio: float = 0.6) -> bool:
    """判断单个候选是否与问题足够相关（bigram 覆盖度）。

    相关 = 候选文本覆盖问题 bigram 池的比例 ≥ min_ratio（60%），
    且命中数 ≥ min_hits（防极短问题蹭词）。
    """
    kws = extract_keywords(question)
    if not kws:
        return False
    pool: set[str] = set()
    for w in kws:
        pool |= _bigrams(w)
    if not pool:
        return False
    text = candidate_text or ""
    hits = sum(1 for b in pool if b in text)
    # 无分词时长句必带功能字（我/的/里…）稀释比例——池越大门槛越宽：
    # 短问题（池<10）要求 60% 覆盖，长问题 35% 即算相关
    ratio = hits / len(pool)
    gate = 0.35 if len(pool) >= 10 else 0.6
    return hits >= min_hits and ratio >= gate
