from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config import get_settings

security = HTTPBearer(auto_error=False)
settings = get_settings()


def create_access_token(user_id: UUID, email: str, is_admin: bool = False, expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.jwt_expiration_minutes))
    payload = {
        "sub": str(user_id),
        "email": email,
        "is_admin": is_admin,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def verify_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    """Extract and validate user from auth. Checks token, then verifies
    user status in DB to block suspended/deleted users in real-time.
    """
    token = None

    if credentials and credentials.credentials:
        token = credentials.credentials
    elif request.cookies.get("access_token"):
        token = request.cookies["access_token"]
    elif request.query_params.get("token"):
        token = request.query_params["token"]

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = verify_token(token)

    # Real-time DB check: block suspended/deleted users immediately
    from shared.database import async_session
    from shared.models.user import User

    user_id = UUID(payload["sub"])
    async with async_session() as db:
        result = await db.execute(
            select(User.status, User.suspended_reason).where(User.id == user_id)
        )
        row = result.one_or_none()

        if not row:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

        if row.status == "deleted":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found")

        if row.status == "suspended":
            reason = row.suspended_reason or "Contact support"
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Account suspended: {reason}")

    return payload
