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
    return record.user


def set_session(response: Response, user: User, db: Session) -> None:
    token = secrets.token_urlsafe(32)
    record = SessionRecord(
        token_hash=hash_token(token),
        user_id=user.id,
        expires_at=datetime.utcnow() + timedelta(hours=settings.session_ttl_hours),
    )
    db.add(record)
    db.commit()
    response.set_cookie(session_cookie, token, httponly=True, secure=settings.cookie_secure, samesite="lax", max_age=settings.session_ttl_hours * 3600)


@router.post("/register", response_model=UserResponse, status_code=201)
def register(credentials: Credentials, response: Response, db: Session = Depends(get_db)) -> User:
    if db.scalar(select(User.id)) is not None:
        raise HTTPException(status_code=409, detail="REGISTRATION_CLOSED")
    user = User(email=str(credentials.email).lower(), password_hash=password_hasher.hash(credentials.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    set_session(response, user, db)
    return user


@router.post("/login", response_model=UserResponse)
def login(credentials: Credentials, response: Response, db: Session = Depends(get_db)) -> User:
    user = db.scalar(select(User).where(User.email == str(credentials.email).lower()))
    if not user:
        raise HTTPException(status_code=401, detail="账号或密码错误")
    try:
        password_hasher.verify(user.password_hash, credentials.password)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="账号或密码错误") from exc
    set_session(response, user, db)
    return user


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    token = request.cookies.get(session_cookie)
    if token:
        record = db.scalar(select(SessionRecord).where(SessionRecord.token_hash == hash_token(token)))
        if record:
            record.revoked_at = datetime.utcnow()
            db.commit()
    response.delete_cookie(session_cookie)


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(current_user)) -> User:
    return user
