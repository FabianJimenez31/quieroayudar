from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Emergencias activas que un centro puede servir. "terremoto" es la causa por defecto.
Cause = Literal["terremoto", "tolima"]


class ActionPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    action: str = Field(max_length=30)
    needId: Optional[str] = Field(default=None, max_length=80)
    requestId: Optional[str] = Field(default=None, max_length=80)
    quantity: Optional[int] = None
    category: Optional[str] = Field(default=None, max_length=30)
    city: Optional[str] = Field(default=None, max_length=80)
    location: Optional[str] = Field(default=None, max_length=180)
    details: Optional[str] = Field(default=None, max_length=800)


class CenterCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=100)
    city: str = Field(min_length=1, max_length=80)
    address: str = Field(min_length=1, max_length=180)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    contact: str = Field(default="", max_length=80)
    hours: str = Field(default="", max_length=100)
    sourceName: str = Field(default="", max_length=120)
    sourceUrl: str = Field(default="", max_length=500)
    # "approximate" cuando solo se tiene la dirección y el pin es del barrio o la calle.
    locationPrecision: Literal["exact", "approximate"] = "exact"
    cause: Cause = "terremoto"

    @field_validator("name", "city", "address", "contact", "hours", "sourceName", "sourceUrl")
    @classmethod
    def trim(cls, value: str) -> str:
        return value.strip()


class CenterUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=80)
    status: Optional[Literal["active", "saturated", "closed"]] = None
    volunteersSaturated: Optional[bool] = None
    cause: Optional[Cause] = None


class ProductLine(BaseModel):
    """One row of the field product checklist, with its own target."""

    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=100)
    detail: str = Field(default="", max_length=220)
    unit: str = Field(default="unidades", min_length=1, max_length=40)
    status: Literal["urgent", "normal", "blocked"]
    target: int = Field(default=1, ge=1, le=100000)

    @field_validator("name", "detail", "unit")
    @classmethod
    def trim_line(cls, value: str) -> str:
        return value.strip()

    @property
    def priority(self) -> str:
        return "critical" if self.status == "urgent" else "medium"


class ReceivedLine(BaseModel):
    """Una entrega que ya llegó físicamente al centro."""

    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=100)
    quantity: int = Field(ge=1, le=100000)

    @field_validator("name")
    @classmethod
    def trim_received(cls, value: str) -> str:
        return value.strip()


class CoordinationPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    action: str = Field(max_length=30)
    id: Optional[str] = Field(default=None, max_length=80)
    centerId: Optional[str] = Field(default=None, max_length=80)
    name: Optional[str] = Field(default=None, max_length=100)
    detail: Optional[str] = Field(default=None, max_length=260)
    priority: Optional[str] = Field(default=None, max_length=20)
    target: Optional[int] = None
    covered: Optional[int] = None
    unit: Optional[str] = Field(default=None, max_length=40)
    kind: Optional[str] = Field(default=None, max_length=100)
    quantity: Optional[int] = None
    status: Optional[str] = Field(default=None, max_length=20)
    items: list[str] = Field(default_factory=list, max_length=16)
    products: list[ProductLine] = Field(default_factory=list, max_length=40)
    received: list[ReceivedLine] = Field(default_factory=list, max_length=40)


def clean_text(value: Any, maximum: int) -> str:
    return value.strip()[:maximum] if isinstance(value, str) else ""
