import json
from datetime import datetime
from typing import Any, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.conversation import ChatMessage, Conversation
from app.schemas.invocation import Message

MAX_CONTEXT_MESSAGES = 40
MAX_CONTEXT_CHARS = 200_000


def conversation_or_none(conversation_id: str, owner_id: int, db: Session) -> Optional[Conversation]:
    return db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.owner_id == owner_id,
            Conversation.deleted_at.is_(None),
        )
    )


def get_next_seq(db: Session, conversation_id: str) -> int:
    last = db.scalar(
        select(ChatMessage.seq)
        .where(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.seq.desc())
        .limit(1)
    )
    return (last or 0) + 1


def active_messages(db: Session, conversation_id: str) -> List[ChatMessage]:
    rows = db.scalars(
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation_id, ChatMessage.superseded_by.is_(None))
        .order_by(ChatMessage.seq.asc())
    ).all()
    return [row for row in rows if row.status in {"sending", "streaming", "succeeded"}]


def build_context(db: Session, conversation: Conversation) -> tuple[List[Message], List[str]]:
    """构建发给模型的上下文：跳过 failed/cancelled/superseded，按条数与字符预算截断，保留首条 user 消息。"""
    rows = active_messages(db, conversation.id)
    warnings: List[str] = []
    valid_rows = list(rows)

    if len(valid_rows) > MAX_CONTEXT_MESSAGES:
        dropped = len(valid_rows) - MAX_CONTEXT_MESSAGES
        # 保留首条 user 消息（话题锚点）
        first_user = next((r for r in valid_rows if r.role == "user"), None)
        if first_user is not None:
            tail = valid_rows[-(MAX_CONTEXT_MESSAGES - 1):]
            valid_rows = [first_user] + tail
        else:
            valid_rows = valid_rows[-MAX_CONTEXT_MESSAGES:]
        warnings.append(f"已按条数截断早期 {dropped} 条消息")

    def total_chars(items: List[ChatMessage]) -> int:
        return sum(len(r.content or "") for r in items)

    if total_chars(valid_rows) > MAX_CONTEXT_CHARS:
        dropped = 0
        while len(valid_rows) > 1 and total_chars(valid_rows) > MAX_CONTEXT_CHARS:
            # 从最旧开始丢弃，但保留首条 user 消息
            first_user = next((r for r in valid_rows if r.role == "user"), None)
            if first_user is not None and valid_rows[0].id == first_user.id:
                # 丢第二条（保首条 user）
                if len(valid_rows) <= 2:
                    break
                valid_rows.pop(1)
            else:
                valid_rows.pop(0)
            dropped += 1
        warnings.append(f"已按字符预算截断早期 {dropped} 条消息")

    messages = [Message(role=row.role, content=row.content or "") for row in valid_rows]
    return messages, warnings


def resolve_system(request_system: Optional[str], conversation: Conversation, preference_system: Optional[str]) -> Optional[str]:
    if request_system is not None:
        return request_system.strip() or None
    if conversation.system_prompt:
        return conversation.system_prompt
    return preference_system


def apply_conversation_update(conversation: Conversation, payload: Any) -> None:
    data = payload.model_dump(exclude_unset=True)
    if "providerId" in data and data["providerId"] is not None:
        conversation.provider_id = data["providerId"]
    if "model" in data and data["model"] is not None:
        conversation.model = data["model"]
    if "system" in data and data["system"] is not None:
        conversation.system_prompt = data["system"].strip() or None
    if "title" in data and data["title"] is not None:
        conversation.title = data["title"].strip()[:200] or conversation.title
    if data.get("parameters") is not None:
        conversation.parameters_json = json.dumps(data["parameters"])


def touch_conversation(conversation: Conversation, preview: str, db: Session) -> None:
    conversation.message_count = (conversation.message_count or 0) + 1
    conversation.last_message_preview = preview[:120]
    conversation.last_message_at = datetime.utcnow()
    conversation.updated_at = datetime.utcnow()
    if conversation.title == "新对话" or not conversation.title:
        conversation.title = preview[:40] or "新对话"


def create_conversation(owner_id: int, payload: Any, db: Session) -> Conversation:
    conversation = Conversation(
        owner_id=owner_id,
        title=(payload.title or "新对话")[:200] if payload.title else "新对话",
        provider_id=payload.providerId or "",
        model=payload.model or "",
        system_prompt=(payload.system.strip() if payload.system and payload.system.strip() else None),
        parameters_json=json.dumps(payload.parameters.model_dump(exclude_none=True)) if payload.parameters else "{}",
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation