import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Person, PersonType, User
from app.schemas.people import PersonCreate, PersonOut, PersonUpdate, PersonWithQr
from app.security import require_role
from app.services import qr_service
from app.services.audit_service import add_audit

router = APIRouter(prefix="/api/v1/people", tags=["people"])

admin_only = require_role("ADMIN")


def _snapshot(p: Person) -> dict:
    return {
        "person_type": p.person_type, "external_code": p.external_code, "first_name": p.first_name,
        "last_name": p.last_name, "email": p.email, "group_name": p.group_name,
        "attributes": p.attributes, "is_active": p.is_active,
    }


async def _with_qr(person: Person, token: str) -> PersonWithQr:
    await qr_service.remember_fresh_token(person.id, token)
    return PersonWithQr(
        **PersonOut.model_validate(person).model_dump(),
        qr_token=token,
        qr_image=qr_service.qr_png_data_uri(token),
    )


async def _get_or_404(db: AsyncSession, person_id: uuid.UUID) -> Person:
    person = await db.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person not found")
    return person


@router.get("", response_model=list[PersonOut])
async def list_people(
    q: str | None = Query(None, description="Search name, external code or email"),
    type: str | None = None,
    group: str | None = None,
    active: bool | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_only),
):
    stmt = select(Person).order_by(Person.last_name, Person.first_name).limit(limit).offset(offset)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Person.first_name.ilike(like), Person.last_name.ilike(like),
                              Person.external_code.ilike(like), Person.email.ilike(like)))
    if type:
        stmt = stmt.where(Person.person_type == type.upper())
    if group:
        stmt = stmt.where(Person.group_name == group)
    if active is not None:
        stmt = stmt.where(Person.is_active.is_(active))
    return (await db.scalars(stmt)).all()


@router.post("", response_model=PersonWithQr, status_code=status.HTTP_201_CREATED)
async def create_person(
    body: PersonCreate, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(admin_only)
):
    ptype = await db.get(PersonType, body.person_type.upper())
    if ptype is None or not ptype.is_active:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown or inactive person type")

    token = qr_service.new_qr_token()
    person = Person(
        person_type=ptype.code,
        external_code=body.external_code,
        first_name=body.first_name,
        last_name=body.last_name,
        email=body.email,
        group_name=body.group_name,
        attributes=body.attributes,
        qr_token_hash=qr_service.hash_token(token),
    )
    db.add(person)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A person of this type with that external code already exists"
        ) from None
    add_audit(db, actor_id=admin.id, action="CREATE", entity_type="person", entity_id=person.id,
              new_values=_snapshot(person), request=request)
    await db.commit()
    await db.refresh(person)
    return await _with_qr(person, token)


@router.get("/{person_id}", response_model=PersonOut)
async def get_person(person_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(admin_only)):
    return await _get_or_404(db, person_id)


@router.get("/{person_id}/qr", responses={200: {"content": {"image/png": {}}}})
async def get_qr_image(person_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(admin_only)):
    """Printable QR image (PNG) for a freshly issued token. Raw tokens are not stored, so this only works
    for a short time after the person is created or the QR is rotated."""
    await _get_or_404(db, person_id)
    token = await qr_service.recall_fresh_token(person_id)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="QR image no longer available; rotate the QR to issue a new one",
        )
    return Response(content=qr_service.qr_png_bytes(token), media_type="image/png")


@router.patch("/{person_id}", response_model=PersonOut)
async def update_person(
    person_id: uuid.UUID,
    body: PersonUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(admin_only),
):
    person = await _get_or_404(db, person_id)
    before = _snapshot(person)
    nullable = {"email", "group_name"}
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is None and field not in nullable:
            continue  # required columns cannot be cleared
        setattr(person, field, value)
    add_audit(db, actor_id=admin.id, action="UPDATE", entity_type="person", entity_id=person.id,
              old_values=before, new_values=_snapshot(person), request=request)
    await db.commit()
    await db.refresh(person)
    return person


@router.post("/{person_id}/qr/rotate", response_model=PersonWithQr)
async def rotate_qr(
    person_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(admin_only)
):
    """Issue a new QR token. The old token stops working immediately (its hash is replaced)."""
    person = await _get_or_404(db, person_id)
    token = qr_service.new_qr_token()
    person.qr_token_hash = qr_service.hash_token(token)
    person.qr_version += 1
    person.qr_issued_at = func.now()
    person.qr_revoked_at = None
    add_audit(db, actor_id=admin.id, action="QR_ROTATE", entity_type="person", entity_id=person.id,
              new_values={"qr_version": person.qr_version}, request=request)
    await db.commit()
    await db.refresh(person)
    return await _with_qr(person, token)
