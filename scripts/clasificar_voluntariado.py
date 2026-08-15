#!/usr/bin/env python3
"""Convierte la lista de voluntariado de Google Maps en un CSV listo para importar.

La lista mezcla cosas distintas: puntos que reciben donaciones, puntos que solo piden
voluntarios para embalar, jornadas de donación de sangre y sitios sin información. Este
script las separa y deja fuera lo que no es un centro de acopio, para no mandar gente
a un lugar equivocado.

Salida: un CSV por categoría en el mismo directorio del JSON.
"""

from __future__ import annotations

import csv
import json
import math
import re
import sys
from pathlib import Path

# Un nombre que empieza así es en realidad una dirección, no el nombre del sitio.
ADDRESS_START = re.compile(r"^(cl|cra|cr|ak|av|tv|dg|kr|calle|carrera|transversal|diagonal)\b[\s.]*\d", re.I)
PHONE = re.compile(r"\b3\d{9}\b")
CITY_HINTS = ("bogotá", "bogota", "zipaquirá", "chía", "chia", "cajicá", "cajica", "mosquera", "cundinamarca")
# Localidades de Bogotá que aparecen en el encabezado y no son municipios aparte.
LOCALIDADES = {"suba", "usaquén", "usaquen", "kennedy", "chapinero", "barrios unidos", "fontibón", "fontibon"}


# Bogotá D.C. es demasiado grande para un centroide, así que se prueba primero por caja.
BOGOTA_BOX = (4.47, 4.84, -74.23, -74.00)  # lat mín, lat máx, lon mín, lon máx
MUNICIPIOS = {
    "Chía": (4.8607, -74.0586),
    "Cajicá": (4.9185, -74.0265),
    "Zipaquirá": (5.0221, -73.9967),
    "Cota": (4.8095, -74.0985),
    "Mosquera": (4.7059, -74.2300),
    "Funza": (4.7166, -74.2119),
    "Madrid": (4.7325, -74.2650),
    "Soacha": (4.5794, -74.2168),
    "Sopó": (4.9089, -73.9410),
    "La Calera": (4.7212, -73.9694),
}


def city_from_coords(lat: float, lng: float) -> str:
    """El encabezado de Google a veces omite el municipio; la posición no."""
    lat_min, lat_max, lon_min, lon_max = BOGOTA_BOX
    if lat_min <= lat <= lat_max and lon_min <= lng <= lon_max:
        return "Bogotá"
    return min(
        MUNICIPIOS,
        key=lambda name: (MUNICIPIOS[name][0] - lat) ** 2 + (MUNICIPIOS[name][1] - lng) ** 2,
    )


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


# Una línea con horas no es ni nombre ni dirección.
TIME_LIKE = re.compile(r"\d\s*(a\.?\s?m|p\.?\s?m|:\d{2})", re.I)
SKIP_PREFIXES = (
    "horario", "hora:", "día", "dia", "actualiz", "actuliz", "inscripción", "inscripcion",
    "registro", "contacto", "más info", "mas info", "necesitan donaciones", "llegar",
    "por orden", "llevar", "requiere", "diligenciar", "formulario", "revisar", "quizás",
    "quizas", "jornada", "separación", "separacion", "sótano", "sotano", "para ser",
    "dirección", "direccion", "información", "informacion", "desde las", "chat de",
)


def better_name(point: dict) -> tuple[str, str]:
    """Devuelve (nombre, direccion).

    La dirección solo sale del campo `nombre` original cuando de verdad parece una
    dirección. Lo que se saca de `detalles` se usa únicamente como nombre: usarlo como
    dirección metía horarios en el campo equivocado.
    """
    raw = clean(point.get("nombre", ""))
    lines = [clean(line) for line in (point.get("detalles") or "").split("\n") if clean(line)]

    place = ""
    for line in lines:
        if line.lower().startswith("lugar:"):
            candidate = clean(line.split(":", 1)[1])
            if candidate and not TIME_LIKE.search(candidate):
                place = candidate
            break
    if not place:
        # Una línea suelta sin emoji ni etiqueta suele ser el nombre de la organización.
        for line in lines:
            low = line.lower()
            if (
                not re.match(r"^[\U0001F300-\U0001FAFF☀-➿]", line)
                and not line.startswith("@")
                and not any(low.startswith(tag) for tag in SKIP_PREFIXES)
                and not TIME_LIKE.search(line)
                and not PHONE.search(line)
                and "http" not in low
                and len(line) > 3
            ):
                place = line
                break

    if ADDRESS_START.match(raw):
        # El nombre real, si lo hay, va como nombre; la dirección es el "nombre" original.
        return (place or raw), raw
    # Sitio con nombre propio: sin dirección fiable, que la resuelva el geocodificador.
    return raw, ""


def city_of(point: dict) -> str:
    for chunk in point.get("encabezado", [])[1:]:
        low = clean(chunk).lower()
        if low in LOCALIDADES:
            return "Bogotá"
        for hint in CITY_HINTS:
            if hint in low:
                nice = clean(chunk).replace(", Cundinamarca", "").replace(", D.C.", "").strip()
                return "Bogotá" if nice.lower() in {"bogotá", "bogota"} else nice
    return ""


def classify(point: dict) -> tuple[str, str]:
    """Devuelve (categoría, motivo)."""
    vol = clean(point.get("estado_voluntariado") or "")
    don = clean(point.get("estado_donaciones") or "")
    both = f"{vol} {don}".lower()
    header = " ".join(point.get("encabezado", [])).lower()

    if "este lugar ya no existe" in header:
        return "descartado", "Google marca el sitio como inexistente"
    if "dona sangre" in both:
        return "descartado", "jornada de donación de sangre, no es acopio"
    if not vol and not don:
        return "descartado", "sin ninguna información de estado"
    if "próximamente" in both or "proximamente" in both:
        return "descartado", "aún no está operando"
    if "🟡" in both or "información por actualizar" in both:
        return "sin_confirmar", "la propia lista dice que está sin actualizar"

    recibe = "📦" in don or "sí donaciones" in both or "si donaciones" in both or "donaciones y cajas" in both
    no_recibe = "no donaciones" in both
    quiere_voluntarios = "🟢" in vol
    if no_recibe and not quiere_voluntarios:
        return "descartado", "no recibe donaciones ni voluntarios"
    if recibe or quiere_voluntarios:
        return "acopio", ""
    return "sin_confirmar", "estado ambiguo"


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "scripts/data/voluntariado-bogota-2026-08-13.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    points = data["puntos"]

    # Las coordenadas llegan en un archivo aparte porque el JSON original no las traía.
    coords: dict[int, dict[str, str]] = {}
    coords_path = path.with_name(path.stem + "-coords.csv")
    if coords_path.exists():
        with coords_path.open(encoding="utf-8", newline="") as handle:
            coords = {int(row["id"]): row for row in csv.DictReader(handle)}

    buckets: dict[str, list[dict]] = {"acopio": [], "sin_confirmar": [], "descartado": []}
    for point in points:
        categoria, motivo = classify(point)
        name, address = better_name(point)
        city = city_of(point)
        vol = clean(point.get("estado_voluntariado") or "")
        don = clean(point.get("estado_donaciones") or "")
        phone = PHONE.search(point.get("detalles") or "")
        fix = coords.get(point["id"])
        lat = float(fix["lat"]) if fix else None
        lng = float(fix["lng"]) if fix else None
        if not city and lat is not None:
            city = city_from_coords(lat, lng)
        buckets[categoria].append(
            {
                "id": point["id"],
                "lat": f"{lat:.7f}" if lat is not None else "",
                "lng": f"{lng:.7f}" if lng is not None else "",
                "metodo": fix["metodo"] if fix else "",
                "precision": fix["precision"] if fix else "",
                "nombre": name,
                "direccion": address,
                "ciudad": city,
                "telefono": phone.group(0) if phone else "",
                "horario": clean(" · ".join(point.get("horarios") or []))[:100],
                "voluntarios": "si" if "🟢" in vol else ("no" if "🔴" in vol else ""),
                "donaciones": "si" if ("📦" in don or "sí donaciones" in f"{vol} {don}".lower()) else "",
                "motivo": motivo,
            }
        )

    for categoria, rows in buckets.items():
        print(f"\n{'═' * 78}\n{categoria.upper()}  ({len(rows)})\n{'═' * 78}")
        for row in rows:
            ciudad = row["ciudad"] or "¿ciudad?"
            marca = ""
            if row["voluntarios"] == "si":
                marca += " [voluntarios]"
            if row["donaciones"] == "si":
                marca += " [donaciones]"
            print(f"  {row['id']:>3}  {row['nombre'][:44]:<44} {ciudad:<14}{marca}")
            if row["direccion"] and row["direccion"] != row["nombre"]:
                print(f"       {row['direccion'][:70]}")
            if row["motivo"]:
                print(f"       → {row['motivo']}")

    out = path.with_name(path.stem + "-acopios.csv")
    with out.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "nombre", "direccion", "ciudad", "lat", "lng",
                "telefono", "horario", "voluntarios", "donaciones",
            ],
        )
        writer.writeheader()
        # Decisión del operador: los "sin confirmar" también entran, en igualdad de condiciones.
        exportables = buckets["acopio"] + buckets["sin_confirmar"]
        for row in exportables:
            writer.writerow({key: row[key] for key in writer.fieldnames})
    print(f"\nCSV con {len(exportables)} puntos (acopio + sin confirmar) → {out}")

    sin_coords = [row["id"] for row in exportables if not row["lat"]]
    if sin_coords:
        print(f"Sin coordenadas: {sin_coords}")
    # La propia fuente avisa de que lo que no viene del pin de Google hay que revisarlo.
    aproximados = [row for row in exportables if row["precision"] in {"Locality", "StreetName"}]
    if aproximados:
        print("\nUbicación aproximada, conviene verificarlas a mano:")
        for row in aproximados:
            print(f"  {row['id']:>3}  {row['nombre'][:46]:<46} {row['precision']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
