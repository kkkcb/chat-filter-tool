"""上下文压缩服务 —— 借鉴 deepseek-harness 的 compaction 策略。

dsh 的核心设计（源码 compaction-basic/summarizer.ts）：
1. 七段结构化检查点（原始意图/关键概念/文件与代码/错误与修复/
   待办/当前工作/下一步/关键上下文），要求保留精确路径、命令、
   错误串、数字、用户纠正
2. 摘要指令放在**重放对话的最后一条 user 消息**（而非独立 system
   prompt）——前缀与上次真实请求对齐，复用 KV 缓存
3. 遇到旧 <compacted-summary> 时合并而非照抄（增量压缩可重复执行）
4. 替换后的消息带 CHECKPOINT_PREAMBLE，让模型把检查点当既定背景

ICE 适配：中文输出、存 conversations.compacted_summary/compacted_upto，
_load_history 用「检查点 + 最近 N 条全文」替代原来的硬截断。
"""
from sqlalchemy.orm import Session

from app.config import settings
from app.models.conversation import Conversation, Message
from app.core.tasklog import log_task

# 近 N 条保持全文（检查点覆盖之前的）
RECENT_FULL = 12

SUMMARY_OPEN = "<compacted-summary>"
SUMMARY_CLOSE = "</compacted-summary>"

# dsh 原版指令的中文适配：作为重放对话的最后一条 user 消息发出
COMPACTION_INSTRUCTION = """你现在充当这个 AI 助手对话的压缩引擎。把上方对话浓缩成一份结构化检查点，让另一个模型能无损失地接续工作。

严格按下面的 Markdown 结构输出：保留每个小节、按顺序。用精炼要点而非段落。空节写「（无）」——绝不删除小节。

## 原始请求与意图
- [用户的原始目标和演化中的目标；措辞关键处引用原文]

## 关键概念
- [涉及的技术、框架、模式、约定]

## 文件与代码
- [精确路径：为什么重要、关键改动或片段]

## 错误与修复
- [错误：如何解决的，以及相关的用户反馈]

## 待办事项
- [明确要求但尚未完成的工作]

## 当前工作
- [检查点时刻正在进行什么]

## 下一步
- [单个下一步动作，直接对应最近的请求；没有则写「（无）」]

## 关键上下文
- [决策及其理由、约束、用户偏好、未解决的问题、继续所需的数据]

规则：
- 用简洁的中文工程化表述。保留精确的文件路径、命令、错误信息原文、标识符、数字、函数签名和语法片段。
- 忠实记录用户反馈和明确指令，尤其是纠正性意见。
- 不要提及本次压缩请求或上下文被压缩这件事。
- 只输出检查点文本：不要调用任何工具或执行其他动作。
- 如果对话中已存在 <compacted-summary> 块，它是先前的检查点：不要原样照抄——保留仍成立的事实、丢弃过时内容，把新信息合并成单一一致的结构化摘要。"""

CHECKPOINT_PREAMBLE = ("这是一段自动生成的检查点，浓缩了对话较早的内容以释放上下文空间。"
                       "把其中承载的上下文当作既定背景，在其基础上继续，不要复述。"
                       "直接从后面的消息继续任务，不要确认这个检查点。")


def _build_replay(db: Session, conv: Conversation) -> tuple[list[dict], int]:
    """检查点之后的消息（时间正序），连同末条消息 id。"""
    msgs = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id,
                Message.id > (conv.compacted_upto or 0))
        .order_by(Message.id.asc())
        .all()
    )
    history = [{"role": m.role, "content": m.content}
               for m in msgs
               if m.role in ("user", "assistant") and (m.content or "").strip()]
    last_id = msgs[-1].id if msgs else (conv.compacted_upto or 0)
    return history, last_id


async def compact_conversation(db: Session, conv_id: int) -> dict:
    """生成结构化检查点并写入会话。可重复执行（合并旧检查点）。"""
    import time as _t
    t0 = _t.monotonic()
    conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
    if not conv:
        return {"error": "对话不存在"}

    history, last_id = _build_replay(db, conv)
    # 旧检查点作为对话开头一起重放（合并语义）
    replay = []
    if conv.compacted_summary:
        replay.append({"role": "user", "content": CHECKPOINT_PREAMBLE + "\n\n" + conv.compacted_summary})
    replay.extend(history)
    if len(replay) < 4:
        return {"error": "消息太少，无需压缩"}
    replay.append({"role": "user", "content": COMPACTION_INSTRUCTION})

    from app.services.llm_service import llm_service
    summary = await llm_service._call(
        replay, model=settings.glm_polish_model, temperature=0.2, timeout=120, retries=1)
    if not summary or not summary.strip():
        return {"error": "摘要生成失败，请稍后重试"}
    summary = summary.strip()
    # 剥模型可能自带的围栏
    if summary.startswith("```"):
        summary = summary.strip("`").lstrip("markdown\n").strip()

    conv.compacted_summary = f"{SUMMARY_OPEN}\n{summary}\n{SUMMARY_CLOSE}"
    conv.compacted_upto = last_id
    conv.updated_at = __import__("datetime").datetime.now().isoformat()
    db.commit()

    log_task("chat.compaction", conv_id=conv_id, upto=last_id,
             replay_msgs=len(replay), summary_len=len(summary),
             latency_ms=int((_t.monotonic() - t0) * 1000))
    return {"ok": True, "upto": last_id, "summary_len": len(summary),
            "summary_preview": summary[:160]}


def load_history_with_checkpoint(db: Session, conv_id: int, before_id: int | None, limit: int = 32) -> list[dict]:
    """带检查点的历史加载：检查点 + 最近 N 条全文，替代旧硬截断。"""
    conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
    upto = conv.compacted_upto if conv else None
    summary = conv.compacted_summary if conv else None

    q = (db.query(Message)
         .filter(Message.conversation_id == conv_id)
         .order_by(Message.id.desc()))
    if before_id is not None:
        q = q.filter(Message.id < before_id)
    if upto:
        q = q.filter(Message.id > upto)
    msgs = q.limit(limit).all()

    history = []
    if summary:
        history.append({"role": "user", "content": CHECKPOINT_PREAMBLE + "\n\n" + summary})
    for m in reversed(msgs):
        if m.role in ("user", "assistant") and (m.content or "").strip():
            history.append({"role": m.role, "content": m.content})
    return history
