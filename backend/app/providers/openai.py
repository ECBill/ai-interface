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
