import os
import tempfile

import pytest

# Use a unique temp database per test session
_db_path = tempfile.mktemp(suffix=".db", prefix="ai-interface-test-")
os.environ.setdefault("APP_ENCRYPTION_KEY", "test-only-key-material-32-bytes!!")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_db_path}")


@pytest.fixture(autouse=True)
def reset_database():
    """Drop and recreate all tables before each test for isolation."""
    from app.core.database import Base, engine, init_db

    Base.metadata.drop_all(bind=engine)
    init_db()
    yield
