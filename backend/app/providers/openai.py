from typing import Any

from app.schemas.invocation import InvocationRequest


def build_payload(request: InvocationRequest) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": request.model,
        "input": [message.model_dump() for message in request.messages],
        "max_output_tokens": request.parameters.maxTokens,
        "stream": request.stream,
    }
    if request.system:
        payload["instructions"] = request.system
    if request.parameters.temperature is not None:
        payload["temperature"] = request.parameters.temperature
    if request.parameters.topP is not None:
        payload["top_p"] = request.parameters.topP
    if request.parameters.stop:
        payload["stop"] = request.parameters.stop
    return payload


def extract_text(response: dict[str, Any]) -> str:
    return str(response.get("output_text", ""))


def build_chat_payload(request: InvocationRequest) -> dict[str, Any]:
    messages = [message.model_dump() for message in request.messages]
    if request.system:
        messages.insert(0, {"role": "system", "content": request.system})
    payload: dict[str, Any] = {
        "model": request.model,
        "messages": messages,
        "max_tokens": max(request.parameters.maxTokens, 4096),
        "stream": request.stream,
    }
    if request.parameters.temperature is not None:
        payload["temperature"] = request.parameters.temperature
    if request.parameters.topP is not None:
        payload["top_p"] = request.parameters.topP
    if request.parameters.stop:
        payload["stop"] = request.parameters.stop
    return payload


def extract_chat_text(response: dict[str, Any]) -> str:
    choices = response.get("choices") or []
    if not choices:
        return str(response.get("output_text") or response.get("content") or "")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content
    if isinstance(content, list):
        parts = [item.get("text", "") for item in content if isinstance(item, dict) and item.get("text")]
        if parts:
            return "".join(parts)
    reasoning = message.get("reasoning_content")
    if isinstance(reasoning, str) and reasoning.strip():
        return reasoning
    return str(content or "")
