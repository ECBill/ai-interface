import os

os.environ.setdefault("APP_ENCRYPTION_KEY", "test-only-key-material-32-bytes!!")
os.environ.setdefault("DATABASE_URL", f"sqlite:////tmp/ai-interface-test-{os.getpid()}.db")
