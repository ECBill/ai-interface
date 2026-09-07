import json
import time
from datetime import datetime
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import current_user
from app.api.providers import credential_or_none
from app.core.database import get_db
from app.core.secrets import decrypt_secret
from app.models.auth import User
from app.models.conversation import ChatMessage, Conversation
from app.models.invocation import Invocation
from app.models.preference import UserPreference
from app.providers.anthropic import build_payload as build_anthropic
from app.providers.anthropic import extract_text as extract_anthropic
from app.providers.openai import build_chat_payload, build_payload as build_openai
from app.providers.openai import extract_chat_text, extract_text as extract_openai
from app.schemas.conversation import (
    ConversationCreate,
    ConversationSettings,
    MessageEditRequest,
    SendMessageRequest,
    serialize_conversation_detail,
    serialize_conversation_summary,
    serialize_message,
)
from app.schemas.invocation import GenerationParameters, InvocationRequest
from app.services import conversation_service as service

router = APIRouter(prefix="/conversations", tags=["conversations"])

THROTTLE_SECONDS = 1.0
UPSTREAM_TIMEOUT = httpx.Timeout(180, connect=10)


def preference_or_create(user_id: int, db: Session) -> UserPreference:
    row = db.get(UserPreference, user_id)
    if not row:
        row = UserPreference(user_id=user_id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def load_conversation(conversation_id: str, user: User, db: Session) -> Conversation:
    conversation = service.conversation_or_none(conversation_id, user.id, db)
    if not conversation:
        raise HTTPException(status_code=404, detail="CONVERSATION_NOT_FOUND")
    return conversation


def sse(event_type: str, payload: dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def sse_error(code: str, message: str) -> str:
    return sse("error", {"type": "error", "code": code, "message": message, "retryable": True})


@router.get("")
def list_conversations(limit: int = 50, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = db.scalars(
        select(Conversation)
        .where(Conversation.owner_id == user.id, Conversation.deleted_at.is_(None))
        .order_by(Conversation.last_message_at.desc())
        .limit(min(max(limit, 1), 100))
    ).all()
    items = [serialize_conversation_summary(row).model_dump(mode="json") for row in rows]
    return {"items": items, "nextCursor": None}


@router.post("", status_code=201)
def create_conversation(payload: ConversationCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    conversation = service.create_conversation(user.id, payload, db)
    preference = preference_or_create(user.id, db)
    preference.last_conversation_id = conversation.id
    db.commit()
    return serialize_conversation_detail(conversation).model_dump(mode="json")


@router.get("/{conversation_id}")
def get_conversation(conversation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    conversation = load_conversation(conversation_id, user, db)
    return serialize_conversation_detail(conversation).model_dump(mode="json")


@router.patch("/{conversation_id}")
def patch_conversation(conversation_id: str, payload: ConversationSettings, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    conversation = load_conversation(conversation_id, user, db)
    service.apply_conversation_update(conversation, payload)
    db.commit()
    db.refresh(conversation)
    return serialize_conversation_detail(conversation).model_dump(mode="json")


@router.delete("/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    conversation = load_conversation(conversation_id, user, db)
    conversation.deleted_at = datetime.utcnow()
    db.commit()


@router.get("/{conversation_id}/messages")
def list_messages(conversation_id: str, before: Optional[str] = None, limit: int = 50, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    conversation = load_conversation(conversation_id, user, db)
    query = select(ChatMessage).where(ChatMessage.conversation_id == conversation.id)
    if before:
        anchor = db.get(ChatMessage, before)
        if anchor:
            query = query.where(ChatMessage.seq < anchor.seq)
    query = query.order_by(ChatMessage.seq.desc()).limit(min(max(limit, 1), 100) + 1)
    rows = list(db.scalars(query).all())
    has_more = len(rows) > min(max(limit, 1), 100)
    rows = rows[: min(max(limit, 1), 100)]
    rows.reverse()
    items = [serialize_message(row).model_dump(mode="json") for row in rows]
    return {"items": items, "hasMore": has_more}


def _resolve_generation_settings(
    conversation: Conversation,
    payload_provider: Optional[str],
    payload_model: Optional[str],
    payload_system: Optional[str],
    payload_parameters: Optional[GenerationParameters],
    preference: UserPreference,
    db: Session,
) -> tuple[str, str, Optional[str], GenerationParameters]:
    preference_system = preference.default_system_prompt
    system = service.resolve_system(payload_system, conversation, preference_system)
    provider_id = payload_provider or (conversation.provider_id or preference.last_provider_id or "openai")
    model = payload_model or (conversation.model or preference.last_model or ("gpt-4.1-mini" if provider_id == "openai" else "claude-sonnet-4-5"))
    if payload_parameters is not None:
        parameters = payload_parameters
    else:
        try:
            stored = json.loads(conversation.parameters_json or "{}")
        except json.JSONDecodeError:
            stored = {}
        if stored:
            parameters = GenerationParameters(**{k: v for k, v in stored.items() if k in set(GenerationParameters.model_fields.keys())})
        else:
            parameters = GenerationParameters()
    if payload_provider is not None and payload_provider != conversation.provider_id:
        conversation.provider_id = payload_provider
    if payload_model is not None and payload_model != conversation.model:
        conversation.model = payload_model
    return provider_id, model, system, parameters


async def _generate_stream(
    db: Session,
    conversation: Conversation,
    assistant: ChatMessage,
    invocation: Invocation,
    context_messages: list,
    system: Optional[str],
    parameters: GenerationParameters,
    provider_id: str,
    model: str,
    credential,
    warnings: list,
):
    """执行上游流式调用，产生 V3 事件并节流落库。"""
    api_key = decrypt_secret(credential.encrypted_api_key).strip()
    headers = {"Authorization": f"Bearer {api_key}"} if provider_id != "anthropic" else {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    request = InvocationRequest(
        providerId=provider_id,
        model=model,
        system=system,
        messages=[{"role": m.role, "content": m.content} for m in context_messages],  # type: ignore[arg-type]
        parameters=parameters,
        stream=True,
    )
    payload = build_anthropic(request) if provider_id == "anthropic" else (build_openai(request) if provider_id == "openai" else build_chat_payload(request))
    endpoint = f"{credential.base_url}/v1/messages" if provider_id == "anthropic" else (f"{credential.base_url}/responses" if provider_id == "openai" else f"{credential.base_url}/chat/completions")

    started = time.perf_counter()
    first_token_at: Optional[float] = None
    last_flush = started
    answer = ""
    thinking = ""
    status_value = "connecting"

    for warning in warnings:
        yield sse("warning", {"type": "warning", "message": warning})

    yield sse("start", {"type": "start", "invocationId": str(invocation.id), "messageId": assistant.id, "model": model, "providerId": provider_id})

    try:
        async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT, trust_env=False) as client:
            async with client.stream("POST", endpoint, headers=headers, json=payload) as upstream:
                if upstream.status_code >= 400:
                    detail = (await upstream.aread()).decode(errors="replace").strip().replace("\n", " ")[:500]
                    assistant.status = "failed"
                    assistant.error_code = f"UPSTREAM_{upstream.status_code}"
                    invocation.status = "failed"
                    invocation.error_code = assistant.error_code
                    db.commit()
                    yield sse_error(assistant.error_code, f"供应商返回 HTTP {upstream.status_code}: {detail or '无错误详情'}")
                    return
                async for line in upstream.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    raw = line[6:]
                    if raw == "[DONE]":
                        break
                    try:
                        body = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    delta_text = ""
                    delta_reasoning = ""
                    if provider_id == "openai" and body.get("type") == "response.output_text.delta":
                        delta_text = body.get("delta", "")
                    elif provider_id == "openai" and body.get("type") == "response.completed":
                        usage = body.get("response", {}).get("usage") or {}
                        assistant.input_tokens = usage.get("input_tokens")
                        assistant.output_tokens = usage.get("output_tokens")
                        assistant.total_tokens = (usage.get("total_tokens") if usage.get("total_tokens") else (usage.get("input_tokens") or 0) + (usage.get("output_tokens") or 0))
                        break
                    elif provider_id == "anthropic" and body.get("type") == "content_block_delta":
                        if body.get("delta", {}).get("type") == "text_delta":
                            delta_text = body["delta"].get("text", "")
                        elif body.get("delta", {}).get("type") == "thinking_delta":
                            delta_reasoning = body["delta"].get("thinking", "")
                    elif provider_id == "anthropic" and body.get("type") == "message_delta":
                        usage = body.get("usage") or {}
                        if usage.get("output_tokens"):
                            assistant.output_tokens = usage.get("output_tokens")
                            assistant.total_tokens = (assistant.input_tokens or 0) + (usage.get("output_tokens") or 0)
                    elif provider_id == "anthropic" and body.get("type") == "message_start":
                        usage = (body.get("message") or {}).get("usage") or {}
                        if usage.get("input_tokens"):
                            assistant.input_tokens = usage.get("input_tokens")
                    elif provider_id == "anthropic" and body.get("type") == "message_stop":
                        break
                    elif provider_id.startswith("custom-"):
                        delta = body.get("choices", [{}])[0].get("delta", {}) or {}
                        delta_reasoning = delta.get("reasoning_content") or ""
                        delta_text = delta.get("content") or ""
                        usage = body.get("usage") or {}
                        if usage:
                            assistant.input_tokens = usage.get("prompt_tokens", assistant.input_tokens)
                            assistant.output_tokens = usage.get("completion_tokens", assistant.output_tokens)
                            assistant.total_tokens = usage.get("total_tokens") or ((assistant.input_tokens or 0) + (assistant.output_tokens or 0))

                    if delta_reasoning:
                        if status_value != "thinking":
                            status_value = "thinking"
                            assistant.status = "streaming"
                            yield sse("status", {"type": "status", "messageId": assistant.id, "value": "thinking"})
                        thinking += delta_reasoning
                        yield sse("reasoning_delta", {"type": "reasoning_delta", "messageId": assistant.id, "text": delta_reasoning})
                    if delta_text:
                        if status_value != "answering":
                            status_value = "answering"
                            assistant.status = "streaming"
                            yield sse("status", {"type": "status", "messageId": assistant.id, "value": "answering"})
                        if first_token_at is None:
                            first_token_at = time.perf_counter()
                        answer += delta_text
                        yield sse("answer_delta", {"type": "answer_delta", "messageId": assistant.id, "text": delta_text})

                    now = time.perf_counter()
                    if now - last_flush >= THROTTLE_SECONDS or len(answer) - len(assistant.content or "") >= 2048:
                        assistant.content = answer
                        assistant.thinking = thinking or None
                        db.commit()
                        last_flush = now
    except httpx.RequestError as exc:
        assistant.status = "failed"
        assistant.error_code = "PROVIDER_CONNECTION_FAILED"
        assistant.content = answer
        invocation.status = "failed"
        invocation.error_code = "PROVIDER_CONNECTION_FAILED"
        db.commit()
        yield sse_error("PROVIDER_CONNECTION_FAILED", f"供应商连接失败: {exc}")
        return

    latency_ms = int((time.perf_counter() - started) * 1000)
    first_token_ms = int((first_token_at - started) * 1000) if first_token_at is not None else None
    assistant.content = answer
    assistant.thinking = thinking or None
    assistant.status = "succeeded"
    assistant.latency_ms = latency_ms
    assistant.first_token_ms = first_token_ms
    assistant.finish_reason = "stop"
    invocation.status = "succeeded"
    invocation.output_text = answer
    invocation.latency_ms = latency_ms
    invocation.completed_at = datetime.utcnow()
    db.commit()
    if assistant.input_tokens is not None or assistant.output_tokens is not None:
        yield sse("usage", {"type": "usage", "messageId": assistant.id, "inputTokens": assistant.input_tokens, "outputTokens": assistant.output_tokens, "totalTokens": assistant.total_tokens})
    yield sse("done", {"type": "done", "messageId": assistant.id, "finishReason": "stop", "latencyMs": latency_ms, "firstTokenMs": first_token_ms})


async def _run_and_generate(
    db: Session,
    user: User,
    conversation: Conversation,
    context_messages: list,
    system: Optional[str],
    parameters: GenerationParameters,
    provider_id: str,
    model: str,
    warnings: list,
):
    credential = credential_or_none(provider_id, user.id, db)
    if not credential:
        yield sse_error("PROVIDER_NOT_CONFIGURED", "供应商未配置，请先在供应商设置中保存 API Key")
        return
    seq = service.get_next_seq(db, conversation.id)
    invocation = Invocation(owner_id=user.id, provider_id=provider_id, model=model, stream=True)
    db.add(invocation)
    db.commit()
    db.refresh(invocation)
    assistant = ChatMessage(
        conversation_id=conversation.id,
        seq=seq,
        role="assistant",
        content="",
        status="sending",
        provider_id=provider_id,
        model=model,
        invocation_id=invocation.id,
    )
    db.add(assistant)
    db.commit()
    db.refresh(assistant)
    async for event in _generate_stream(db, conversation, assistant, invocation, context_messages, system, parameters, provider_id, model, credential, warnings):
        yield event


@router.post("/{conversation_id}/messages")
async def send_message(conversation_id: str, payload: SendMessageRequest, user: User = Depends(current_user), db: Session = Depends(get_db)) -> StreamingResponse:
    conversation = load_conversation(conversation_id, user, db)
    preference = preference_or_create(user.id, db)
    provider_id, model, system, parameters = _resolve_generation_settings(conversation, payload.providerId, payload.model, payload.system, payload.parameters, preference, db)

    user_message = ChatMessage(conversation_id=conversation.id, seq=service.get_next_seq(db, conversation.id), role="user", content=payload.content.strip(), status="succeeded")
    db.add(user_message)
    service.touch_conversation(conversation, payload.content.strip(), db)
    preference.last_provider_id = provider_id
    preference.last_model = model
    preference.last_conversation_id = conversation.id
    db.commit()
    db.refresh(user_message)

    context_messages, warnings = service.build_context(db, conversation)

    async def events():
        yield sse("user_message", {"type": "user_message", "message": serialize_message(user_message).model_dump(mode="json")})
        if not payload.stream:
            yield sse_error("STREAM_REQUIRED", "请使用流式模式发送消息")
            return
        async for event in _run_and_generate(db, user, conversation, context_messages, system, parameters, provider_id, model, warnings):
            yield event

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/{conversation_id}/messages/{message_id}/regenerate")
async def regenerate_message(conversation_id: str, message_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> StreamingResponse:
    conversation = load_conversation(conversation_id, user, db)
    preference = preference_or_create(user.id, db)
    target = db.scalar(select(ChatMessage).where(ChatMessage.id == message_id, ChatMessage.conversation_id == conversation.id))
    if not target:
        raise HTTPException(status_code=404, detail="MESSAGE_NOT_FOUND")
    if target.role != "assistant":
        raise HTTPException(status_code=409, detail="MESSAGE_NOT_EDITABLE")
    provider_id = target.provider_id or conversation.provider_id or preference.last_provider_id or "openai"
    model = target.model or conversation.model or preference.last_model or ("gpt-4.1-mini" if provider_id == "openai" else "claude-sonnet-4-5")
    system = service.resolve_system(None, conversation, preference.default_system_prompt)
    parameters = GenerationParameters()
    target.superseded_by = "pending"
    db.commit()
    context_messages, warnings = service.build_context(db, conversation)

    async def events():
        async for event in _run_and_generate(db, user, conversation, context_messages, system, parameters, provider_id, model, warnings):
            yield event
        target.superseded_by = "regenerated"
        db.commit()

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.put("/{conversation_id}/messages/{message_id}")
async def edit_message(conversation_id: str, message_id: str, payload: MessageEditRequest, user: User = Depends(current_user), db: Session = Depends(get_db)) -> StreamingResponse:
    conversation = load_conversation(conversation_id, user, db)
    preference = preference_or_create(user.id, db)
    target = db.scalar(select(ChatMessage).where(ChatMessage.id == message_id, ChatMessage.conversation_id == conversation.id))
    if not target:
        raise HTTPException(status_code=404, detail="MESSAGE_NOT_FOUND")
    if target.role != "user":
        raise HTTPException(status_code=409, detail="MESSAGE_NOT_EDITABLE")
    provider_id, model, system, parameters = _resolve_generation_settings(conversation, None, None, None, None, preference, db)
    later_rows = db.scalars(select(ChatMessage).where(ChatMessage.conversation_id == conversation.id, ChatMessage.seq > target.seq)).all()
    for row in later_rows:
        row.superseded_by = "superseded"
    target.content = payload.content.strip()
    target.edited_at = datetime.utcnow()
    db.commit()
    context_messages, warnings = service.build_context(db, conversation)

    async def events():
        async for event in _run_and_generate(db, user, conversation, context_messages, system, parameters, provider_id, model, warnings):
            yield event

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.delete("/{conversation_id}/messages/{message_id}", status_code=204)
def delete_message(conversation_id: str, message_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    conversation = load_conversation(conversation_id, user, db)
    target = db.scalar(select(ChatMessage).where(ChatMessage.id == message_id, ChatMessage.conversation_id == conversation.id))
    if not target:
        raise HTTPException(status_code=404, detail="MESSAGE_NOT_FOUND")
    target.superseded_by = "deleted"
    db.commit()