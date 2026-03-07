"""Credit system — atomic deduction, balance checks, and usage logging.

All AI operations go through check_and_deduct_credits() before execution.
"""

import logging
from uuid import UUID
from typing import Optional

from sqlalchemy import text, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.user import User
from shared.models.credit_transaction import CreditTransaction
from shared.models.api_usage import ApiUsageLog

logger = logging.getLogger(__name__)

SIGNUP_BONUS = 1000

# Credit costs per operation
CREDIT_COSTS = {
    "transcription_minute": 10,
    "note_generation": 30,
    "embedding_generation": 5,
    "rag_query": 10,
    "pre_meeting_brief": 20,
}


class InsufficientCreditsError(Exception):
    def __init__(self, required: int, available: int):
        self.required = required
        self.available = available
        super().__init__(f"Insufficient credits: need {required}, have {available}")


async def get_balance(db: AsyncSession, user_id: UUID) -> int:
    result = await db.execute(select(User.credit_balance).where(User.id == user_id))
    balance = result.scalar_one_or_none()
    return balance if balance is not None else 0


async def check_and_deduct_credits(
    db: AsyncSession,
    user_id: UUID,
    cost: int,
    operation: str,
    provider: str,
    meeting_id: Optional[UUID] = None,
    description: Optional[str] = None,
    tokens_used: int = 0,
    duration_ms: int = 0,
    metadata: Optional[dict] = None,
) -> int:
    """Atomically check and deduct credits. Returns new balance.

    Raises InsufficientCreditsError if balance is too low.
    Writes both a credit_transaction and an api_usage_log entry.
    """
    # Atomic deduction — only succeeds if balance >= cost
    result = await db.execute(
        text(
            "UPDATE users SET credit_balance = credit_balance - :cost "
            "WHERE id = :user_id AND credit_balance >= :cost "
            "RETURNING credit_balance"
        ),
        {"cost": cost, "user_id": str(user_id)},
    )
    row = result.fetchone()

    if row is None:
        balance = await get_balance(db, user_id)
        raise InsufficientCreditsError(required=cost, available=balance)

    new_balance = row[0]

    tx = CreditTransaction(
        user_id=user_id,
        amount=-cost,
        balance_after=new_balance,
        type="usage",
        description=description or f"{operation} ({provider})",
        meeting_id=meeting_id,
    )
    db.add(tx)

    usage = ApiUsageLog(
        user_id=user_id,
        meeting_id=meeting_id,
        operation=operation,
        provider=provider,
        credits_used=cost,
        tokens_used=tokens_used,
        duration_ms=duration_ms,
        metadata_json=metadata,
    )
    db.add(usage)

    await db.flush()
    return new_balance


async def add_credits(
    db: AsyncSession,
    user_id: UUID,
    amount: int,
    tx_type: str = "admin_grant",
    description: Optional[str] = None,
    stripe_payment_id: Optional[str] = None,
) -> int:
    """Add credits to a user's balance. Returns new balance."""
    result = await db.execute(
        text(
            "UPDATE users SET credit_balance = credit_balance + :amount, "
            "lifetime_credits = lifetime_credits + :amount "
            "WHERE id = :user_id "
            "RETURNING credit_balance"
        ),
        {"amount": amount, "user_id": str(user_id)},
    )
    row = result.fetchone()
    if row is None:
        raise ValueError(f"User {user_id} not found")

    new_balance = row[0]

    tx = CreditTransaction(
        user_id=user_id,
        amount=amount,
        balance_after=new_balance,
        type=tx_type,
        description=description or f"{tx_type}: +{amount} credits",
        stripe_payment_id=stripe_payment_id,
    )
    db.add(tx)
    await db.flush()
    return new_balance
