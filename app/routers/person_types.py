from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import AttendanceRule, PersonType, User
from app.schemas.people import PersonTypeCreate, PersonTypeOut, RuleOut, RuleUpdate
from app.security import require_role
from app.services.audit_service import add_audit

router = APIRouter(prefix="/api/v1", tags=["person types and rules"])

admin_only = require_role("ADMIN")


@router.get("/person-types", response_model=list[PersonTypeOut])
async def list_person_types(db: AsyncSession = Depends(get_db), _: User = Depends(admin_only)):
    return (await db.scalars(select(PersonType).order_by(PersonType.code))).all()


@router.post("/person-types", response_model=PersonTypeOut, status_code=status.HTTP_201_CREATED)
async def create_person_type(
    body: PersonTypeCreate, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(admin_only)
):
    """A new type is one row here plus one default row in attendance_rules."""
    code = body.code.upper()
    if await db.get(PersonType, code):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Person type already exists")
    ptype = PersonType(code=code, display_name=body.display_name)
    db.add(ptype)
    await db.flush()
    db.add(AttendanceRule(person_type=code))
    add_audit(db, actor_id=admin.id, action="CREATE", entity_type="person_type", entity_id=code,
              new_values={"display_name": body.display_name}, request=request)
    await db.commit()
    return ptype


@router.get("/attendance-rules/{person_type}", response_model=RuleOut)
async def get_rule(person_type: str, db: AsyncSession = Depends(get_db), _: User = Depends(admin_only)):
    rule = await db.get(AttendanceRule, person_type.upper())
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No rules for that person type")
    return rule


@router.put("/attendance-rules/{person_type}", response_model=RuleOut)
async def update_rule(
    person_type: str,
    body: RuleUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(admin_only),
):
    rule = await db.get(AttendanceRule, person_type.upper())
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No rules for that person type")
    def snapshot(window, auto_close, late_after) -> dict:
        return {"duplicate_window_seconds": window,
                "auto_close_time": str(auto_close) if auto_close else None,
                "late_after_time": str(late_after) if late_after else None}

    before = snapshot(rule.duplicate_window_seconds, rule.auto_close_time, rule.late_after_time)
    rule.duplicate_window_seconds = body.duplicate_window_seconds
    rule.auto_close_time = body.auto_close_time
    rule.late_after_time = body.late_after_time
    rule.updated_at = func.now()
    add_audit(db, actor_id=admin.id, action="UPDATE", entity_type="attendance_rule", entity_id=rule.person_type,
              old_values=before,
              new_values=snapshot(body.duplicate_window_seconds, body.auto_close_time, body.late_after_time),
              request=request)
    await db.commit()
    await db.refresh(rule)
    return rule
