"""LLM 服务 — 统一封装智谱 GLM 文本+视觉调用"""
import re
import json
import httpx

from app.config import settings


class LLMService:
    """所有 AI 调用的统一入口"""

    def __init__(self):
        self.api_key = settings.glm_api_key
        self.endpoint = settings.glm_endpoint
        self.text_model = settings.glm_model
        self.vision_model = settings.glm_vision_model
        self._client: httpx.AsyncClient | None = None

    def _get_client(self) -> httpx.AsyncClient:
        """共享 AsyncClient，复用连接池；意外关闭时自动重建"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=120)
        return self._client

    async def aclose(self):
        """应用退出时释放连接池（见 main.py lifespan）"""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def _call(self, messages, model=None, json_mode=False, temperature=0.7, timeout=60) -> str | None:
        """底层调用方法"""
        model = model or self.text_model
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {"model": model, "messages": messages, "temperature": temperature}
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        try:
            resp = await self._get_client().post(
                self.endpoint, headers=headers, json=payload, timeout=timeout
            )
            if resp.status_code == 200:
                return resp.json()["choices"][0]["message"]["content"].strip()
            print(f"[LLM] HTTP {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            print(f"[LLM] 调用失败: {e}")
        return None

    async def chat(self, messages, json_mode=False, temperature=0.7) -> str | None:
        """通用文本对话"""
        return await self._call(messages, json_mode=json_mode, temperature=temperature)

    async def chat_stream(self, messages, temperature=0.7, thinking=True, tools=None):
        """流式对话 — yield (type, content) where type is 'reasoning' / 'content' / 'tool_calls'
        thinking=True 开启深度思考（慢但深度），False 关闭（快速响应）
        tools 传入 OpenAI 格式工具清单时启用 function calling：模型请求调用
        工具时一次性 yield ('tool_calls', [{id, function:{name, arguments}}])，
        由调用方执行工具、把结果追加进 messages 后再次调用本方法。
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.text_model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
            "max_tokens": 4096,
        }
        if tools:
            payload["tools"] = tools
        # 关闭思考模式可大幅降低首 token 延迟
        if not thinking:
            payload["thinking"] = {"type": "disabled"}

        try:
            client = self._get_client()
            async with client.stream("POST", self.endpoint, headers=headers, json=payload, timeout=120) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    print(f"[LLM Stream] HTTP {resp.status_code}: {body[:200]}")
                    yield ("error", f"HTTP {resp.status_code}")
                    return

                import time as _time
                _t0 = _time.time()
                _first = True
                _count = 0
                # tool_calls 流式分片按 index 拼装：id/name 首片到达，arguments 逐片追加
                _tool_calls: dict[int, dict] = {}

                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    data_str = line[6:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        choice = chunk.get("choices", [{}])[0]
                        delta = choice.get("delta", {})

                        if "reasoning_content" in delta and delta["reasoning_content"]:
                            if _first:
                                print(f"[LLM Stream] First reasoning chunk at {_time.time()-_t0:.1f}s")
                                _first = False
                            _count += 1
                            yield ("reasoning", delta["reasoning_content"])

                        if "content" in delta and delta["content"]:
                            if _first:
                                print(f"[LLM Stream] First content chunk at {_time.time()-_t0:.1f}s")
                                _first = False
                            _count += 1
                            yield ("content", delta["content"])

                        for tc in delta.get("tool_calls") or []:
                            idx = tc.get("index", 0)
                            slot = _tool_calls.setdefault(idx, {
                                "id": "", "type": "function",
                                "function": {"name": "", "arguments": ""},
                            })
                            if tc.get("id"):
                                slot["id"] = tc["id"]
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                slot["function"]["name"] += fn["name"]
                            if fn.get("arguments"):
                                slot["function"]["arguments"] += fn["arguments"]

                        if choice.get("finish_reason") == "tool_calls" and _tool_calls:
                            calls = [_tool_calls[i] for i in sorted(_tool_calls)]
                            print(f"[LLM Stream] Tool calls: {[c['function']['name'] for c in calls]}")
                            yield ("tool_calls", calls)

                    except json.JSONDecodeError:
                        continue

                print(f"[LLM Stream] Done: {_count} chunks in {_time.time()-_t0:.1f}s")
        except Exception as e:
            print(f"[LLM Stream] 调用失败: {e}")
            yield ("error", str(e))

    async def vision(self, image_data: str, prompt: str) -> str | None:
        """GLM-4.6V 视觉分析"""
        messages = [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": image_data}},
                {"type": "text", "text": prompt or "请详细描述这张图片的内容。"},
            ]
        }]
        return await self._call(messages, model=self.vision_model, timeout=90)

    async def classify(self, title: str, content: str, summary: str) -> dict | None:
        """素材智能分类 — 自动翻译英文为中文，保留中文原文"""
        cats_str = "、".join(settings.categories)
        prompt = f"""请分析以下网页内容并返回 JSON。

标题: {title}
摘要: {summary}
正文前2000字: {content[:2000]}

请严格返回以下 JSON 格式（不要 markdown 代码块，不要多余文字）:
{{
  "category": "从下列选最合适的一个: {cats_str}",
  "tags": ["3-5个中文关键词标签"],
  "title_cn": "标题的中文翻译。如果原标题已经是中文则原样返回；如果是英文则翻译成通顺的中文；如果是中英混合，保留中文部分，英文部分翻译成中文",
  "summary": "文章大纲：3-6 条要点，每条一行、30 字以内，用\\n分隔。按原文行文顺序提炼（是什么 → 核心观点/方法 → 关键结论），让读者扫一眼知道文章讲什么、值不值得点开原文",
  "bilingual": "可选。仅当原标题/摘要是纯英文时提供，格式为「英文原文 | 中文翻译」，用于中英对照展示。如果原文是中文则留空字符串",
  "content_cn": "将正文内容翻译成中文。要求：1) 如果原文已经是中文则直接返回原文 2) 如果是英文则翻译成通顺的中文，保留 Markdown 格式 3) 保留代码块、链接、列表等格式不变 4) 不要翻译代码、命令、技术术语（如 API、Docker 等） 5) 如果正文很长（超过3000字），只翻译前3000字并在末尾加「...(后续内容请查看原文）」"
}}
"""
        result = await self._call(
            [{"role": "user", "content": prompt}],
            json_mode=True, temperature=0.3, timeout=120
        )
        parsed = self._parse_json(result)
        if not parsed:
            return None

        # 用中文标题/摘要覆盖原始英文
        if parsed.get("title_cn"):
            parsed["original_title"] = title  # 保留原始标题
        if parsed.get("bilingual"):
            parsed["extra_text"] = parsed["bilingual"]

        return parsed

    async def polish_note(self, content: str) -> str | None:
        """笔记一键润色整理 — 优化表达与结构，不改原意不丢内容"""
        prompt = f"""你是一个中文写作润色助手。请润色整理下面这篇笔记。要求：
1. 修正错别字、标点和语病，让表达更通顺精炼
2. 优化段落与标题层级（可用 ## / ### 组织结构），让笔记更有条理
3. **保持 Markdown 格式**：代码块、命令、链接、图片引用（![..](..)）一律原样保留，一个字符都不能改
4. **不添加原文没有的信息**，不删减有效内容；列表要点可合并同类，但语义不能丢
5. 保留原文的第一人称语气和术语习惯

直接返回润色后的完整 Markdown 正文，不要任何解释或代码块包裹。

笔记内容：
{content[:30000]}"""
        return await self._call(
            [{"role": "user", "content": prompt}],
            temperature=0.3, timeout=120
        )

    async def summarize_note(self, transcript: str, instruction: str = "",
                             existing_categories: list | None = None) -> dict | None:
        """把对话记录总结成个人知识库笔记（标题/标签/分类/Markdown 正文）"""
        focus = f"\n用户特别关注：{instruction}\n" if instruction else ""
        cats = existing_categories or []
        cat_hint = (
            f"\n用户已有的笔记大分类：{', '.join(cats)}。\n"
            "category 字段优先从上述已有分类中选最贴合的一个；都不贴合时可新建一个 2-6 字的分类名；无法判断给空字符串。\n"
            if cats else
            "\ncategory 是笔记的大分类（如「技术原理」「个人规划」「踩坑记录」），2-6 个字；无法判断给空字符串。\n"
        )
        prompt = f"""你是一个经验沉淀助手。以下是用户与 AI 助手的对话记录，请把它总结成一篇可长期复用的个人知识库笔记。
{focus}{cat_hint}
要求：
1. 提炼这次对话中的「踩坑点」「解决办法」「经验结论」，没有的板块可省略
2. 保留具体的命令、配置、路径、错误信息等可操作细节
3. 正文用 Markdown，结构清晰（## 小标题、列表、代码块）
4. 标题一句话点明主题（20字以内），标签为 2-5 个中文关键词

请严格返回以下 JSON 格式（不要 markdown 代码块，不要多余文字）:
{{
  "title": "...",
  "tags": ["..."],
  "category": "...",
  "content": "markdown 正文"
}}

对话记录：
{transcript}"""
        result = await self._call(
            [{"role": "user", "content": prompt}],
            json_mode=True, temperature=0.3, timeout=120
        )
        return self._parse_json(result)

    async def generate_topics(self, kb_context: str) -> list:
        """生成选题建议"""
        prompt = (
            "你是AI科普公众号的选题顾问。用户公众号定位「一文一概念」，面向大众。\n\n"
            f"用户已收藏的素材：\n{kb_context}\n\n"
            "请生成 3 个选题建议。要求：\n"
            "1. 标题要有网感（吸引普通人点击，但不标题党）\n"
            "2. 涉及的AI概念要具体\n"
            "3. 给出为什么现在写这个的理由\n"
            "4. 建议的科普角度（从生活切入）\n\n"
            '返回JSON: {"topics": [{"title":"...","concepts":["概念"],"reason":"...","angle":"..."}]}'
        )
        result = await self._call(
            [{"role": "user", "content": prompt}],
            json_mode=True, temperature=0.8
        )
        parsed = self._parse_json(result)
        return parsed.get("topics", []) if parsed else []

    async def generate_titles(self, topic: str) -> list:
        """生成标题"""
        prompt = (
            f"你是AI科普公众号标题高手。为以下话题生成 5 个标题：\n\n话题：{topic}\n\n"
            "要求：引发好奇心但不标题党，适合微信公众号传播。"
            "5种风格各一个：疑问式、数字式、对比式、故事式、反常识式。\n\n"
            '返回JSON: {"titles": ["标题1","标题2","标题3","标题4","标题5"]}'
        )
        result = await self._call(
            [{"role": "user", "content": prompt}],
            json_mode=True, temperature=0.9
        )
        parsed = self._parse_json(result)
        return parsed.get("titles", []) if parsed else []

    async def generate_angles(self, topic: str, kb_context: str) -> list:
        """挖掘科普角度"""
        prompt = (
            f"你是AI科普写作教练。话题：{topic}\n\n"
            f"用户已有相关素材：\n{kb_context}\n\n"
            "请提供 3 个独特的科普角度。每个角度包含：\n"
            "- name: 角度名称\n"
            "- hook: 第一句话（抓人眼球）\n"
            "- analogy: 用生活中的事物类比AI概念\n"
            "- conflict: 核心冲突或悬念\n\n"
            '返回JSON: {"angles": [{"name":"...","hook":"...","analogy":"...","conflict":"..."}]}'
        )
        result = await self._call(
            [{"role": "user", "content": prompt}],
            json_mode=True, temperature=0.85
        )
        parsed = self._parse_json(result)
        return parsed.get("angles", []) if parsed else []

    @staticmethod
    def _parse_json(raw: str | None) -> dict | None:
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


# 单例
llm_service = LLMService()

# 视觉分析预设模式
VISION_PRESETS = {
    "describe": "请详细描述这张图片的内容，包括场景、人物、物体、文字等所有可见信息。",
    "ocr": "请提取图片中的所有文字内容。保持原始格式和层级结构。如果有表格，用 Markdown 表格输出。",
    "ui": "这是一个 UI 截图。请分析：1) 页面布局和组件结构 2) 配色方案 3) 交互元素 4) 如果要还原成代码，给出关键实现思路。",
    "error": "这是一个错误截图。请分析：1) 错误信息是什么 2) 可能的原因 3) 建议的修复方案。",
    "diagram": "这是一个技术图表/架构图。请结构化解读：1) 图表类型 2) 核心组件和它们的关系 3) 数据流/流程走向。",
    "chart": "这是一个数据可视化图表。请分析：1) 图表类型 2) 关键数据点和趋势 3) 异常值 4) 业务洞察。",
}
