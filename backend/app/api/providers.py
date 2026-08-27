import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import current_user
from app.core.database import get_db
from app.core.secrets import encrypt_secret, fingerprint
from app.models.auth import User
from app.models.provider import ProviderCredential
from app.schemas.provider import CredentialRequest, ProviderStatus

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


@router.delete("/{provider_id}/credentials", status_code=status.HTTP_204_NO_CONTENT)
def revoke_credentials(provider_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    credential = credential_or_none(provider_id, user.id, db)
    if credential:
        credential.revoked_at = datetime.utcnow()
        db.commit()
