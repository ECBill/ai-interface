from pydantic import BaseModel, Field, HttpUrl
from typing import Optional


class CredentialRequest(BaseModel):
    apiKey: str = Field(min_length=1, max_length=512)
    baseUrl: Optional[HttpUrl] = None


class ProviderStatus(BaseModel):
    id: str
    configured: bool
    keyFingerprint: Optional[str] = None
    baseUrl: Optional[str] = None
