from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class Message(BaseModel):
    role: str
    content: str = Field(min_length=1, max_length=100_000)

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: str) -> str:
        if value not in {"user", "assistant"}:
            raise ValueError("role 只能是 user 或 assistant")
        return value


class GenerationParameters(BaseModel):
    temperature: Optional[float] = Field(default=None, ge=0, le=2)
    topP: Optional[float] = Field(default=None, ge=0, le=1)
    maxTokens: int = Field(default=1024, ge=1, le=32_768)
    stop: Optional[List[str]] = Field(default=None, max_length=4)
    providerOptions: dict = Field(default_factory=dict)


class InvocationRequest(BaseModel):
    providerId: str
    model: str = Field(min_length=1, max_length=128)
    system: Optional[str] = Field(default=None, max_length=20_000)
    messages: List[Message] = Field(min_length=1, max_length=100)
    stream: bool = False
    parameters: GenerationParameters = Field(default_factory=GenerationParameters)
    saveContent: bool = False

    @field_validator("providerId")
    @classmethod
    def validate_provider(cls, value: str) -> str:
        if value not in {"openai", "anthropic"}:
            raise ValueError("不支持的供应商")
        return value

    @field_validator("messages")
    @classmethod
    def require_user_message(cls, value: List[Message]) -> List[Message]:
        if not any(message.role == "user" for message in value):
            raise ValueError("messages 至少需要一条 user 消息")
        return value
