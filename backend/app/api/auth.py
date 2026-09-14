import hashlib
import secrets
from datetime import datetime, timedelta

from argon2 import PasswordHasher
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.auth import SessionRecord, User
from app.schemas.auth import Credentials, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])
password_hasher = PasswordHasher()
session_cookie = "ai_session"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(session_cookie)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录")
    record = db.scalar(select(SessionRecord).where(SessionRecord.token_hash == hash_token(token)))
    if not record or record.revoked_at or record.expires_at <= datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="会话已失效")
    # Sliding renewal: extend session if remaining lifetime < half of TTL
    remaining = record.expires_at - datetime.utcnow()
    ttl = timedelta(hours=settings.session_ttl_hours)
    if remaining < ttl / 2:
        record.expires_at = datetime.utcnow() + ttl
        db.commit()
        # Refresh cookie max_age on the response — we need a Response object.
        # Since current_user is a dependency, we set a request state flag
        # so middleware or the endpoint can refresh the cookie.
        request.state.session_refreshed = True
    return record.user


def set_session(response: Response, user: User, db: Session, remember_me: bool = False) -> None:
    token = secrets.token_urlsafe(32)
    ttl_hours = settings.remember_me_ttl_hours if remember_me else settings.session_ttl_hours
    record = SessionRecord(
        token_hash=hash_token(token),
        user_id=user.id,
        expires_at=datetime.utcnow() + timedelta(hours=ttl_hours),
    )
    db.add(record)
    db.commit()
    response.set_cookie(
        session_cookie,
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=ttl_hours * 3600,
    )


@router.post("/register", response_model=UserResponse, status_code=201)
def register(credentials: Credentials, response: Response, db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(User.id)) is not None:
        raise HTTPException(status_code=409, detail="该系统已注册用户，请直接登录")
    user = User(email=str(credentials.email).lower(), password_hash=password_hasher.hash(credentials.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    set_session(response, user, db, remember_me=credentials.rememberMe)
    return {"id": user.id, "email": user.email, "createdAt": user.created_at}


@router.post("/login", response_model=UserResponse)
def login(credentials: Credentials, response: Response, db: Session = Depends(get_db)) -> dict:
    user = db.scalar(select(User).where(User.email == str(credentials.email).lower()))
    if not user:
        raise HTTPException(status_code=401, detail="账号或密码错误")
    try:
        password_hasher.verify(user.password_hash, credentials.password)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="账号或密码错误") from exc
    set_session(response, user, db, remember_me=credentials.rememberMe)
    return {"id": user.id, "email": user.email, "createdAt": user.created_at}


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    token = request.cookies.get(session_cookie)
    if token:
        record = db.scalar(select(SessionRecord).where(SessionRecord.token_hash == hash_token(token)))
        if record:
            record.revoked_at = datetime.utcnow()
            db.commit()
    response.delete_cookie(session_cookie)


@router.get("/me")
def me(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """Return user info with session expiry time for frontend sliding renewal."""
    token = request.cookies.get(session_cookie)
    record = db.scalar(select(SessionRecord).where(SessionRecord.token_hash == hash_token(token))) if token else None
    expires_at = record.expires_at.isoformat() if record else None
    return {"id": user.id, "email": user.email, "createdAt": user.created_at, "expiresAt": expires_at}
