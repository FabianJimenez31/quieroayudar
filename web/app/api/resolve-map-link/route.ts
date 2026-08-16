import { parseCoordinates } from "../../coordinar/centersImport";
import { reverseGeocode } from "../geocode";

export const dynamic = "force-dynamic";

// Enlaces "compartidos" desde la app de Google Maps (maps.app.goo.gl, goo.gl/maps)
// no traen coordenadas en el texto: solo un redirect 3xx a la URL larga que sí las
// trae (con @lat,lng y, casi siempre, el nombre del lugar en /place/). Seguimos ese
// redirect en el servidor -evita el CORS que lo bloquearía desde el navegador- sin
// llegar a cargar la página, y completamos nombre/dirección/ciudad con Nominatim (OSM)
// cuando la URL no trae ya el nombre del lugar.
const ALLOWED_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "www.google.com", "google.com", "maps.google.com"]);

function isAllowed(url: URL) {
  return (url.protocol === "https:" || url.protocol === "http:") && ALLOWED_HOSTS.has(url.hostname);
}

function extractPlaceName(url: string): string | null {
  const match = /\/maps\/place\/([^/@]+)/.exec(url);
  if (!match) return null;
  const decoded = decodeURIComponent(match[1].replace(/\+/g, " ")).trim();
  return decoded || null;
}

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const target = incoming.searchParams.get("url") ?? "";

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return Response.json({ error: "Enlace inválido." }, { status: 400 });
  }
  if (!isAllowed(parsed)) {
    return Response.json({ error: "Solo se aceptan enlaces de Google Maps." }, { status: 400 });
  }

  try {
    let current = parsed;
    let resolved = current.toString();
    // Como mucho un puñado de saltos: los acortadores de Google resuelven en 1-2.
    for (let hop = 0; hop < 5; hop += 1) {
      const response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(5000),
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) {
        resolved = current.toString();
        break;
      }
      const next = new URL(location, current);
      if (!isAllowed(next)) {
        resolved = current.toString();
        break;
      }
      current = next;
      resolved = current.toString();
    }

    const coords = parseCoordinates(resolved);
    let name = extractPlaceName(resolved);
    let address: string | null = null;
    let city: string | null = null;
    if (coords) {
      const geocoded = await reverseGeocode(coords.latitude, coords.longitude);
      name = name ?? geocoded.name;
      address = geocoded.address;
      city = geocoded.city;
    }

    return Response.json(
      {
        url: resolved,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        name,
        address,
        city,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("resolve-map-link", error);
    return Response.json({ error: "No pudimos resolver el enlace." }, { status: 502 });
  }
}
