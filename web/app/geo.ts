import type { Center, Position } from "./types";

/** Distancia en línea recta, suficiente para ordenar puntos y no para navegar. */
export function distanceKm(from: Position, center: Center) {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(center.latitude - from.latitude);
  const dLng = rad(center.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(from.latitude)) * Math.cos(rad(center.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(value: number) {
  return value < 1
    ? `${Math.max(50, Math.round((value * 1000) / 50) * 50)} m`
    : `${value.toFixed(value < 10 ? 1 : 0)} km`;
}

export function routeUrl(center: Center) {
  return `https://www.google.com/maps/dir/?api=1&destination=${center.latitude},${center.longitude}`;
}

/** Un punto sin coordenadas no se puede pintar: el mapa lo dejaría en el golfo de Guinea. */
export function hasCoordinates(center: Center) {
  return (
    Number.isFinite(center.latitude) &&
    Number.isFinite(center.longitude) &&
    (center.latitude !== 0 || center.longitude !== 0)
  );
}
