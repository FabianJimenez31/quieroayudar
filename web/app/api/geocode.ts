const NOMINATIM_USER_AGENT = "QuieroAyudarCo/1.0 (https://quieroayudar.co)";

export type ReverseGeocodeResult = { name: string | null; address: string | null; city: string | null };

/** Geocodificación inversa contra Nominatim (OSM): sin API key, pero máximo ~1 req/s. */
export async function reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodeResult> {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    addressdetails: "1",
    "accept-language": "es",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
    headers: { "user-agent": NOMINATIM_USER_AGENT },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return { name: null, address: null, city: null };

  const data = (await response.json()) as { name?: string; address?: Record<string, string> };
  const a = data.address ?? {};
  const address = [a.road, a.house_number].filter(Boolean).join(" ").trim() || null;
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? null;
  return { name: data.name || null, address, city };
}
