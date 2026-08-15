"use client";

import { useEffect, useMemo, useState } from "react";
import {
  // Se renombra a propósito: `Map` a secas tapa el `Map` nativo de JavaScript,
  // y `new Map()` en este mismo archivo reventaría en tiempo de ejecución.
  Map as MapView,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerPopup,
  type MapRef,
} from "@/components/ui/map";
import UiIcon from "./UiIcon";
import { distanceKm, formatDistance, hasCoordinates, routeUrl } from "./geo";
import type { Center, Need, Position, VolunteerRequest } from "./types";

/**
 * El mapa de verdad. Vive en su propio módulo porque arrastra MapLibre: sólo se
 * descarga cuando alguien abre la vista de mapa, no en el primer arranque de la
 * PWA, que es lo único que muchos afectados alcanzan a cargar.
 */

export type CentersMapCanvasProps = {
  centers: Center[];
  needs: Need[];
  requests: VolunteerRequest[];
  position: Position | null;
  selectedId?: string;
  chooseLabel?: string;
  onChoose?: (center: Center) => void;
};

/** Colombia entera, para cuando todavía no hay ningún punto que encuadrar. */
const COLOMBIA: [number, number] = [-74.2, 4.6];

type Pin = "sat" | "full" | "urgent" | "active";

const PIN_TEXT: Record<Pin, string> = {
  sat: "Saturado. No te dirijas aquí.",
  full: "Ya tienen suficientes voluntarios.",
  urgent: "Recibiendo ayuda. Tiene productos urgentes.",
  active: "Recibiendo ayuda.",
};

export default function CentersMapCanvas(props: CentersMapCanvasProps) {
  const [map, setMap] = useState<MapRef | null>(null);
  const [city, setCity] = useState("");

  const points = useMemo(() => props.centers.filter(hasCoordinates), [props.centers]);

  /**
   * Con toda Colombia encuadrada, los 56 puntos de Bogotá caben en un pulgar y se
   * tapan entre sí. Filtrar por ciudad es lo que hace el mapa legible en un
   * teléfono; la más cercana va primero cuando hay ubicación.
   */
  const cities = useMemo(() => {
    const byCity = new Map<string, { count: number; nearest: number }>();
    for (const center of points) {
      const name = center.city.trim() || "Sin ciudad";
      const near = props.position ? distanceKm(props.position, center) : Number.POSITIVE_INFINITY;
      const seen = byCity.get(name);
      if (seen) {
        seen.count += 1;
        seen.nearest = Math.min(seen.nearest, near);
      } else {
        byCity.set(name, { count: 1, nearest: near });
      }
    }
    return Array.from(byCity, ([name, data]) => ({ name, ...data })).sort((a, b) =>
      props.position ? a.nearest - b.nearest : b.count - a.count || a.name.localeCompare(b.name, "es"),
    );
  }, [points, props.position]);

  const shown = useMemo(
    () => (city ? points.filter((center) => (center.city.trim() || "Sin ciudad") === city) : points),
    [points, city],
  );

  const marks = useMemo(
    () =>
      shown.map((center) => {
        const urgent = props.needs.filter(
          (need) => need.centerId === center.id && need.status === "urgent",
        ).length;
        const hands = props.requests
          .filter((item) => item.centerId === center.id && item.status === "open")
          .reduce((sum, item) => sum + Math.max(0, item.quantity - item.accepted), 0);
        const pin: Pin =
          center.status === "saturated"
            ? "sat"
            : center.volunteersSaturated
              ? "full"
              : urgent > 0
                ? "urgent"
                : "active";
        return { center, urgent, hands, pin };
      }),
    [shown, props.needs, props.requests],
  );

  /*
   * El encuadre se recalcula cuando cambia el conjunto visible. La clave evita
   * reencuadrar en cada sincronización: mover el mapa bajo el dedo de quien está
   * buscando su barrio es peor que no moverlo.
   */
  const frameKey = useMemo(
    () =>
      [
        shown.map((center) => center.id).join(","),
        props.position ? "yo" : "",
        props.selectedId ?? "",
      ].join("|"),
    [shown, props.position, props.selectedId],
  );

  useEffect(() => {
    if (!map) return;

    const selected = props.selectedId
      ? shown.find((center) => center.id === props.selectedId)
      : undefined;
    if (selected) {
      map.easeTo({ center: [selected.longitude, selected.latitude], zoom: 14, duration: 0 });
      return;
    }

    const spots: [number, number][] = shown.map((center) => [center.longitude, center.latitude]);
    // La ubicación sólo estira el encuadre cuando se ven todas las ciudades: si el
    // usuario pidió una en concreto, no tiene por qué salir el país entero.
    if (props.position && !city) spots.push([props.position.longitude, props.position.latitude]);
    if (spots.length === 0) return;

    if (spots.length === 1) {
      map.easeTo({ center: spots[0], zoom: 14, duration: 0 });
      return;
    }

    const lngs = spots.map(([lng]) => lng);
    const lats = spots.map(([, lat]) => lat);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 48, maxZoom: 15, duration: 0 },
    );
    // `frameKey` resume las entradas; enumerarlas aquí reencuadraría de más.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, frameKey]);

  if (points.length === 0) {
    return (
      <p className="empty">
        Los puntos publicados todavía no tienen coordenadas, así que no hay nada que dibujar.
      </p>
    );
  }

  return (
    <div className="map-scope">
      {cities.length > 1 && (
        <div className="map-cities" role="group" aria-label="Filtrar el mapa por ciudad">
          <button type="button" aria-pressed={city === ""} onClick={() => setCity("")}>
            Todas <i>{points.length}</i>
          </button>
          {cities.map((item) => (
            <button
              key={item.name}
              type="button"
              aria-pressed={city === item.name}
              onClick={() => setCity(item.name)}
            >
              {item.name} <i>{item.count}</i>
            </button>
          ))}
        </div>
      )}

      <div className="map-frame">
        <MapView ref={setMap} viewport={{ center: COLOMBIA, zoom: 5 }}>
          <MapControls position="bottom-right" showZoom showLocate showFullscreen />

          {props.position && (
            <MapMarker longitude={props.position.longitude} latitude={props.position.latitude}>
              <MarkerContent>
                <span className="map-me" aria-hidden="true" />
              </MarkerContent>
            </MapMarker>
          )}

          {marks.map(({ center, urgent, hands, pin }) => (
            <MapMarker key={center.id} longitude={center.longitude} latitude={center.latitude}>
              <MarkerContent>
                <span
                  className={`map-pin map-pin--${pin}${center.id === props.selectedId ? " on" : ""}`}
                  aria-hidden="true"
                >
                  {urgent > 0 && pin !== "sat" && <i>{urgent}</i>}
                </span>
              </MarkerContent>
              <MarkerPopup className="map-pop" closeButton>
                <strong>{center.name}</strong>
                {/* Hay puntos cuya dirección es sólo el nombre de la ciudad. */}
                <small>
                  {center.address.trim() === center.city.trim()
                    ? center.city
                    : `${center.address} · ${center.city}`}
                </small>
                {props.position && (
                  <small>A {formatDistance(distanceKm(props.position, center))} de ti</small>
                )}
                <p className={pin === "sat" ? "warn" : ""}>{PIN_TEXT[pin]}</p>
                {pin !== "sat" && (urgent > 0 || hands > 0) && (
                  <p>
                    {[
                      urgent > 0 ? `${urgent} productos urgentes` : "",
                      hands > 0 ? `faltan ${hands} personas` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {center.hours && <small>{center.hours}</small>}
                <a href={routeUrl(center)} target="_blank" rel="noreferrer">
                  Abrir ruta <UiIcon name="external" size={14} />
                </a>
                {props.onChoose && (
                  <button type="button" className="map-cta" onClick={() => props.onChoose?.(center)}>
                    {props.chooseLabel ?? "Elegir este punto"}
                  </button>
                )}
              </MarkerPopup>
            </MapMarker>
          ))}
        </MapView>
      </div>

      <ul className="map-legend">
        <li>
          <i className="map-dot map-pin--urgent" />
          Con productos urgentes
        </li>
        <li>
          <i className="map-dot map-pin--active" />
          Recibiendo ayuda
        </li>
        <li>
          <i className="map-dot map-pin--full" />
          Voluntarios completos
        </li>
        <li>
          <i className="map-dot map-pin--sat" />
          Saturado
        </li>
      </ul>
    </div>
  );
}
