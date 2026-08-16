import { reverseGeocode } from "../geocode";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const latitude = Number(incoming.searchParams.get("lat"));
  const longitude = Number(incoming.searchParams.get("lng"));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return Response.json({ error: "Coordenadas inválidas." }, { status: 400 });
  }

  try {
    const result = await reverseGeocode(latitude, longitude);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("reverse-geocode", error);
    return Response.json({ error: "No pudimos ubicar esa posición." }, { status: 502 });
  }
}
