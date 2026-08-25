import time
import json
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.auth import current_user
from app.api.providers import credential_or_none
from app.core.database import get_db
from app.core.secrets import decrypt_secret
from app.models.auth import User
from app.models.invocation import Invocation
from app.providers.anthropic import build_payload as build_anthropic, extract_text as extract_anthropic
from app.providers.openai import build_payload as build_openai, extract_text as extract_openai
from app.schemas.invocation import InvocationRequest

router = APIRouter(prefix="/invocations", tags=["invocations"])


def sse(event_type: str, payload: dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("")
async def invoke(request: InvocationRequest, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    if request.stream:
        raise HTTPException(status_code=400, detail="流式请求请使用 /invocations/stream")
    credential = credential_or_none(request.providerId, user.id, db)
    if not credential:
        raise HTTPException(status_code=409, detail="PROVIDER_NOT_CONFIGURED")
    invocation = Invocation(owner_id=user.id, provider_id=request.providerId, model=request.model, stream=False)
    db.add(invocation)
    db.commit()
    started = time.perf_counter()
    try:
        api_key = decrypt_secret(credential.encrypted_api_key)
        headers = {"Authorization": f"Bearer {api_key}"} if request.providerId == "openai" else {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
        payload = build_openai(request) if request.providerId == "openai" else build_anthropic(request)
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=10)) as client:
            response = await client.post(f"{credential.base_url}/responses" if request.providerId == "openai" else f"{credential.base_url}/v1/messages", headers=headers, json=payload)
        response.raise_for_status()
        body = response.json()
        output_text = extract_openai(body) if request.providerId == "openai" else extract_anthropic(body)
        latency_ms = int((time.perf_counter() - started) * 1000)
        invocation.status = "succeeded"
        invocation.output_text = output_text if request.saveContent else None
        invocation.latency_ms = latency_ms
        db.commit()
        return {"invocationId": str(invocation.id), "providerId": request.providerId, "model": request.model, "outputText": output_text, "latencyMs": latency_ms}
    except httpx.TimeoutException as exc:
        invocation.status = "failed"
        invocation.error_code = "PROVIDER_TIMEOUT"
        db.commit()
        raise HTTPException(status_code=504, detail="PROVIDER_TIMEOUT") from exc
    except httpx.HTTPStatusError as exc:
        invocation.status = "failed"
        invocation.error_code = "PROVIDER_UNAVAILABLE"
        db.commit()
        raise HTTPException(status_code=502, detail="PROVIDER_UNAVAILABLE") from exc


@router.post("/stream")
async def stream(request: InvocationRequest, user: User = Depends(current_user), db: Session = Depends(get_db)) -> StreamingResponse:
    if not request.stream:
        request = request.model_copy(update={"stream": True})
    credential = credential_or_none(request.providerId, user.id, db)
    if not credential:
        raise HTTPException(status_code=409, detail="PROVIDER_NOT_CONFIGURED")
    api_key = decrypt_secret(credential.encrypted_api_key)
    headers = {"Authorization": f"Bearer {api_key}"} if request.providerId == "openai" else {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    payload = build_openai(request) if request.providerId == "openai" else build_anthropic(request)
    endpoint = f"{credential.base_url}/responses" if request.providerId == "openai" else f"{credential.base_url}/v1/messages"

    async def events() -> Any:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=10)) as client:
            try:
                async with client.stream("POST", endpoint, headers=headers, json=payload) as upstream:
                    upstream.raise_for_status()
                    async for line in upstream.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        raw = line[6:]
                        if raw == "[DONE]":
                            yield sse("done", {"type": "done"})
                            continue
                        try:
                            body = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        if request.providerId == "openai" and body.get("type") == "response.output_text.delta":
                            yield sse("delta", {"type": "delta", "text": body.get("delta", "")})
                        elif request.providerId == "anthropic" and body.get("type") == "content_block_delta" and body.get("delta", {}).get("type") == "text_delta":
                            yield sse("delta", {"type": "delta", "text": body["delta"].get("text", "")})
                        elif body.get("type") in {"response.completed", "message_stop"}:
                            yield sse("done", {"type": "done"})
            except httpx.HTTPError:
                yield sse("error", {"type": "error", "code": "PROVIDER_UNAVAILABLE", "message": "供应商连接失败"})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
