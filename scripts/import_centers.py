#!/usr/bin/env python3
"""Importa centros de acopio desde un listado externo.

Pensado para listas de Google Maps exportadas con Takeout, pero acepta tres formatos:

  * GeoJSON  (Takeout → "Guardado" → lista.geojson): trae coordenadas, no hace falta geocodificar.
  * CSV      (Takeout → lista.csv, o uno propio con columnas nombre/direccion/ciudad/lat/lng).
  * Texto    (una línea por sitio: "Nombre — Dirección, Ciudad").

Los sitios sin coordenadas se geocodifican contra Nominatim (OpenStreetMap), que no
necesita clave pero exige un User-Agent identificable y máximo una consulta por segundo.

La carga es idempotente: se salta lo que ya existe, comparando por nombre+ciudad
normalizados y por cercanía (menos de 150 m se considera el mismo punto). Por defecto
solo simula; hay que pasar --apply para escribir.

Uso:
    python3 scripts/import_centers.py lista.geojson \\
        --source-name "Alcaldía de Bogotá" \\
        --source-url "https://…" \\
        [--city-default Bogotá] [--apply]
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

API = "http://127.0.0.1:8123/v1"
USER_AGENT = "puedoayudar.co/1.0 (importador de centros de acopio; contacto@quieroayudar.co)"
SAME_PLACE_METERS = 150
# Un recinto grande (estadio, coliseo) puede estar a más de 150 m de su propio centroide,
# así que lo que caiga en esta franja se marca para que lo revise una persona.
REVIEW_METERS = 600


@dataclass
class Place:
    name: str
    address: str = ""
    city: str = ""
    latitude: float | None = None
    longitude: float | None = None
    contact: str = ""
    hours: str = ""
    # "no" cuando la fuente dice que ya tienen suficientes voluntarios.
    volunteers: str = ""
    # "approximate" cuando solo tenemos la dirección: la app enruta por texto.
    precision: str = "exact"
    source_name: str = ""
    notes: list[str] = field(default_factory=list)


# ───────────────────────────── utilidades ─────────────────────────────


def norm(value: str) -> str:
    """Minúsculas sin tildes ni puntuación, para comparar nombres y ciudades."""
    stripped = unicodedata.normalize("NFD", value or "")
    stripped = "".join(char for char in stripped if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9 ]+", " ", stripped.lower()).strip()


def meters_between(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    rad = math.radians
    d_lat = rad(b_lat - a_lat)
    d_lng = rad(b_lng - a_lng)
    h = math.sin(d_lat / 2) ** 2 + math.cos(rad(a_lat)) * math.cos(rad(b_lat)) * math.sin(d_lng / 2) ** 2
    return 6371000 * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def coords_from_maps_url(url: str) -> tuple[float, float] | None:
    """Google mete las coordenadas en varios sitios de la URL según cómo se compartió."""
    for pattern in (r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", r"@(-?\d+\.\d+),(-?\d+\.\d+)", r"[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)"):
        found = re.search(pattern, url or "")
        if found:
            return float(found.group(1)), float(found.group(2))
    return None


def request_json(url: str, method: str = "GET", payload: dict | None = None, headers: dict | None = None):
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(url, data=body, method=method)
    request.add_header("accept", "application/json")
    request.add_header("user-agent", USER_AGENT)
    if payload is not None:
        request.add_header("content-type", "application/json")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.status, json.loads(response.read().decode() or "{}")


# ───────────────────────────── lectura ─────────────────────────────


def read_geojson(path: Path) -> list[Place]:
    data = json.loads(path.read_text(encoding="utf-8"))
    places: list[Place] = []
    for feature in data.get("features", []):
        properties = feature.get("properties", {}) or {}
        location = properties.get("location", {}) or {}
        coordinates = (feature.get("geometry", {}) or {}).get("coordinates") or [None, None]
        places.append(
            Place(
                name=(location.get("name") or properties.get("name") or properties.get("Title") or "").strip(),
                address=(location.get("address") or "").strip(),
                city=(location.get("country_code") and "" or "").strip(),
                longitude=coordinates[0],
                latitude=coordinates[1],
            )
        )
    return [place for place in places if place.name]


def read_csv(path: Path) -> list[Place]:
    places: list[Place] = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            lowered = {norm(key): (value or "").strip() for key, value in row.items() if key}

            def pick(*names: str) -> str:
                for name in names:
                    if lowered.get(name):
                        return lowered[name]
                return ""

            place = Place(
                name=pick("title", "nombre", "name"),
                address=pick("direccion", "address", "note", "nota"),
                city=pick("ciudad", "city", "municipio"),
                contact=pick("telefono", "contact", "phone"),
                hours=pick("horario", "hours"),
                volunteers=pick("voluntarios", "volunteers"),
                precision=pick("precision", "precision_ubicacion") or "exact",
                source_name=pick("fuente", "source", "source_name"),
            )
            latitude, longitude = pick("lat", "latitud", "latitude"), pick("lng", "lon", "longitud", "longitude")
            if latitude and longitude:
                place.latitude, place.longitude = float(latitude.replace(",", ".")), float(longitude.replace(",", "."))
            else:
                from_url = coords_from_maps_url(pick("url", "enlace", "link"))
                if from_url:
                    place.latitude, place.longitude = from_url
            if place.name:
                places.append(place)
    return places


def read_text(path: Path) -> list[Place]:
    places: list[Place] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        name, _, rest = line.partition("—") if "—" in line else line.partition(" - ")
        address, _, city = rest.rpartition(",")
        places.append(
            Place(name=name.strip(), address=(address or rest).strip(), city=city.strip())
        )
    return [place for place in places if place.name]


def read_places(path: Path) -> list[Place]:
    suffix = path.suffix.lower()
    if suffix in {".geojson", ".json"}:
        return read_geojson(path)
    if suffix == ".csv":
        return read_csv(path)
    return read_text(path)


# ───────────────────────────── geocodificación ─────────────────────────────


def geocode(place: Place, default_city: str, box: tuple[float, float, float, float] | None) -> bool:
    """Geocodifica contra Nominatim, acotado a una caja geográfica.

    Sin la caja, buscar por nombre de negocio devuelve homónimos de todo el país:
    en una prueba, "Casa de la memoria" cayó en Medellín y "Agrocampo" en Vélez.
    Un punto de acopio mal ubicado es peor que un punto ausente.
    """
    query = ", ".join(part for part in [place.address or place.name, place.city or default_city, "Colombia"] if part)
    params = {"q": query, "format": "json", "limit": 1, "countrycodes": "co", "addressdetails": 1}
    if box:
        west, south, east, north = box
        params["viewbox"] = f"{west},{north},{east},{south}"
        params["bounded"] = 1
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params)
    try:
        _, results = request_json(url)
    except Exception as error:  # noqa: BLE001 - la causa exacta no cambia la acción
        place.notes.append(f"geocodificación falló: {error}")
        return False
    if not results:
        place.notes.append("sin resultado dentro de la zona")
        return False

    hit = results[0]
    latitude, longitude = float(hit["lat"]), float(hit["lon"])
    if box:
        west, south, east, north = box
        if not (south <= latitude <= north and west <= longitude <= east):
            place.notes.append(f"el resultado cayó fuera de la zona ({latitude:.3f}, {longitude:.3f})")
            return False

    place.latitude, place.longitude = latitude, longitude
    if not place.city:
        details = hit.get("address", {})
        place.city = details.get("city") or details.get("town") or details.get("municipality") or default_city
    place.notes.append("coordenadas de Nominatim")
    return True


# ───────────────────────────── carga ─────────────────────────────


def existing_centers() -> list[dict]:
    _, data = request_json(f"{API}/centers?all=true")
    return data.get("centers", [])


def duplicate_by_name(place: Place, centers: list[dict], default_city: str) -> dict | None:
    """No necesita coordenadas, así que se puede comprobar antes de geocodificar."""
    city = norm(place.city or default_city)
    for center in centers:
        if norm(center["name"]) == norm(place.name) and norm(center["city"]) == city:
            return center
    return None


# Un "nombre" que empieza así es en realidad la dirección del sitio.
ADDRESS_LIKE = re.compile(r"^(cl|cra|cr|ak|av|tv|dg|kr|calle|carrera|transversal|diagonal)\b[\s.]*\d", re.I)
STOPWORDS = {"el", "la", "los", "las", "de", "del", "y", "centro", "comercial", "fundacion", "casa"}


def looks_same(one: str, other: str) -> bool:
    """¿Dos sitios cercanos son el mismo?

    La cercanía sola no basta: en Chapinero un parque y un café caben en 145 m. Se
    fusionan si comparten nombre, o si uno de los dos es una dirección — la lista trae
    varios sitios dos veces, una por su nombre y otra por su dirección.
    """
    if ADDRESS_LIKE.match(one.strip()) or ADDRESS_LIKE.match(other.strip()):
        return True
    first = {word for word in norm(one).split() if word not in STOPWORDS and len(word) > 2}
    second = {word for word in norm(other).split() if word not in STOPWORDS and len(word) > 2}
    if not first or not second:
        return False
    shared = first & second
    return len(shared) / min(len(first), len(second)) >= 0.5


def nearest_center(place: Place, centers: list[dict]) -> tuple[dict, float] | None:
    if place.latitude is None or place.longitude is None or not centers:
        return None
    pairs = [
        (center, meters_between(place.latitude, place.longitude, center["latitude"], center["longitude"]))
        for center in centers
    ]
    return min(pairs, key=lambda pair: pair[1])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("archivo", type=Path, help="lista en .geojson, .csv o .txt")
    parser.add_argument("--source-name", required=True, help="quién publica la lista")
    parser.add_argument("--source-url", required=True, help="enlace a la lista, se guarda como procedencia")
    parser.add_argument("--city-default", default="", help="ciudad para los sitios que no la traigan")
    parser.add_argument(
        "--box",
        default="",
        help="acota la búsqueda a oeste,sur,este,norte (ej. la sabana de Bogotá: -74.45,4.30,-73.85,5.10)",
    )
    parser.add_argument("--apply", action="store_true", help="escribe de verdad; sin esto solo simula")
    args = parser.parse_args()

    if not args.archivo.exists():
        print(f"No existe {args.archivo}", file=sys.stderr)
        return 1

    box = None
    if args.box:
        west, south, east, north = (float(value) for value in args.box.split(","))
        box = (west, south, east, north)

    places = read_places(args.archivo)
    if not places:
        print("El archivo no tiene sitios reconocibles.", file=sys.stderr)
        return 1
    print(f"Leídos {len(places)} sitios de {args.archivo.name}\n")

    centers = existing_centers()
    print(f"Ya hay {len(centers)} centros publicados\n")

    nuevos, duplicados, sin_ubicar = [], [], []
    for place in places:
        # Primero por nombre: si ya existe, no gastamos una consulta al geocodificador.
        found = duplicate_by_name(place, centers, args.city_default)
        if found:
            duplicados.append((place, found))
            continue

        if place.latitude is None or place.longitude is None:
            geocode(place, args.city_default, box)
            time.sleep(1.1)  # Nominatim pide máximo una consulta por segundo.
        if not place.city:
            place.city = args.city_default
        if place.latitude is None or place.longitude is None or not place.city:
            sin_ubicar.append(place)
            continue

        closest = nearest_center(place, centers)
        if closest and closest[1] < SAME_PLACE_METERS and looks_same(place.name, closest[0]["name"]):
            duplicados.append((place, closest[0]))
        else:
            nuevos.append((place, closest))
            # La lista misma trae el mismo sitio dos veces (una por nombre, otra por
            # dirección). Sin esto, el lote se duplicaría contra sí mismo.
            centers.append(
                {
                    "name": place.name,
                    "city": place.city,
                    "latitude": place.latitude,
                    "longitude": place.longitude,
                }
            )

    for place, found in duplicados:
        print(f"  ya existe   {place.name[:48]:<48} → {found['name'][:34]}")
    for place in sin_ubicar:
        print(f"  sin ubicar  {place.name[:48]:<48} {'; '.join(place.notes)}")

    por_revisar = 0
    for place, closest in nuevos:
        marca = " (geocodificado)" if any("Nominatim" in note for note in place.notes) else ""
        print(f"  NUEVO       {place.name[:48]:<48} {place.city}{marca}")
        if closest and closest[1] < REVIEW_METERS:
            por_revisar += 1
            print(f"              ⚠ hay «{closest[0]['name'][:40]}» a {closest[1]:.0f} m — ¿es el mismo sitio?")

    print(f"\n  {len(nuevos)} nuevos · {len(duplicados)} ya existían · {len(sin_ubicar)} sin ubicar")
    if por_revisar:
        print(f"  {por_revisar} de los nuevos están cerca de uno existente: revísalos antes de aplicar.")

    if not args.apply:
        print("\nSimulación. Repite con --apply para publicarlos.")
        return 0

    creados = 0
    llenos = 0
    for place, _ in nuevos:
        payload = {
            "name": place.name[:100],
            "city": place.city[:80],
            "address": (place.address or place.city)[:180],
            "latitude": place.latitude,
            "longitude": place.longitude,
            "contact": place.contact[:80],
            "hours": place.hours[:100],
            # La fuente propia de cada fila manda; el argumento es el respaldo.
            "sourceName": (place.source_name or args.source_name)[:120],
            "sourceUrl": args.source_url[:500],
            "locationPrecision": "approximate" if place.precision == "approximate" else "exact",
        }
        try:
            status, body = request_json(f"{API}/centers", method="POST", payload=payload)
            if status != 201:
                continue
            creados += 1
            # La lista ya dice quién tiene suficientes voluntarios: se respeta al crear,
            # así logística no manda gente a un punto que ya está lleno.
            if place.volunteers == "no":
                request_json(
                    f"{API}/centers",
                    method="PATCH",
                    payload={"id": body["center"]["id"], "volunteersSaturated": True},
                )
                llenos += 1
        except Exception as error:  # noqa: BLE001
            print(f"  falló {place.name}: {error}", file=sys.stderr)
    print(f"\n  {creados} centros publicados · {llenos} marcados con voluntarios completos")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
