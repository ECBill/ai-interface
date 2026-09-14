from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# 项目根目录: backend/app/core/config.py → 上溯 4 层到 ai-interface/
_PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_name: str = "AI Interface"
    database_url: str = f"sqlite:///{_PROJECT_ROOT}/data/app.db"
    app_encryption_key: str = "dev-only-key-change-in-production-32b!"
    session_ttl_hours: int = 24
    remember_me_ttl_hours: int = 720  # 30 days
    cookie_secure: bool = False

    model_config = SettingsConfigDict(env_file=str(_PROJECT_ROOT / ".env"), extra="ignore")


settings = Settings()
