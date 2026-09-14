from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.auth import router as auth_router, session_cookie
from app.api.conversations import router as conversations_router
from app.api.health import router as health_router
from app.api.invocations import router as invocations_router
from app.api.preferences import router as preferences_router
from app.api.providers import router as providers_router
from app.core.config import settings
from app.core.database import init_db


class SessionRefreshMiddleware(BaseHTTPMiddleware):
    """Sliding renewal: if current_user extended the DB session, refresh the browser cookie max_age too."""

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        if getattr(request.state, "session_refreshed", False):
            token = request.cookies.get(session_cookie)
            if token:
                ttl_hours = settings.session_ttl_hours
                response.set_cookie(
                    session_cookie,
                    token,
                    httponly=True,
                    secure=settings.cookie_secure,
                    samesite="lax",
                    max_age=ttl_hours * 3600,
                )
        return response


def create_app() -> FastAPI:
    application = FastAPI(title="AI Interface", version="3.0.0")

    application.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.add_middleware(SessionRefreshMiddleware)

    # V3 API namespace — all routers under /api/v3
    application.include_router(health_router, prefix="/api/v3")
    application.include_router(auth_router, prefix="/api/v3")
    application.include_router(providers_router, prefix="/api/v3")
    application.include_router(invocations_router, prefix="/api/v3")
    application.include_router(conversations_router, prefix="/api/v3")
    application.include_router(preferences_router, prefix="/api/v3")

    # Keep V1 health endpoint alive for backward compatibility
    application.include_router(health_router, prefix="/api/v1")

    return application


app = create_app()
init_db()
