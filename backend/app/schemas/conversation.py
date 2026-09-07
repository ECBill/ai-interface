import json
from datetime import datetime
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.schemas.invocation import GenerationParameters


class ConversationCreate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    providerId: Optional[str] = None
    model: Optional[str] = Field(default=None, max_length=128)
    system: Optional[str] = Field(default=None, max_length=20_000)
    parameters: Optional[GenerationParameters] = None


class ConversationSettings(BaseModel):
    providerId: Optional[str] = None
    model: Optional[str] = Field(default=None, max_length=128)
    system: Optional[str] = Field(default=None, max_length=20_000)
    parameters: Optional[GenerationParameters] = None
    title: Optional[str] = Field(default=None, max_length=200)


class ConversationSummary(BaseModel):
    id: str
    title: str
    providerId: str
    model: str
    messageCount: int
    lastMessagePreview: Optional[str] = None
    createdAt: datetime
    updatedAt: datetime
    lastMessageAt: datetime


class ConversationDetail(ConversationSummary):
    systemPrompt: Optional[str] = None
    parameters: dict[str, Any] = Field(default_factory=dict)


def serialize_conversation_summary(row: Any) -> ConversationSummary:
    return ConversationSummary(
        id=row.id,
        title=row.title,
        providerId=row.provider_id,
        model=row.model,
        messageCount=row.message_count,
        lastMessagePreview=row.last_message_preview,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
        lastMessageAt=row.last_message_at,
    )


def serialize_conversation_detail(row: Any) -> ConversationDetail:
    try:
        parameters = json.loads(row.parameters_json or "{}")
    except json.JSONDecodeError:
        parameters = {}
    return ConversationDetail(
        id=row.id,
        title=row.title,
        providerId=row.provider_id,
        model=row.model,
        messageCount=row.message_count,
        lastMessagePreview=row.last_message_preview,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
        lastMessageAt=row.last_message_at,
        systemPrompt=row.system_prompt,
        parameters=parameters,
    )


class MessageResponse(BaseModel):
    id: str
    conversationId: str
    seq: int
    role: str
    content: str
    thinking: Optional[str] = None
    status: str
    providerId: Optional[str] = None
    model: Optional[str] = None
    invocationId: Optional[int] = None
    errorCode: Optional[str] = None
    inputTokens: Optional[int] = None
    outputTokens: Optional[int] = None
    totalTokens: Optional[int] = None
    latencyMs: Optional[int] = None
    firstTokenMs: Optional[int] = None
    finishReason: Optional[str] = None
    supersededBy: Optional[str] = None
    createdAt: datetime
    editedAt: Optional[datetime] = None


def serialize_message(row: Any) -> MessageResponse:
    return MessageResponse(
        id=row.id,
        conversationId=row.conversation_id,
        seq=row.seq,
        role=row.role,
        content=row.content or "",
        thinking=row.thinking,
        status=row.status,
        providerId=row.provider_id,
        model=row.model,
        invocationId=row.invocation_id,
        errorCode=row.error_code,
        inputTokens=row.input_tokens,
        outputTokens=row.output_tokens,
        totalTokens=row.total_tokens,
        latencyMs=row.latency_ms,
        firstTokenMs=row.first_token_ms,
        finishReason=row.finish_reason,
        supersededBy=row.superseded_by,
        createdAt=row.created_at,
        editedAt=row.edited_at,
    )


class SendMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=100_000)
    providerId: Optional[str] = None
    model: Optional[str] = Field(default=None, max_length=128)
    system: Optional[str] = Field(default=None, max_length=20_000)
    parameters: Optional[GenerationParameters] = None
    stream: bool = True

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("消息内容不能为空")
        return value


class MessageEditRequest(BaseModel):
    content: str = Field(min_length=1, max_length=100_000)


class PreferenceResponse(BaseModel):
    lastProviderId: Optional[str] = None
    lastModel: Optional[str] = None
    lastConversationId: Optional[str] = None
    defaultSystemPrompt: Optional[str] = None
    defaultParameters: dict[str, Any] = Field(default_factory=dict)
    streamByDefault: bool = True
    showThinking: str = "collapsed"
    uiPrefs: dict[str, Any] = Field(default_factory=dict)


class PreferenceUpdate(BaseModel):
    lastProviderId: Optional[str] = None
    lastModel: Optional[str] = Field(default=None, max_length=128)
    lastConversationId: Optional[str] = Field(default=None, max_length=32)
    defaultSystemPrompt: Optional[str] = Field(default=None, max_length=20_000)
    defaultParameters: Optional[GenerationParameters] = None
    streamByDefault: Optional[bool] = None
    showThinking: Optional[Literal["expanded", "collapsed", "hidden"]] = None
    uiPrefs: Optional[dict[str, Any]] = None


class MessageListResponse(BaseModel):
    items: List[MessageResponse]
    hasMore: bool