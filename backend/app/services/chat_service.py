"""对话服务 — 编排 clip/vision/qa，统一入口"""
import re
import json

from sqlalchemy.orm import Session

from app.services.llm_service import llm_service, VISION_PRESETS
from app.services.material_service import MaterialService


class ChatService:
    """对话编排：根据输入类型分发到不同处理逻辑"""

    def __init__(self, db: Session):
        self.db = db
        self.material_svc = MaterialService(db)

    async def handle_message(self, message: str, image: str = "", mode: str = "describe") -> dict:
        """
        统一入口：
        - 有图片 → 视觉分析
        - 有 URL → 链接处理
        - 否则 → 知识库对话
        """
        if image:
            return await self._handle_vision(image, message, mode)

        url_match = re.search(r"https?://[^\s<>\"']+", message)
        if url_match:
            return await self._handle_link(url_match.group(0))

        return await self._handle_chat(message)

    async def _handle_vision(self, image: str, prompt: str, mode: str) -> dict:
        """图片视觉分析"""
        actual_prompt = prompt if prompt else VISION_PRESETS.get(mode, VISION_PRESETS["describe"])
        mode_labels = {
            "describe": "📝 图片描述", "ocr": "🔤 文字提取", "ui": "🎨 UI分析",
            "error": "❌ 错误诊断", "diagram": "📊 图表解读", "chart": "📈 数据分析",
        }
        label = mode_labels.get(mode, "🔍 视觉分析")

        result = await llm_service.vision(image, actual_prompt)
        if result:
            return {"type": "vision", "reply": f"**{label}**\n\n{result}"}
        return {"type": "vision", "reply": "图片分析失败，请重试。"}

    async def _handle_link(self, url: str) -> dict:
        """链接处理 — 抓取+总结，但不自动保存，等用户确认"""
        result = await self.material_svc.preview_url(url)

        if not result.get("success"):
            if result.get("error") == "已存在":
                entry = result["entry"]
                return {
                    "type": "link",
                    "success": True,
                    "action": "already_saved",
                    "reply": f"**已在知识库中**\n\n**{entry['title']}**\n\n分类: {entry['category']}\n\n[查看原文]({url})",
                    "entry": entry,
                }
            return {"type": "link", "success": False, "reply": f"抓取失败：{result.get('error', '未知错误')}\n\n链接：{url}"}

        entry = result["entry"]
        source_labels = {"github": "GitHub 项目", "wechat": "公众号文章", "web": "网页"}
        source_label = source_labels.get(entry.get("source_type", "web"), "网页")

        reply = (
            f"**抓取成功**\n\n"
            f"**{entry['title']}**\n\n"
            f"- 来源：{source_label}\n"
            f"- 分类：{entry['category']}\n"
            f"- 标签：{', '.join(entry['tags']) if entry['tags'] else '无'}\n"
            f"- 摘要：{entry.get('summary') or '暂无'}\n"
        )
        if entry.get("extra_text"):
            reply += f"- 附加：{entry['extra_text']}\n"
        reply += f"\n[查看原文]({url})\n\n---\n**是否保存到知识库？**"

        return {
            "type": "link",
            "success": True,
            "action": "confirm_save",
            "reply": reply,
            "entry": entry,
        }

    async def handle_message_stream(self, message: str, image: str = "", mode: str = "describe", thinking: bool = False):
        """流式版统一入口 — yield (event_type, data_dict)"""
        if image:
            # 图片不支持流式，降级为普通调用
            result = await self._handle_vision(image, message, mode)
            yield ("done", result)
            return

        url_match = re.search(r"https?://[^\s<>\"']+", message)
        if url_match:
            # 链接不支持流式，降级为普通调用
            result = await self._handle_link(url_match.group(0))
            yield ("done", result)
            return

        # 普通对话走流式
        async for event in self._handle_chat_stream(message, thinking):
            yield event

    async def _handle_chat_stream(self, question: str, thinking: bool = False):
        """流式知识库对话"""
        rag_context, citations = self.material_svc.build_rag_context(question)

        if not rag_context:
            messages = [
                {"role": "system", "content": "你是一个AI科普创作助手，帮助用户运营AI科普公众号。用户知识库暂时没有素材，你可以基于通识回答问题。"},
                {"role": "user", "content": question},
            ]
        else:
            system_prompt = (
                "你是一个AI科普创作助手。用户正在运营AI科普公众号，坚持「一文一概念」系列。\n\n"
                "以下是用户的**知识库**中与问题最相关的素材（按相关度排序）：\n\n"
                f"{rag_context}\n\n"
                "请基于这些素材回答用户的问题。要求：\n"
                "1. 回答中**必须引用相关素材**，用 [序号] 标注引用来源\n"
                "2. 回答末尾列出「参考资料」部分，格式：序号 + 标题 + 链接\n"
                "3. 如果素材中没有完全匹配的内容，基于素材做合理延伸，并标注哪些是你的推断\n"
                "4. 回答要简洁有干货，适合中文表达\n"
                "5. 如果用户问的是某个技能/工具/理论，优先从知识库中找到对应素材引用"
            )
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": question},
            ]

        # 发送引用信息
        if citations:
            yield ("citations", citations)

        # 流式输出
        full_content = ""
        async for chunk_type, chunk_text in llm_service.chat_stream(messages, thinking=thinking):
            if chunk_type == "error":
                yield ("error", chunk_text)
                return
            yield (chunk_type, chunk_text)
            if chunk_type == "content":
                full_content += chunk_text

        yield ("done", {"type": "chat", "reply": full_content})

    async def _handle_chat(self, question: str) -> dict:
        """知识库对话 — 自动检索相关素材并引用"""
        # 检索最相关的素材
        rag_context, citations = self.material_svc.build_rag_context(question)

        if not rag_context:
            # 知识库为空或无匹配
            reply = await llm_service.chat([
                {"role": "system", "content": "你是一个AI科普创作助手，帮助用户运营AI科普公众号。用户知识库暂时没有素材，你可以基于通识回答问题。"},
                {"role": "user", "content": question},
            ])
            return {"type": "chat", "reply": reply or "暂时无法回答，请稍后再试。"}

        # 构建 RAG prompt
        system_prompt = (
            "你是一个AI科普创作助手。用户正在运营AI科普公众号，坚持「一文一概念」系列。\n\n"
            "以下是用户的**知识库**中与问题最相关的素材（按相关度排序）：\n\n"
            f"{rag_context}\n\n"
            "请基于这些素材回答用户的问题。要求：\n"
            "1. 回答中**必须引用相关素材**，用 [序号] 标注引用来源\n"
            "2. 回答末尾列出「参考资料」部分，格式：序号 + 标题 + 链接\n"
            "3. 如果素材中没有完全匹配的内容，基于素材做合理延伸，并标注哪些是你的推断\n"
            "4. 回答要简洁有干货，适合中文表达\n"
            "5. 如果用户问的是某个技能/工具/理论，优先从知识库中找到对应素材引用"
        )

        reply = await llm_service.chat_with_context(question, system_prompt)

        return {
            "type": "chat",
            "reply": reply or "暂时无法回答，请稍后再试。",
            "citations": citations,
        }
