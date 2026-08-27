from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db() -> Generator[Session, None, None]:
    database = SessionLocal()
    try:
        yield database
    finally:
        database.close()


def init_db() -> None:
    if settings.database_url.startswith("sqlite"):
        Path("data").mkdir(exist_ok=True)
    Base.metadata.create_all(bind=engine)
    if "model_ids" not in {column["name"] for column in inspect(engine).get_columns("provider_credentials")}:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE provider_credentials ADD COLUMN model_ids TEXT DEFAULT '[]'"))
