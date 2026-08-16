from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def uuid4() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Center(Base):
    __tablename__ = "centers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    city: Mapped[str] = mapped_column(String(80), nullable=False)
    address: Mapped[str] = mapped_column(String(180), nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    contact: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    hours: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    source_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    source_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    volunteers_saturated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # "exact" = pin verificado; "approximate" = solo tenemos la dirección, el punto es
    # del barrio o de la calle. La app enruta por texto cuando es aproximado, para no
    # mandar a nadie a una conjetura nuestra.
    location_precision: Mapped[str] = mapped_column(String(12), nullable=False, default="exact")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    needs: Mapped[list["Need"]] = relationship(back_populates="center", cascade="all, delete-orphan")
    volunteer_requests: Mapped[list["VolunteerRequest"]] = relationship(back_populates="center", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_centers_city_status", "city", "status"),
        Index("idx_centers_updated_at", "updated_at"),
    )


class Need(Base):
    __tablename__ = "needs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    center_id: Mapped[str] = mapped_column(String(36), ForeignKey("centers.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    detail: Mapped[str] = mapped_column(String(220), nullable=False, default="")
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="high")
    target: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    covered: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    committed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unit: Mapped[str] = mapped_column(String(40), nullable=False, default="unidades")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="urgent")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    center: Mapped[Center] = relationship(back_populates="needs")
    pledges: Mapped[list["Pledge"]] = relationship(back_populates="need", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_needs_center_status", "center_id", "status"),
        Index("idx_needs_status_priority", "status", "priority"),
    )


class VolunteerRequest(Base):
    __tablename__ = "volunteer_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    center_id: Mapped[str] = mapped_column(String(36), ForeignKey("centers.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(100), nullable=False)
    detail: Mapped[str] = mapped_column(String(260), nullable=False, default="")
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    accepted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    center: Mapped[Center] = relationship(back_populates="volunteer_requests")

    __table_args__ = (Index("idx_volunteer_center_status", "center_id", "status"),)


class Pledge(Base):
    __tablename__ = "pledges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    need_id: Mapped[str] = mapped_column(String(36), ForeignKey("needs.id", ondelete="CASCADE"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    need: Mapped[Need] = relationship(back_populates="pledges")

    __table_args__ = (Index("idx_pledges_need_expires", "need_id", "expires_at"),)


class FieldReport(Base):
    __tablename__ = "field_reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    city: Mapped[str] = mapped_column(String(80), nullable=False)
    location: Mapped[str] = mapped_column(String(180), nullable=False)
    details: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    __table_args__ = (Index("idx_reports_status_created", "status", "created_at"),)
