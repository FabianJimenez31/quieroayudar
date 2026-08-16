from datetime import datetime, timezone

from .models import Center, FieldReport, Need, VolunteerRequest


def iso(value: datetime) -> str:
    aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    return aware.isoformat().replace("+00:00", "Z")


def center_json(row: Center) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "city": row.city,
        "address": row.address,
        "latitude": row.latitude,
        "longitude": row.longitude,
        "contact": row.contact,
        "hours": row.hours,
        "sourceName": row.source_name,
        "sourceUrl": row.source_url,
        "verifiedAt": iso(row.verified_at) if row.verified_at else None,
        "status": row.status,
        "volunteersSaturated": bool(row.volunteers_saturated),
        "locationPrecision": row.location_precision or "exact",
        "createdAt": iso(row.created_at),
        "updatedAt": iso(row.updated_at),
    }

def need_json(row: Need) -> dict:
    return {
        "id": row.id,
        "centerId": row.center_id,
        "name": row.name,
        "detail": row.detail,
        "priority": row.priority,
        "target": row.target,
        "covered": row.covered,
        "committed": row.committed,
        "unit": row.unit,
        "status": row.status,
        "createdAt": iso(row.created_at),
        "updatedAt": iso(row.updated_at),
    }


def volunteer_json(row: VolunteerRequest) -> dict:
    return {
        "id": row.id,
        "centerId": row.center_id,
        "kind": row.kind,
        "detail": row.detail,
        "quantity": row.quantity,
        "accepted": row.accepted,
        "status": row.status,
        "createdAt": iso(row.created_at),
        "updatedAt": iso(row.updated_at),
    }


def report_json(row: FieldReport) -> dict:
    return {
        "id": row.id,
        "category": row.category,
        "city": row.city,
        "location": row.location,
        "details": row.details,
        "status": row.status,
        "createdAt": iso(row.created_at),
        "updatedAt": iso(row.updated_at),
    }
