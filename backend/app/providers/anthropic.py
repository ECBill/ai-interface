from typing import Any

from app.schemas.invocation import InvocationRequest


def build_payload(request: InvocationRequest) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": request.model,
        "messages": [message.model_dump() for message in request.messages],
        "max_tokens": request.parameters.maxTokens,
        "stream": request.stream,
    }
    if request.system:
        payload["system"] = request.system
    if request.parameters.temperature is not None and request.parameters.temperature <= 1:
        payload["temperature"] = request.parameters.temperature
    if request.parameters.topP is not None:
        payload["top_p"] = request.parameters.topP
    if request.parameters.stop:
        payload["stop_sequences"] = request.parameters.stop
    return payload


def extract_text(response: dict[str, Any]) -> str:
    return "".join(block.get("text", "") for block in response.get("content", []) if block.get("type") == "text")
