from fastapi import FastAPI

from app.api.auth import router as auth_router
from app.api.health import router as health_router
from app.api.invocations import router as invocations_router
from app.api.providers import router as providers_router
from app.core.database import init_db


def create_app() -> FastAPI:
    application = FastAPI(title="AI Interface", version="0.1.0")
    application.include_router(health_router, prefix="/api/v1")
    application.include_router(auth_router, prefix="/api/v1")
    application.include_router(providers_router, prefix="/api/v1")
    application.include_router(invocations_router, prefix="/api/v1")
    return application


app = create_app()
init_db()
