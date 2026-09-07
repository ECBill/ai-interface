import json
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.auth import current_user
from app.core.database import get_db
from app.models.auth import User
from app.models.preference import UserPreference
from app.schemas.conversation import PreferenceResponse, PreferenceUpdate

router = APIRouter(prefix="/preferences", tags=["preferences"])


def preference_or_create(user_id: int, db: Session) -> UserPreference:
    row = db.get(UserPreference, user_id)
    if not row:
        row = UserPreference(user_id=user_id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def serialize_preference(row: UserPreference) -> dict[str, Any]:
    try:
        default_parameters = json.loads(row.default_parameters_json or "{}")
    except json.JSONDecodeError:
        default_parameters = {}
    try:
        ui_prefs = json.loads(row.ui_prefs_json or "{}")
    except json.JSONDecodeError:
        ui_prefs = {}
    return PreferenceResponse(
        lastProviderId=row.last_provider_id,
        lastModel=row.last_model,
        lastConversationId=row.last_conversation_id,
        defaultSystemPrompt=row.default_system_prompt,
        defaultParameters=default_parameters,
        streamByDefault=row.stream_by_default,
        showThinking=row.show_thinking,
        uiPrefs=ui_prefs,
    ).model_dump(mode="json")


@router.get("")
def get_preferences(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    return serialize_preference(preference_or_create(user.id, db))


@router.put("")
def update_preferences(payload: PreferenceUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    row = preference_or_create(user.id, db)
    data = payload.model_dump(exclude_unset=True)
    if "lastProviderId" in data:
        row.last_provider_id = data["lastProviderId"]
    if "lastModel" in data:
        row.last_model = data["lastModel"]
    if "lastConversationId" in data:
        row.last_conversation_id = data["lastConversationId"]
    if "defaultSystemPrompt" in data:
        row.default_system_prompt = data["defaultSystemPrompt"]
    if data.get("defaultParameters") is not None:
        row.default_parameters_json = json.dumps(data["defaultParameters"])
    if data.get("streamByDefault") is not None:
        row.stream_by_default = data["streamByDefault"]
    if data.get("showThinking") is not None:
        row.show_thinking = data["showThinking"]
    if data.get("uiPrefs") is not None:
        row.ui_prefs_json = json.dumps(data["uiPrefs"])
    db.commit()
    db.refresh(row)
    return serialize_preference(row)