#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
AI 科普工作台 — 后端
两个板块：知识库（对话式链接剪藏）+ 创作灵感
"""

import json, os, re, sys, base64
from datetime import datetime
from urllib.parse import urlparse

# ======================== 依赖检查 ========================
try:
    from flask import Flask, request, jsonify, send_from_directory
    from flask_cors import CORS
    import requests
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "flask", "flask-cors", "requests", "-q"])
    from flask import Flask, request, jsonify, send_from_directory
    from flask_cors import CORS
    import requests

# ======================== 配置 ========================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)
sys.path.insert(0, os.path.join(PARENT_DIR, "tools"))

INBOX_DIR = os.path.join(PARENT_DIR, "inbox")
INDEX_FILE = os.path.join(INBOX_DIR, "index.json")

CATEGORIES = [
    "AI概念与原理", "AI工具与产品", "AI科普灵感",
    "GitHub项目", "行业资讯", "写作技巧", "待分类",
]

GLM_API_KEY = "563532a9cb6d4b26ac3f0729eefe24eb.6kmGFtyL4NRMJHYJ"
GLM_ENDPOINT = "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions"
GLM_MODEL = "glm-5.2"

# 视觉理解模型（GLM-4.6V）使用 coding plan 端点
GLM_VISION_MODEL = "glm-4.6v"

app = Flask(__name__)
CORS(app)

# ======================== 导入 clip.py 抓取引擎 ========================
from clip import (
    detect_source, fetch_github, fetch_wechat, fetch_webpage,
    ai_classify, save_entry
)


# ======================== GLM 通用调用 ========================
def call_glm(messages, json_mode=False, temperature=0.7, timeout=60):
    """调用智谱 GLM，返回文本或 None"""
    headers = {
        "Authorization": f"Bearer {GLM_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {"model": GLM_MODEL, "messages": messages, "temperature": temperature}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    try:
        resp = requests.post(GLM_ENDPOINT, headers=headers, json=payload, timeout=timeout)
        if resp.status_code == 200:
            return resp.json()["choices"][0]["message"]["content"].strip()
        print(f"[GLM] HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print(f"[GLM] 调用失败: {e}")
    return None


def call_glm_vision(image_data, prompt, timeout=90):
    """调用 GLM-4.6V 视觉模型，image_data 可以是 URL 或 base64 data URL"""
    headers = {
        "Authorization": f"Bearer {GLM_API_KEY}",
        "Content-Type": "application/json",
    }
    messages = [{
        "role": "user",
        "content": [
            {"type": "image_url", "image_url": {"url": image_data}},
            {"type": "text", "text": prompt or "请详细描述这张图片的内容。"},
        ]
    }]
    payload = {"model": GLM_VISION_MODEL, "messages": messages}
    try:
        resp = requests.post(GLM_ENDPOINT, headers=headers, json=payload, timeout=timeout)
        if resp.status_code == 200:
            return resp.json()["choices"][0]["message"]["content"].strip()
        else:
            print(f"[GLM Vision] HTTP {resp.status_code}: {resp.text[:300]}")
    except Exception as e:
        print(f"[GLM Vision] 调用失败: {e}")
    return None


def load_index():
    """加载素材索引"""
    if not os.path.exists(INDEX_FILE):
        return []
    try:
        with open(INDEX_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


# ======================== API: 首页 ========================
@app.route("/")
def index():
    return send_from_directory(os.path.join(BASE_DIR, "templates"), "index.html")


# ======================== API: 对话（核心） ========================
@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.json or {}
    message = (data.get("message") or "").strip()
    image = data.get("image", "")

    if not message and not image:
        return jsonify({"error": "消息不能为空"}), 400

    # 有图片 → 视觉分析
    if image:
        return process_vision(image, message, data.get("mode", "describe"))

    # 检测 URL
    url_match = re.search(r"https?://[^\s<>\"']+", message)
    if url_match:
        return process_link(url_match.group(0))

    # 普通对话
    return chat_with_kb(message)


def process_vision(image, prompt, mode="describe"):
    """图片视觉分析"""
    # 如果用户有自定义 prompt，优先用；否则用预设模式
    if prompt:
        actual_prompt = prompt
    else:
        actual_prompt = VISION_PRESETS.get(mode, VISION_PRESETS["describe"])

    mode_label = {"describe":"📝 图片描述","ocr":"🔤 文字提取","ui":"🎨 UI分析",
                  "error":"❌ 错误诊断","diagram":"📊 图表解读","chart":"📈 数据分析"}.get(mode, "🔍 视觉分析")

    result = call_glm_vision(image, actual_prompt)
    if result:
        return jsonify({"type": "vision", "reply": f"**{mode_label}**\n\n{result}"})
    return jsonify({"type": "vision", "reply": "图片分析失败，请重试。"}), 500


def process_link(url):
    """链接处理：抓取 → AI分类 → 保存 → 返回总结"""
    try:
        src_type = detect_source(url)

        if src_type == "github":
            page_data = fetch_github(url)
        elif src_type == "wechat":
            page_data = fetch_wechat(url)
        else:
            page_data = fetch_webpage(url)

        if not page_data:
            return jsonify({
                "type": "link",
                "success": False,
                "reply": f"抓取失败，无法获取该链接内容。可能是网站限制了访问。\n\n链接：{url}",
            })

        # AI 分类
        ai_result = ai_classify(
            page_data["title"],
            page_data.get("content", ""),
            page_data.get("summary", ""),
        )

        category = "待分类"
        tags = []
        if ai_result:
            category = ai_result.get("category", "待分类")
            if category not in CATEGORIES:
                category = "待分类"
            tags = ai_result.get("tags", [])
            if ai_result.get("summary"):
                page_data["summary"] = ai_result["summary"]

        # 保存
        entry = {
            **page_data,
            "url": url,
            "source_type": src_type,
            "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "category": category,
            "tags": tags,
        }
        save_entry(entry)

        source_label = {
            "github": "GitHub 项目",
            "wechat": "公众号文章",
            "web": "网页",
        }.get(src_type, "网页")

        reply = (
            f"**已收录到知识库**\n\n"
            f"**{page_data['title']}**\n\n"
            f"- 来源：{source_label}\n"
            f"- 分类：{category}\n"
            f"- 标签：{', '.join(tags) if tags else '无'}\n"
            f"- 摘要：{page_data.get('summary', '暂无')}\n"
        )
        if page_data.get("extra_text"):
            reply += f"- 附加：{page_data['extra_text']}\n"
        reply += f"\n[查看原文]({url})"

        return jsonify({
            "type": "link",
            "success": True,
            "reply": reply,
            "entry": {
                "title": page_data["title"],
                "url": url,
                "category": category,
                "tags": tags,
                "summary": page_data.get("summary", ""),
                "source": src_type,
            },
        })

    except Exception as e:
        return jsonify({
            "type": "link",
            "success": False,
            "reply": f"处理链接时出错：{str(e)}",
        }), 500


def chat_with_kb(question):
    """基于知识库回答问题"""
    index = load_index()

    if not index:
        reply = call_glm(
            [
                {"role": "system", "content": "你是一个AI科普创作助手，帮助用户运营AI科普公众号。"},
                {"role": "user", "content": question},
            ]
        )
        return jsonify({"type": "chat", "reply": reply or "暂时无法回答，请稍后再试。"})

    # 构建知识库摘要（最近 20 条）
    kb_summary = "\n".join(
        f"- [{m.get('category', '未分类')}] {m.get('title', '无标题')}: {m.get('summary', '')}"
        for m in index[-20:]
    )

    system_prompt = (
        "你是一个AI科普创作助手。用户正在运营AI科普公众号，坚持「一文一概念」系列。\n\n"
        "以下是用户已收藏的知识库素材：\n"
        f"{kb_summary}\n\n"
        "请基于这些素材回答用户的问题。如果与素材相关，可以引用具体内容。"
        "回答要简洁、有干货，适合中文表达。"
    )

    reply = call_glm([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": question},
    ])

    return jsonify({"type": "chat", "reply": reply or "暂时无法回答，请稍后再试。"})


# ======================== API: 文件上传 ========================
@app.route("/api/upload", methods=["POST"])
def upload():
    """接收图片文件，返回 base64 data URL"""
    if "file" not in request.files:
        return jsonify({"error": "没有文件"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "没有文件名"}), 400

    data = file.read()
    if len(data) > 10 * 1024 * 1024:
        return jsonify({"error": "文件过大（最大 10MB）"}), 400

    b64 = base64.b64encode(data).decode("utf-8")
    mime = file.content_type or "image/png"
    data_url = f"data:{mime};base64,{b64}"
    return jsonify({"image": data_url, "size": len(data), "name": file.filename})


# ======================== API: 视觉分析（预设模式） ========================
VISION_PRESETS = {
    "describe": "请详细描述这张图片的内容，包括场景、人物、物体、文字等所有可见信息。",
    "ocr": "请提取图片中的所有文字内容。保持原始格式和层级结构。如果有表格，用 Markdown 表格输出。",
    "ui": "这是一个 UI 截图。请分析：1) 页面布局和组件结构 2) 配色方案 3) 交互元素 4) 如果要还原成代码，给出关键实现思路。",
    "error": "这是一个错误截图。请分析：1) 错误信息是什么 2) 可能的原因 3) 建议的修复方案。",
    "diagram": "这是一个技术图表/架构图。请结构化解读：1) 图表类型 2) 核心组件和它们的关系 3) 数据流/流程走向。",
    "chart": "这是一个数据可视化图表。请分析：1) 图表类型 2) 关键数据点和趋势 3) 异常值 4) 业务洞察。",
}

@app.route("/api/vision", methods=["POST"])
def vision():
    data = request.json or {}
    image = data.get("image", "")
    mode = data.get("mode", "describe")
    custom_prompt = data.get("prompt", "")

    if not image:
        return jsonify({"error": "请提供图片"}), 400

    if custom_prompt:
        prompt = custom_prompt
    else:
        prompt = VISION_PRESETS.get(mode, VISION_PRESETS["describe"])

    result = call_glm_vision(image, prompt)
    if result:
        return jsonify({"reply": result})
    return jsonify({"error": "视觉分析失败"}), 500


@app.route("/api/vision-presets")
def vision_presets():
    """返回可用的视觉分析模式"""
    return jsonify({"presets": VISION_PRESETS})


# ======================== API: 素材列表 ========================
@app.route("/api/materials")
def materials():
    return jsonify(load_index())


# ======================== API: 统计 ========================
@app.route("/api/stats")
def stats():
    from collections import Counter
    index = load_index()
    cat_count = Counter(m.get("category", "未分类") for m in index)
    return jsonify({
        "total": len(index),
        "categories": dict(cat_count),
        "recent": index[-5:][::-1] if index else [],
    })


# ======================== API: 创作灵感 ========================
@app.route("/api/inspire", methods=["POST"])
def inspire():
    data = request.json or {}
    action = data.get("action", "topics")
    index = load_index()

    if action == "topics":
        return _gen_topics(index)
    elif action == "titles":
        return _gen_titles(data.get("topic", ""))
    elif action == "angle":
        return _gen_angle(index, data.get("topic", ""))

    return jsonify({"error": "未知操作"}), 400


def _clean_json(raw):
    """清理 GLM 返回的 JSON"""
    if not raw:
        return None
    if raw.startswith("```"):
        raw = re.sub(r"^```\w*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
    try:
        return json.loads(raw)
    except Exception:
        return None


def _gen_topics(index):
    """基于知识库生成选题建议"""
    kb_text = "\n".join(
        f"- [{m.get('category')}] {m.get('title')}: {m.get('summary', '')}"
        for m in index[-20:]
    ) if index else "（暂无素材）"

    prompt = (
        "你是AI科普公众号的选题顾问。用户公众号定位「一文一概念」，面向大众。\n\n"
        f"用户已收藏的素材：\n{kb_text}\n\n"
        "请生成 3 个选题建议。要求：\n"
        "1. 标题要有网感（吸引普通人点击，但不标题党）\n"
        "2. 涉及的AI概念要具体\n"
        "3. 给出为什么现在写这个的理由\n"
        "4. 建议的科普角度（从生活切入）\n\n"
        '返回JSON: {"topics": [{"title":"...","concepts":["概念"],"reason":"...","angle":"..."}]}'
    )

    result = call_glm([{"role": "user", "content": prompt}], json_mode=True, temperature=0.8)
    parsed = _clean_json(result)
    if parsed and "topics" in parsed:
        return jsonify(parsed)
    return jsonify({"topics": [], "raw": result})


def _gen_titles(topic):
    """为话题生成标题"""
    if not topic:
        return jsonify({"titles": [], "error": "请输入话题"})

    prompt = (
        f"你是AI科普公众号标题高手。为以下话题生成 5 个标题：\n\n话题：{topic}\n\n"
        "要求：引发好奇心但不标题党，适合微信公众号传播。"
        "5种风格各一个：疑问式、数字式、对比式、故事式、反常识式。\n\n"
        '返回JSON: {"titles": ["标题1","标题2","标题3","标题4","标题5"]}'
    )

    result = call_glm([{"role": "user", "content": prompt}], json_mode=True, temperature=0.9)
    parsed = _clean_json(result)
    if parsed and "titles" in parsed:
        return jsonify(parsed)
    return jsonify({"titles": [], "raw": result})


def _gen_angle(index, topic):
    """为话题挖掘科普角度"""
    if not topic:
        return jsonify({"angles": [], "error": "请输入话题"})

    kb_text = "\n".join(
        f"- {m.get('title')}: {m.get('summary', '')}"
        for m in index[-10:]
    ) if index else ""

    prompt = (
        f"你是AI科普写作教练。话题：{topic}\n\n"
        f"用户已有相关素材：\n{kb_text}\n\n"
        "请提供 3 个独特的科普角度。每个角度包含：\n"
        "- name: 角度名称\n"
        "- hook: 第一句话（抓人眼球）\n"
        "- analogy: 用生活中的事物类比AI概念\n"
        "- conflict: 核心冲突或悬念\n\n"
        '返回JSON: {"angles": [{"name":"...","hook":"...","analogy":"...","conflict":"..."}]}'
    )

    result = call_glm([{"role": "user", "content": prompt}], json_mode=True, temperature=0.85)
    parsed = _clean_json(result)
    if parsed and "angles" in parsed:
        return jsonify(parsed)
    return jsonify({"angles": [], "raw": result})


# ======================== 启动 ========================
if __name__ == "__main__":
    os.makedirs(INBOX_DIR, exist_ok=True)
    count = len(load_index())
    print(f"\n{'='*50}")
    print(f"  AI 科普工作台")
    print(f"{'='*50}")
    print(f"  访问地址: http://localhost:5000")
    print(f"  知识库:   {INBOX_DIR}")
    print(f"  已有素材: {count} 条")
    print(f"{'='*50}\n")
    app.run(host="0.0.0.0", port=5000, debug=True)
