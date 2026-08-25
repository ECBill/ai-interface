from app.providers.anthropic import build_payload as build_anthropic
from app.providers.anthropic import extract_text as extract_anthropic
from app.providers.openai import build_payload as build_openai
from app.providers.openai import extract_text as extract_openai
from app.schemas.invocation import InvocationRequest


def request() -> InvocationRequest:
    return InvocationRequest(
        providerId="openai",
        model="test-model",
        system="Be concise",
        messages=[{"role": "user", "content": "Hello"}],
        parameters={"temperature": 0.5, "topP": 0.9, "maxTokens": 200, "stop": ["END"]},
    )


def test_openai_responses_mapping() -> None:
    payload = build_openai(request())
    assert payload["instructions"] == "Be concise"
    assert payload["max_output_tokens"] == 200
    assert payload["top_p"] == 0.9
    assert extract_openai({"output_text": "Hello"}) == "Hello"


def test_anthropic_messages_mapping() -> None:
    invocation = request().model_copy(update={"providerId": "anthropic"})
    payload = build_anthropic(invocation)
    assert payload["system"] == "Be concise"
    assert payload["max_tokens"] == 200
    assert payload["stop_sequences"] == ["END"]
    assert extract_anthropic({"content": [{"type": "text", "text": "Hi"}]}) == "Hi"
