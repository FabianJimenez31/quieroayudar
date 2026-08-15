const FASTAPI_BASE = process.env.API_BASE_URL || "https://api.quieroayudar.co/v1";

export async function proxyToFastApi(request: Request, endpoint: "network" | "centers" | "coordination") {
  try {
    const incoming = new URL(request.url);
    const upstream = new URL(`${FASTAPI_BASE}/${endpoint}`);
    upstream.search = incoming.search;

    const headers = new Headers({ accept: "application/json" });
    const contentType = request.headers.get("content-type");
    const coordinatorCode = request.headers.get("x-coordinator-code");
    if (contentType) headers.set("content-type", contentType);
    if (coordinatorCode) headers.set("x-coordinator-code", coordinatorCode);

    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Unexpected upstream redirect (${response.status})`);
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error(`fastapi:${endpoint}`, error);
    return Response.json(
      { error: "El servicio operativo no está disponible. Intenta de nuevo." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
