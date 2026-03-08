from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class UserResponse(BaseModel):
    id: UUID
    email: str
    name: str
    avatar_url: Optional[str] = None
    timezone: str = "UTC"
    preferred_language: str = "en"
    auth_provider: str
    email_verified: bool = False
    credit_balance: int = 0
    lifetime_credits: int = 0
    is_admin: bool = False
    status: str = "active"
    suspended_reason: Optional[str] = None
    is_active: bool = True
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SignupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class LoginEmailRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    code: str
    redirect_uri: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse


class OAuthCallbackRequest(BaseModel):
    code: str
    redirect_uri: str
    state: Optional[str] = None


class DeviceLoginRequest(BaseModel):
    device_name: str = "Desktop Agent"
