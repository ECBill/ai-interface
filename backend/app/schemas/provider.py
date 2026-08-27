from pydantic import BaseModel, Field, HttpUrl
from typing import List, Optional


class CredentialRequest(BaseModel):
    apiKey: str = Field(min_length=1, max_length=512)
    baseUrl: Optional[HttpUrl] = None
    models: List[str] = Field(default_factory=list, max_length=20)


class ProviderStatus(BaseModel):
    id: str
    configured: bool
    keyFingerprint: Optional[str] = None
    baseUrl: Optional[str] = None
    models: List[str] = Field(default_factory=list)
