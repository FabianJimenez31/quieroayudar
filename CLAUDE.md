# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Red de Apoyo (quieroayudar.co): coordinates humanitarian aid in Colombia. Connects donation/volunteer collection centers (`centers`) with donors and volunteers, tracking `needs` (with target/covered/committed quantities), time-limited `pledges` (commitments that expire and reopen the need if unfulfilled), `volunteer_requests`, and field `reports`. The core problem it solves is state visibility during an emergency — which center needs what, which is saturated, whether promised aid actually arrived.

Two independently deployed pieces in one repo:
- **`app/`** — FastAPI backend, the API of record.
- **`web/`** — Next/vinext PWA. Its `app/api/*` routes are a thin proxy to the FastAPI backend (see `web/app/api/proxy.ts`), preserving the same contract in the browser instead of re-implementing logic client-side.

In production both run behind Nginx (TLS termination + rate limiting; see `deploy/`), normally via Docker Compose (`compose.yaml`, `Dockerfile`, `web/web.Dockerfile`). Neither MySQL nor the app server is exposed directly to the internet.

## Commands

### Backend (`app/`)

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt   # includes requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m pytest -q                    # all tests
.venv/bin/python -m pytest tests/test_api.py::test_needs_batch_creates_updates_and_blocks -q  # single test
```

No `.env` is required for local dev: `Settings.database_url` defaults to `sqlite:///./red_apoyo.db`. MySQL (via `PyMySQL`) is only used in production, configured through `env.example`/`.env`. Tests (`tests/conftest.py`) force their own throwaway SQLite DB and set `COORDINATOR_CODE`/`CORS_ORIGINS` env vars before importing the app, so they never touch `.env`.

### Web (`web/`)

```bash
npm install
npm run dev      # vinext dev server, http://localhost:3000
npm run build    # verify the vinext build output
npm test         # build + node --test tests/rendered-html.test.mjs
npm run lint
```

To point the local PWA at a local API instead of production, set `API_BASE_URL` (e.g. `http://localhost:8000/v1`) — see `web/app/api/proxy.ts`. Without it, the proxy defaults to `https://api.quieroayudar.co/v1`.

## Backend architecture (`app/`)

- `config.py` — `Settings` (pydantic-settings), cached via `get_settings()`. `coordinator_code` gates destructive actions only.
- `database.py` — SQLAlchemy engine/session; `sqlite`/`mysql` selected purely by `database_url` scheme (see `connect_args`).
- `models.py` — five tables: `Center`, `Need`, `VolunteerRequest`, `Pledge`, `FieldReport`. All PKs are UUID strings. `Need.committed` tracks in-flight pledges separately from `covered` (what physically arrived).
- `schemas.py` — pydantic request models; `clean_text()` is the shared trim/truncate helper for free-text fields.
- `serializers.py` — `*_json()` functions are the only place ORM rows are converted to API responses (camelCase keys); always route new fields through here rather than serializing ad hoc.
- `main.py` — all routes live directly in this one file (no routers). Key patterns to preserve when adding endpoints:
  - **Publish vs. coordinate vs. destroy, three different trust levels.** Creating centers/needs/reports and pledging/volunteering is intentionally anonymous — no auth. `/v1/coordination` (the request desk for centers to manage their own needs/volunteer requests) is also open. Only *destructive* actions — closing/reopening a center, rejecting a field report — require `X-Coordinator-Code`, checked via `assert_coordinator()`/`coordinator_ok()`. `assert_coordinator` fails closed: if `COORDINATOR_CODE` isn't configured, destructive actions 503 rather than silently allow.
  - **Pledges expire and must reconcile correctly.** `clean_expired_pledges()` runs at the top of `GET /v1/network` (lazy expiry, no scheduler). When a delivery is recorded (`needs-received`), it must consume outstanding `Pledge` rows in order (oldest `expires_at` first) rather than just decrementing `committed`, or a later expiry would double-subtract and reopen capacity that was already delivered — see the comment in `main.py` around that action.
  - **Row locking on mutation.** Endpoints that mutate a row read it with `.with_for_update()` first (e.g. pledge creation, center status changes) to avoid races between concurrent donors/volunteers.
  - `migrate_centers_provenance()` runs at startup (`lifespan`) as a hand-rolled additive migration (no Alembic) — new nullable/defaulted columns on `centers` get added this way, guarded by checking `inspect(engine).get_columns(...)` first.
  - Error responses are normalized to `{"error": "..."}` via the `RequestValidationError`/`HTTPException` handlers — don't return FastAPI's default validation error shape.
  - `/health`'s `"database": "mysql"` field is a hardcoded label, not a live check of `database_url` — don't rely on it to detect which DB is actually in use.

## Web architecture (`web/`)

- Built on `vinext` (Cloudflare's Next-compatible framework) + Vite; not a plain Next.js app despite Next-shaped file conventions (`app/` router, `layout.tsx`, `manifest.ts`).
- `app/api/{network,centers,coordination}/route.ts` each call `proxyToFastApi()` (`app/api/proxy.ts`) — these routes intentionally contain no business logic, just forwarding + error normalization to `502` on upstream failure. Add new backend endpoints by adding another thin route here, not by duplicating request logic.
- `app/RedApoyoApp.tsx` is the main donor/volunteer-facing screen; `app/coordinar/` is the separate coordinator-facing surface (`CoordinatorApp.tsx`, bulk center import via `BulkCenters.tsx`/`centersImport.ts`/`spreadsheet.ts`).
- `app/CentersMap.tsx` / `CentersMapCanvas.tsx` use `maplibre-gl`; `components/ui/map.tsx` is the shared map primitive.
- `worker/index.ts` is the Cloudflare Worker entry (D1/R2 bindings declared in `.openai/hosting.json`, simulated locally by `vite.config.ts`); `examples/d1/` and `drizzle.config.ts` are unused starter scaffolding for D1 — this project doesn't currently use D1/Drizzle for its actual data (that's MySQL/SQLite via the FastAPI backend).
- `design-system/red-de-apoyo-colombia/MASTER.md` documents the color palette, typography (Montserrat), spacing, and component specs — check it before introducing new UI colors/components, and check for a page-specific override under `design-system/pages/` first.
- `PwaRegister.tsx` / `manifest.ts` handle installability/service worker; this is a real PWA, not just a responsive site.

## Data provenance

Initial Bogotá centers were imported from a public collaborative list via `scripts/import_centers.py` (idempotent, dedupes by normalized name+city and by proximity <150m; dry-run unless `--apply` is passed). Every center retains its `source_name`/`source_url`/`verified_at`. Preserve this provenance trail when touching center data — don't overwrite `source_*`/`verified_at` on updates that aren't a genuine re-verification.
