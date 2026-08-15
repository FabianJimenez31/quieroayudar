import { proxyToFastApi } from "../proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyToFastApi(request, "coordination");
}

export async function POST(request: Request) {
  return proxyToFastApi(request, "coordination");
}

export async function PATCH(request: Request) {
  return proxyToFastApi(request, "coordination");
}
