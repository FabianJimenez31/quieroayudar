from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import secrets
import uuid

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import case, inspect, select, text
from sqlalchemy.orm import Session

from .config import get_settings
from .database import Base, engine, get_db
from .models import Center, FieldReport, Need, Pledge, VolunteerRequest, utcnow
from .schemas import ActionPayload, CenterCreate, CenterUpdate, CoordinationPayload, clean_text
from .serializers import center_json, need_json, report_json, volunteer_json


settings = get_settings()


def migrate_centers_provenance() -> None:
    """Keep the self-hosted schema compatible without a migration service."""
    columns = {column["name"] for column in inspect(engine).get_columns("centers")}
    statements = {
        "source_name": "ALTER TABLE centers ADD COLUMN source_name VARCHAR(120) NOT NULL DEFAULT '' AFTER hours",
        "source_url": "ALTER TABLE centers ADD COLUMN source_url VARCHAR(500) NOT NULL DEFAULT '' AFTER source_name",
        "verified_at": "ALTER TABLE centers ADD COLUMN verified_at DATETIME NULL AFTER source_url",
        "volunteers_saturated": "ALTER TABLE centers ADD COLUMN volunteers_saturated TINYINT(1) NOT NULL DEFAULT 0 AFTER status",
        "location_precision": "ALTER TABLE centers ADD COLUMN location_precision VARCHAR(12) NOT NULL DEFAULT 'exact' AFTER longitude",
    }
    with engine.begin() as connection:
        for column, statement in statements.items():
            if column not in columns:
                connection.execute(text(statement))


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    migrate_centers_provenance()
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    docs_url="/docs",
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "X-Coordinator-Code"],
    max_age=86400,
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/v1/") else "no-cache"
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, __: RequestValidationError):
    return JSONResponse({"error": "Revisa los datos enviados."}, status_code=422)


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse({"error": str(exc.detail)}, status_code=exc.status_code)


def coordinator_ok(code: str | None) -> bool:
    """Publicar es anónimo; solo lo destructivo pide clave."""
    expected = settings.coordinator_code.strip()
    if not expected or not code:
        return False
    return secrets.compare_digest(code.strip(), expected)


def assert_coordinator(code: str | None) -> None:
    if not settings.coordinator_code.strip():
        # Falla cerrado: sin clave configurada no se permite destruir nada.
        raise HTTPException(status_code=503, detail="Falta configurar COORDINATOR_CODE.")
    if not coordinator_ok(code):
        raise HTTPException(status_code=401, detail="Clave de coordinación inválida.")


def clean_expired_pledges(db: Session) -> None:
    expired = list(
        db.scalars(
            select(Pledge)
            .where(Pledge.expires_at < utcnow())
            .limit(100)
            .with_for_update()
        )
    )
    if not expired:
        return
    for pledge in expired:
        need = db.scalar(select(Need).where(Need.id == pledge.need_id).with_for_update())
        if need:
            need.committed = max(0, need.committed - pledge.quantity)
            need.updated_at = utcnow()
        db.delete(pledge)
    db.commit()


@app.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"status": "ok", "service": "puedoayudar.co-api", "database": "mysql"}


@app.get("/v1/network")
def get_network(db: Session = Depends(get_db)):
    clean_expired_pledges(db)
    report_rows = list(
        db.scalars(
            select(FieldReport)
            .where(FieldReport.status == "verified")
            .order_by(FieldReport.updated_at.desc())
            .limit(100)
        )
    )
    center_rows = list(
        db.scalars(
            select(Center)
            .where(Center.status != "closed")
            .order_by(Center.city.asc(), Center.name.asc())
        )
    )
    center_ids = [row.id for row in center_rows]
    if not center_ids:
        return {
            "centers": [],
            "needs": [],
            "volunteerRequests": [],
            "reports": [report_json(row) for row in report_rows],
        }

    status_order = case((Need.status == "urgent", 0), (Need.status == "normal", 1), else_=2)
    priority_order = case((Need.priority == "critical", 0), (Need.priority == "high", 1), else_=2)
    need_rows = list(
        db.scalars(
            select(Need)
            .where(Need.center_id.in_(center_ids))
            .order_by(status_order, priority_order, Need.updated_at.desc())
        )
    )
    volunteer_rows = list(
        db.scalars(
            select(VolunteerRequest)
            .where(VolunteerRequest.center_id.in_(center_ids))
            .order_by(VolunteerRequest.updated_at.desc())
        )
    )
    return {
        "centers": [center_json(row) for row in center_rows],
        "needs": [need_json(row) for row in need_rows],
        "volunteerRequests": [volunteer_json(row) for row in volunteer_rows],
        "reports": [report_json(row) for row in report_rows],
    }


@app.post("/v1/network")
def post_network(payload: ActionPayload, db: Session = Depends(get_db)):
    action = payload.action.strip()
    now = utcnow()

    if action == "pledge":
        quantity = max(1, min(10000, int(payload.quantity or 0)))
        need = db.scalar(select(Need).where(Need.id == clean_text(payload.needId, 80)).with_for_update())
        if not need or need.status == "blocked":
            return JSONResponse({"error": "Esta necesidad ya no recibe aportes."}, status_code=409)
        center = db.get(Center, need.center_id)
        if not center or center.status != "active":
            return JSONResponse({"error": "El centro no está recibiendo ayuda en este momento."}, status_code=409)
        remaining = max(0, need.target - need.covered - need.committed)
        if remaining <= 0:
            return JSONResponse({"error": "La meta ya está cubierta."}, status_code=409)
        if quantity > remaining:
            return JSONResponse({"error": f"Solo faltan {remaining} {need.unit}."}, status_code=409)

        expires_at = now + timedelta(hours=6)
        pledge = Pledge(need_id=need.id, quantity=quantity, expires_at=expires_at)
        need.committed += quantity
        need.updated_at = now
        db.add(pledge)
        db.commit()
        return JSONResponse(
            {
                "ok": True,
                "expiresAt": expires_at.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
                "reference": uuid.uuid4().hex[:8].upper(),
            },
            status_code=201,
        )

    if action == "volunteer":
        request_id = clean_text(payload.requestId, 80)
        quantity = max(1, min(20, int(payload.quantity or 1)))
        item = db.scalar(
            select(VolunteerRequest)
            .where(VolunteerRequest.id == request_id)
            .with_for_update()
        )
        if not item or item.status != "open":
            return JSONResponse({"error": "La solicitud ya fue cubierta."}, status_code=409)
        center = db.get(Center, item.center_id)
        if not center or center.status != "active":
            return JSONResponse({"error": "El centro no está recibiendo voluntarios."}, status_code=409)
        item.accepted = min(item.quantity, item.accepted + quantity)
        item.status = "filled" if item.accepted >= item.quantity else "open"
        item.updated_at = now
        db.commit()
        return JSONResponse({"ok": True, "accepted": item.accepted}, status_code=201)

    if action == "report":
        category = clean_text(payload.category, 30)
        city = clean_text(payload.city, 80)
        location = clean_text(payload.location, 180)
        details = clean_text(payload.details, 800)
        if category not in {"products", "hands", "saturation"} or not city or not location or len(details) < 10:
            return JSONResponse(
                {"error": "Completa la ciudad, ubicación y una descripción clara."},
                status_code=400,
            )
        report = FieldReport(category=category, city=city, location=location, details=details, status="verified")
        db.add(report)
        db.commit()
        db.refresh(report)
        return JSONResponse({"ok": True, "published": True, "report": report_json(report)}, status_code=201)

    return JSONResponse({"error": "Acción no reconocida."}, status_code=400)


@app.get("/v1/centers")
def get_centers(
    city: str = Query(default="", max_length=80),
    all_records: bool = Query(default=False, alias="all"),
    db: Session = Depends(get_db),
):
    query = select(Center)
    if not all_records:
        query = query.where(Center.status != "closed")
    if city.strip():
        query = query.where(Center.city == city.strip()[:80])
    rows = list(db.scalars(query.order_by(Center.updated_at.desc(), Center.city.asc(), Center.name.asc())))
    return {"centers": [center_json(row) for row in rows]}


@app.post("/v1/centers")
def create_center(
    payload: CenterCreate,
    db: Session = Depends(get_db),
):
    center = Center(
        name=payload.name,
        city=payload.city,
        address=payload.address,
        latitude=payload.latitude,
        longitude=payload.longitude,
        contact=payload.contact,
        hours=payload.hours,
        source_name=payload.sourceName,
        source_url=payload.sourceUrl,
        verified_at=utcnow() if payload.sourceUrl else None,
        location_precision=payload.locationPrecision,
        status="active",
    )
    db.add(center)
    db.commit()
    db.refresh(center)
    return JSONResponse({"center": center_json(center)}, status_code=201)


@app.patch("/v1/centers")
def update_center(
    payload: CenterUpdate,
    db: Session = Depends(get_db),
    x_coordinator_code: str | None = Header(default=None),
):
    # Cerrar un centro lo borra del mapa para todo el país: eso sí pide clave.
    if payload.status == "closed":
        assert_coordinator(x_coordinator_code)
    center = db.scalar(select(Center).where(Center.id == payload.id).with_for_update())
    if not center:
        return JSONResponse({"error": "Centro no encontrado."}, status_code=404)
    if payload.status is None and payload.volunteersSaturated is None:
        return JSONResponse({"error": "Nada que actualizar."}, status_code=400)
    # Reabrir un centro cerrado también es cosa de coordinación.
    if center.status == "closed" and payload.status is not None and payload.status != "closed":
        assert_coordinator(x_coordinator_code)
    if payload.status is not None:
        center.status = payload.status
    if payload.volunteersSaturated is not None:
        center.volunteers_saturated = payload.volunteersSaturated
    center.updated_at = utcnow()
    db.commit()
    return {"center": center_json(center)}


@app.get("/v1/coordination")
def get_coordination(
    db: Session = Depends(get_db),
    x_coordinator_code: str | None = Header(default=None),
):
    centers = list(db.scalars(select(Center).order_by(Center.city.asc(), Center.name.asc())))
    needs = list(db.scalars(select(Need).order_by(Need.updated_at.desc())))
    volunteer_requests = list(db.scalars(select(VolunteerRequest).order_by(VolunteerRequest.updated_at.desc())))
    report_query = select(FieldReport)
    # Lo que moderación retiró deja de servirse en abierto.
    if not coordinator_ok(x_coordinator_code):
        report_query = report_query.where(FieldReport.status != "rejected")
    reports = list(db.scalars(report_query.order_by(FieldReport.created_at.desc()).limit(100)))
    return {
        "centers": [center_json(row) for row in centers],
        "needs": [need_json(row) for row in needs],
        "volunteerRequests": [volunteer_json(row) for row in volunteer_requests],
        "reports": [report_json(row) for row in reports],
    }


@app.post("/v1/coordination")
def post_coordination(
    payload: CoordinationPayload,
    db: Session = Depends(get_db),
):
    action = payload.action.strip()
    now = utcnow()
    center_id = clean_text(payload.centerId, 80)
    if not center_id or not db.get(Center, center_id):
        return JSONResponse({"error": "Selecciona un centro válido."}, status_code=400)

    if action == "need":
        name = clean_text(payload.name, 100)
        detail = clean_text(payload.detail, 220)
        priority = clean_text(payload.priority, 20)
        unit = clean_text(payload.unit, 40)
        target = int(payload.target or 0)
        covered = max(0, int(payload.covered or 0))
        if not name or target < 1 or not unit or priority not in {"critical", "high", "medium"}:
            return JSONResponse({"error": "Completa los datos del producto."}, status_code=400)
        db.add(
            Need(
                center_id=center_id,
                name=name,
                detail=detail,
                priority=priority,
                target=min(target, 100000),
                covered=min(covered, 100000),
                unit=unit,
                status="urgent",
            )
        )
        db.commit()
        return JSONResponse({"ok": True}, status_code=201)

    if action == "needs":
        detail = clean_text(payload.detail, 220)
        priority = clean_text(payload.priority, 20)
        unit = clean_text(payload.unit, 40)
        target = int(payload.target or 0)
        covered = max(0, int(payload.covered or 0))
        names = []
        for raw_name in payload.items:
            name = clean_text(raw_name, 100)
            if name and name not in names:
                names.append(name)
        if not names or not unit or target < 1 or priority not in {"critical", "high", "medium"}:
            return JSONResponse({"error": "Selecciona al menos un elemento y completa la cantidad."}, status_code=400)
        for name in names:
            db.add(Need(center_id=center_id, name=name, detail=detail, priority=priority, target=min(target, 100000), covered=min(covered, 100000), unit=unit, status="urgent"))
        db.commit()
        return JSONResponse({"ok": True, "created": len(names)}, status_code=201)

    if action == "needs-batch":
        lines = payload.products
        if not lines:
            return JSONResponse({"error": "Marca al menos un producto."}, status_code=400)
        existing = {
            row.name.strip().lower(): row
            for row in db.scalars(select(Need).where(Need.center_id == center_id))
        }
        created = 0
        updated = 0
        for line in lines:
            current = existing.get(line.name.lower())
            if current is None:
                # Nothing to block if the need was never published.
                if line.status == "blocked":
                    continue
                db.add(
                    Need(
                        center_id=center_id,
                        name=line.name,
                        detail=line.detail,
                        priority=line.priority,
                        target=line.target,
                        covered=0,
                        unit=line.unit,
                        status=line.status,
                    )
                )
                created += 1
                continue
            current.detail = line.detail or current.detail
            current.unit = line.unit
            current.priority = line.priority
            current.status = line.status
            # Never drop the goal below what donors already promised.
            current.target = max(line.target, current.covered + current.committed, 1)
            current.updated_at = now
            updated += 1
        db.commit()
        return JSONResponse({"ok": True, "created": created, "updated": updated}, status_code=201)

    if action == "needs-received":
        lines = payload.received
        if not lines:
            return JSONResponse({"error": "Marca al menos una entrega."}, status_code=400)
        existing = {
            row.name.strip().lower(): row
            for row in db.scalars(
                select(Need).where(Need.center_id == center_id).with_for_update()
            )
        }
        applied = 0
        for line in lines:
            need = existing.get(line.name.lower())
            if need is None:
                continue

            # Lo que llega deja de estar prometido. Hay que consumir las promesas reales,
            # no solo restar el contador: si no, al vencer descontarían otra vez y
            # liberarían un cupo que ya se entregó.
            pending = line.quantity
            pledges = db.scalars(
                select(Pledge)
                .where(Pledge.need_id == need.id)
                .order_by(Pledge.expires_at)
                .with_for_update()
            )
            for pledge in pledges:
                if pending <= 0:
                    break
                taken = min(pledge.quantity, pending)
                pledge.quantity -= taken
                need.committed = max(0, need.committed - taken)
                pending -= taken
                if pledge.quantity <= 0:
                    db.delete(pledge)

            need.covered = min(need.covered + line.quantity, 100000)
            # La meta nunca puede quedar por debajo de lo que ya llegó.
            need.target = max(need.target, need.covered)
            if need.covered >= need.target:
                # Cubierta: deja de pedirse sola, sin que nadie tenga que acordarse.
                need.status = "blocked"
            need.updated_at = now
            applied += 1

        if not applied:
            return JSONResponse({"error": "Ninguna de esas necesidades está publicada."}, status_code=400)
        db.commit()
        return JSONResponse({"ok": True, "applied": applied}, status_code=201)

    if action == "volunteer-request":
        kind = clean_text(payload.kind, 100)
        detail = clean_text(payload.detail, 260)
        quantity = int(payload.quantity or 0)
        if not kind or quantity < 1:
            return JSONResponse({"error": "Completa la solicitud de voluntarios."}, status_code=400)
        db.add(
            VolunteerRequest(
                center_id=center_id,
                kind=kind,
                detail=detail,
                quantity=min(quantity, 500),
                status="open",
            )
        )
        db.commit()
        return JSONResponse({"ok": True}, status_code=201)

    return JSONResponse({"error": "Acción no reconocida."}, status_code=400)


@app.patch("/v1/coordination")
def patch_coordination(
    payload: CoordinationPayload,
    db: Session = Depends(get_db),
    x_coordinator_code: str | None = Header(default=None),
):
    action = payload.action.strip()
    record_id = clean_text(payload.id, 80)
    if not record_id:
        return JSONResponse({"error": "Registro inválido."}, status_code=400)

    if action == "need":
        item = db.scalar(select(Need).where(Need.id == record_id).with_for_update())
        target = int(payload.target or 0)
        covered = int(payload.covered if payload.covered is not None else -1)
        if not item or target < 1 or covered < 0 or payload.status not in {"urgent", "normal", "blocked"}:
            return JSONResponse({"error": "Actualización de producto inválida."}, status_code=400)
        item.target = min(target, 100000)
        item.covered = min(covered, 100000)
        item.status = payload.status
        item.updated_at = utcnow()
        db.commit()
        return {"ok": True}

    if action == "volunteer-request":
        item = db.scalar(select(VolunteerRequest).where(VolunteerRequest.id == record_id).with_for_update())
        if not item or payload.status not in {"open", "filled", "closed"}:
            return JSONResponse({"error": "Estado inválido."}, status_code=400)
        # Sin esto, una solicitud reabierta conserva accepted == quantity y queda
        # invisible para los voluntarios, que filtran por accepted < quantity.
        if payload.status == "open" and item.accepted >= item.quantity:
            item.accepted = 0
        item.status = payload.status
        item.updated_at = utcnow()
        db.commit()
        return {"ok": True}

    if action == "report":
        # Retirar un reporte lo saca de la vista pública: pide clave.
        if payload.status == "rejected":
            assert_coordinator(x_coordinator_code)
        item = db.scalar(select(FieldReport).where(FieldReport.id == record_id).with_for_update())
        if not item or payload.status not in {"pending", "verified", "rejected"}:
            return JSONResponse({"error": "Estado inválido."}, status_code=400)
        item.status = payload.status
        item.updated_at = utcnow()
        db.commit()
        return {"ok": True}

    return JSONResponse({"error": "Acción no reconocida."}, status_code=400)
