from collections.abc import AsyncIterator
from typing import Any, Protocol

from app.schemas.invocation import InvocationRequest


class ProviderAdapter(Protocol):
    provider_id: str

    async def invoke(self, request: InvocationRequest, api_key: str, base_url: str) -> dict[str, Any]: ...
    async def stream(self, request: InvocationRequest, api_key: str, base_url: str) -> AsyncIterator[dict[str, Any]]: ...
