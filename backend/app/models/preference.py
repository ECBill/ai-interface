from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UserPreference(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    last_provider_id: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    last_model: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    last_conversation_id: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    default_system_prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    default_parameters_json: Mapped[str] = mapped_column(Text, default="{}")
    stream_by_default: Mapped[bool] = mapped_column(default=True)
    show_thinking: Mapped[str] = mapped_column(String(16), default="collapsed")
    ui_prefs_json: Mapped[str] = mapped_column(Text, default="{}")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)