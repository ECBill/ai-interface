from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "AI Interface"
    database_url: str = "sqlite:///./data/app.db"
    app_encryption_key: str
    session_ttl_hours: int = 24
    cookie_secure: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
