from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    rememberMe: bool = True

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not any(character.isalpha() for character in value) or not any(character.isdigit() for character in value):
            raise ValueError("密码必须包含至少一个字母和一个数字")
        return value


class UserResponse(BaseModel):
    id: int
    email: EmailStr
    createdAt: datetime
    expiresAt: Optional[str] = None
