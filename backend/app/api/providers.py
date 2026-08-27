import json
import time
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import current_user
from app.core.database import get_db
from app.core.secrets import decrypt_secret, encrypt_secret, fingerprint
from app.models.auth import User
from app.models.provider import ProviderCredential
from app.schemas.provider import CredentialRequest, ProviderStatus, ValidationRequest, ValidationResult

router = APIRouter(prefix="/providers", tags=["providers"])
SUPPORTED = {"openai", "anthropic"}
DEFAULT_URLS = {"openai": "https://api.openai.com/v1", "anthropic": "https://api.anthropic.com"}


def credential_or_none(provider_id: str, user_id: int, db: Session) -> Optional[ProviderCredential]:
    return db.scalar(select(ProviderCredential).where(ProviderCredential.provider_id == provider_id, ProviderCredential.owner_id == user_id, ProviderCredential.revoked_at.is_(None)))


@router.get("", response_model=dict[str, list[ProviderStatus]])
def list_providers(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, list[ProviderStatus]]:
    items = []
    provider_ids = set(SUPPORTED)
    provider_ids.update(row.provider_id for row in db.scalars(select(ProviderCredential).where(ProviderCredential.owner_id == user.id, ProviderCredential.revoked_at.is_(None))))
    for provider_id in sorted(provider_ids):
        credential = credential_or_none(provider_id, user.id, db)
        items.append(ProviderStatus(id=provider_id, configured=credential is not None, keyFingerprint=credential.key_fingerprint if credential else None, baseUrl=credential.base_url if credential else DEFAULT_URLS.get(provider_id), models=json.loads(credential.model_ids) if credential else []))
    return {"items": items}


@router.put("/{provider_id}/credentials", response_model=ProviderStatus)
def save_credentials(provider_id: str, payload: CredentialRequest, user: User = Depends(current_user), db: Session = Depends(get_db)) -> ProviderStatus:
    if provider_id not in SUPPORTED and not provider_id.startswith("custom-"):
        raise HTTPException(status_code=404, detail="不支持的供应商")
    api_key = payload.apiKey.strip()
    if not api_key:
        raise HTTPException(status_code=422, detail="API Key 不能为空")
    credential = credential_or_none(provider_id, user.id, db)
    base_url = str(payload.baseUrl).rstrip("/") if payload.baseUrl else DEFAULT_URLS.get(provider_id, "")
    model_ids = json.dumps(payload.models)
    if credential:
        credential.encrypted_api_key = encrypt_secret(api_key)
        credential.base_url = base_url
        credential.model_ids = model_ids
        credential.key_fingerprint = fingerprint(api_key)
        credential.updated_at = datetime.utcnow()
    else:
        credential = ProviderCredential(owner_id=user.id, provider_id=provider_id, encrypted_api_key=encrypt_secret(api_key), base_url=base_url, model_ids=model_ids, key_fingerprint=fingerprint(api_key))
        db.add(credential)
    db.commit()
    return ProviderStatus(id=provider_id, configured=True, keyFingerprint=credential.key_fingerprint, baseUrl=credential.base_url, models=json.loads(credential.model_ids))


@router.post("/{provider_id}/validate", response_model=ValidationResult)
def validate_provider(provider_id: str, payload: ValidationRequest, user: User = Depends(current_user), db: Session = Depends(get_db)) -> ValidationResult:
    credential = credential_or_none(provider_id, user.id, db)
    if not credential:
        raise HTTPException(status_code=409, detail="PROVIDER_NOT_CONFIGURED")
    models = json.loads(credential.model_ids)
    model = payload.model or (models[0] if models else None)
    if not model:
        raise HTTPException(status_code=422, detail="请先配置至少一个模型")
    api_key = decrypt_secret(credential.encrypted_api_key).strip()
    headers = {"Authorization": f"Bearer {api_key}"} if provider_id != "anthropic" else {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    endpoint = f"{credential.base_url}/v1/messages" if provider_id == "anthropic" else (f"{credential.base_url}/responses" if provider_id == "openai" else f"{credential.base_url}/chat/completions")
    request_body = {"model": model, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1, "stream": False} if provider_id.startswith("custom-") else {"model": model, "input": [{"role": "user", "content": "ping"}], "max_output_tokens": 1, "stream": False}
    started = time.perf_counter()
    try:
        with httpx.Client(timeout=httpx.Timeout(15, connect=5), trust_env=False) as client:
            response = client.post(endpoint, headers=headers, json=request_body)
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="PROVIDER_TIMEOUT") from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"供应商返回 HTTP {exc.response.status_code}: {exc.response.text[:300]}") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"供应商连接失败: {exc}") from exc
    return ValidationResult(providerId=provider_id, valid=True, latencyMs=int((time.perf_counter() - started) * 1000), message="连接验证成功", model=model)


@router.delete("/{provider_id}/credentials", status_code=status.HTTP_204_NO_CONTENT)
def revoke_credentials(provider_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    credential = credential_or_none(provider_id, user.id, db)
    if credential:
        credential.revoked_at = datetime.utcnow()
        db.commit()
