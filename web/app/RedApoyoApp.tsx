"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UiIcon, { type IconName } from "./UiIcon";
import { CATALOG, CATALOG_ITEMS } from "./catalog";
import CentersMap from "./CentersMap";
import HoaxesScreen from "./HoaxesScreen";
import InitiativesScreen from "./InitiativesScreen";
import { distanceKm, formatDistance, isApproximate, routeUrl } from "./geo";
import type {
  Center,
  FieldReport,
  Level,
  Need,
  Network,
  Position,
  VolunteerRequest,
} from "./types";

/* ─────────────────────────── Tipos ─────────────────────────── */

type Role = "afectado" | "acopio" | "logistica" | "donante";

type Screen =
  | "roles"
  | "tutorial"
  | "afectado"
  | "acopio"
  | "productos"
  | "recibido"
  | "manos"
  | "saturado"
  | "personas"
  | "logistica"
  | "donante"
  | "donar"
  | "iniciativas"
  | "bulos"
  | "done";

type DoneKind = "productos" | "recibido" | "manos" | "saturado" | "donar" | "voluntario";


/** Lo que el donante se comprometió a llevar. Se guarda para que no se pierda al cerrar. */
type Commitment = {
  reference: string;
  expiresAt: string;
  quantity: number;
  unit: string;
  name: string;
  center: string;
};

type RouteHint = { name: string; address: string; url: string };

const EMPTY: Network = { centers: [], needs: [], volunteerRequests: [], reports: [] };

/** Sigla de dos letras para la ficha de cada tarea, como en el diseño. */
function initials(label: string): string {
  const words = label.split(/\s+/).filter((word) => word.length > 2);
  const first = words[0]?.[0] ?? label[0] ?? "";
  const second = words[1]?.[0] ?? words[0]?.[1] ?? "";
  return (first + second).toUpperCase();
}

/** "hace 12 min" — el diseño fecha cada reporte para saber si sigue vigente. */
function since(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

/**
 * Cada pantalla tiene su propia entrada de historial. Sin esto, el botón atrás de Android
 * cierra la PWA instalada en vez de retroceder, y entrar a una pantalla sin `vista`
 * destruía el enlace con el que había llegado el usuario.
 */
const SCREEN_QUERY: Record<Screen, string> = {
  roles: "",
  tutorial: "como-funciona",
  afectado: "afectado",
  acopio: "acopio",
  productos: "productos",
  recibido: "recibido",
  manos: "manos",
  saturado: "saturacion",
  personas: "emergencia",
  logistica: "voluntariado",
  donante: "donar",
  donar: "comprometer",
  iniciativas: "iniciativas-empresas",
  bulos: "noticias-falsas",
  done: "listo",
};

const SCREEN_BY_QUERY = new Map(
  (Object.entries(SCREEN_QUERY) as [Screen, string][])
    .filter(([, query]) => query)
    .map(([screen, query]) => [query, screen] as const),
);

const ROLE_SCREENS: Role[] = ["afectado", "acopio", "logistica", "donante"];

function urlForScreen(next: Screen) {
  const query = SCREEN_QUERY[next];
  return query ? `/?vista=${query}` : "/";
}


const HAND_OPTIONS = [
  { id: "Remoción de escombros", detail: "Fuerza física, palas y cascos" },
  { id: "Asistencia médica", detail: "Medicina, enfermería o primeros auxilios" },
  { id: "Clasificación y carga", detail: "Organizar, cargar y repartir donaciones" },
  { id: "Cocina y reparto", detail: "Preparar y entregar alimentos" },
  { id: "Conductores con vehículo", detail: "Traslado de personas o suministros" },
  { id: "Apoyo veterinario", detail: "Animales heridos o extraviados" },
];

const SATURATION_OPTIONS = [
  { id: "Demasiadas personas", detail: "Ya hay suficientes voluntarios en el punto" },
  { id: "Acceso cerrado", detail: "La vía no permite el ingreso de personas o vehículos" },
  { id: "Riesgo en el lugar", detail: "Hay riesgo estructural, incendio u otra amenaza" },
];

const ROLES: { id: Role; code: string; title: string; text: string }[] = [
  { id: "afectado", code: "PA", title: "Estoy en una zona afectada", text: "Reporto productos, manos o saturación" },
  { id: "acopio", code: "AC", title: "Atiendo un centro de acopio", text: "Publico qué necesitamos y cuánto" },
  { id: "logistica", code: "LG", title: "Puedo ofrecer manos", text: "Voy donde falta apoyo logístico" },
  { id: "donante", code: "DN", title: "Quiero donar", text: "Veo qué se necesita ahora mismo" },
];

/* ────────────────────────── Utilidades ────────────────────────── */

function remainingOf(need: Need) {
  return Math.max(0, need.target - need.covered - need.committed);
}

/** Para buscar sin que estorben tildes ni mayúsculas: nadie escribe "Quibdó" con tilde. */
const norm = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Caja de búsqueda de la app. Aparece donde una lista puede crecer sin límite. */
function SearchBox(props: { value: string; onValue: (value: string) => void; label: string; icon?: IconName }) {
  return (
    <label className="search-box">
      <UiIcon name={props.icon ?? "location"} size={18} />
      <input
        type="search"
        value={props.value}
        placeholder={props.label}
        aria-label={props.label}
        onChange={(event) => props.onValue(event.target.value)}
      />
    </label>
  );
}

/** Filtro por ciudad en una fila que se desliza. Vacío = todas. */
function CityChips(props: { cities: string[]; value: string; onValue: (value: string) => void }) {
  if (props.cities.length < 2) return null;
  return (
    <div className="chips scroll">
      <button type="button" className={`chip${props.value === "" ? " on" : ""}`} onClick={() => props.onValue("")}>
        Todas
      </button>
      {props.cities.map((city) => (
        <button
          key={city}
          type="button"
          className={`chip${props.value === city ? " on" : ""}`}
          onClick={() => props.onValue(city)}
        >
          {city}
        </button>
      ))}
    </div>
  );
}

function routeFor(center: Center): RouteHint {
  return { name: center.name, address: `${center.address} · ${center.city}`, url: routeUrl(center) };
}

function hourOf(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function stillValid(commitment: Commitment | null) {
  if (!commitment) return false;
  if (!commitment.expiresAt) return true;
  const date = new Date(commitment.expiresAt);
  return Number.isNaN(date.getTime()) || date.getTime() > Date.now();
}

/**
 * Agrupa centros por ciudad. Con ubicación activa, la ciudad más cercana va primero
 * y dentro de cada una manda la distancia; sin ubicación, orden alfabético.
 */
function groupByCity(centers: Center[], position: Position | null) {
  const byCity = new Map<string, Center[]>();
  for (const center of centers) {
    const city = center.city.trim() || "Sin ciudad";
    const bucket = byCity.get(city);
    if (bucket) bucket.push(center);
    else byCity.set(city, [center]);
  }

  const blocks = Array.from(byCity, ([city, list]) => {
    const sorted = [...list].sort((a, b) =>
      position ? distanceKm(position, a) - distanceKm(position, b) : a.name.localeCompare(b.name, "es"),
    );
    return {
      city,
      centers: sorted,
      nearest: position ? distanceKm(position, sorted[0]) : Number.POSITIVE_INFINITY,
    };
  });

  blocks.sort((a, b) => (position ? a.nearest - b.nearest : a.city.localeCompare(b.city, "es")));
  return blocks;
}

/** Cuánta ayuda le falta a un centro, para ordenar por necesidad y no por cercanía. */
function urgencyScore(center: Center, needs: Need[], requests: VolunteerRequest[]) {
  const missingGoods = needs.filter(
    (need) => need.centerId === center.id && need.status === "urgent" && remainingOf(need) > 0,
  ).length;
  // Un centro que ya declaró tener suficientes voluntarios no debe puntuar por manos:
  // si no, encabeza "¿Dónde hago falta?" con una tarjeta sin nada que hacer.
  const missingHands = center.volunteersSaturated
    ? 0
    : requests
        .filter((item) => item.centerId === center.id && item.status === "open")
        .reduce((sum, item) => sum + Math.max(0, item.quantity - item.accepted), 0);
  return missingGoods * 10 + missingHands;
}

/**
 * El pulso de la red: lo que el home enseña de un vistazo.
 *
 * Todo sale de `/api/network`, sin llamadas nuevas. Con ubicación activa manda la
 * cercanía; sin ella, lo que más falta. Cada lista se corta a tres: el home informa
 * para que la gente elija rol, no sustituye a las pantallas de cada rol.
 */
function buildPulse(network: Network, position: Position | null) {
  const byId = new Map(network.centers.map((center) => [center.id, center]));
  const open = (center?: Center) => center && center.status === "active";
  const near = (center: Center) => (position ? distanceKm(position, center) : Number.POSITIVE_INFINITY);

  const missing = network.needs
    .map((need) => ({ need, center: byId.get(need.centerId), missing: remainingOf(need) }))
    .filter((row) => row.missing > 0 && row.need.status !== "blocked" && open(row.center))
    .sort((a, b) =>
      position
        ? near(a.center as Center) - near(b.center as Center)
        : (a.need.status === "urgent" ? 0 : 1) - (b.need.status === "urgent" ? 0 : 1) || b.missing - a.missing,
    ) as { need: Need; center: Center; missing: number }[];

  const requests = network.volunteerRequests
    .map((request) => ({ request, center: byId.get(request.centerId) }))
    .filter((row) => open(row.center)) as { request: VolunteerRequest; center: Center }[];

  const working = requests
    .filter((row) => row.request.accepted > 0)
    .sort((a, b) => b.request.accepted - a.request.accepted);

  const wanted = requests
    .map((row) => ({ ...row, missing: Math.max(0, row.request.quantity - row.request.accepted) }))
    .filter((row) => row.missing > 0 && row.request.status === "open")
    .sort((a, b) => (position ? near(a.center) - near(b.center) : b.missing - a.missing));

  // Lo entregado solo cuenta lo que un centro confirmó haber recibido. Lo prometido
  // se muestra aparte a propósito: una promesa todavía no es una caja en el suelo.
  const delivered = network.needs.reduce((sum, need) => sum + need.covered, 0);
  const promised = network.needs.reduce((sum, need) => sum + need.committed, 0);
  const goal = network.needs.reduce((sum, need) => sum + need.target, 0);

  return {
    centers: network.centers.filter((center) => center.status === "active").length,
    cities: new Set(network.centers.map((center) => center.city.trim()).filter(Boolean)).size,
    hands: working.reduce((sum, row) => sum + row.request.accepted, 0),
    delivered,
    promised,
    goal,
    urgent: missing.filter((row) => row.need.status === "urgent").length,
    handsWanted: wanted.reduce((sum, row) => sum + row.missing, 0),
    missing: missing.slice(0, 3),
    working: working.slice(0, 3),
    wanted: wanted.slice(0, 3),
  };
}

type Pulse = ReturnType<typeof buildPulse>;

/* ────────────────────────── Componente ────────────────────────── */

export default function RedApoyoApp() {
  const [screen, setScreen] = useState<Screen>("roles");
  const [role, setRole] = useState<Role | null>(null);
  const [myCenterId, setMyCenterId] = useState("");
  const [network, setNetwork] = useState<Network>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  // Vive aquí y no en la pantalla de puntos para que el acceso directo del inicio
  // pueda abrirla directamente en mapa, sin obligar a tocar el interruptor.
  const [pointsView, setPointsView] = useState<"lista" | "mapa">("lista");

  const [city, setCity] = useState("");
  const [reference, setReference] = useState("");
  const [levels, setLevels] = useState<Record<string, Level>>({});
  const [targets, setTargets] = useState<Record<string, number>>({});
  // Con qué rol y sitio se llenó la lista, para no rehacerla al volver atrás.
  const [productsContext, setProductsContext] = useState("");
  const [received, setReceived] = useState<Record<string, number>>({});
  const [handKind, setHandKind] = useState(HAND_OPTIONS[0].id);
  const [handQuantity, setHandQuantity] = useState(6);
  const [saturationReason, setSaturationReason] = useState(SATURATION_OPTIONS[0].id);
  const [pledgeNeedId, setPledgeNeedId] = useState("");
  const [pledgeQuantity, setPledgeQuantity] = useState(4);
  const [doneKind, setDoneKind] = useState<DoneKind>("productos");
  const [doneBody, setDoneBody] = useState("");
  const [doneNote, setDoneNote] = useState("");
  const [doneRoute, setDoneRoute] = useState<RouteHint | null>(null);
  const [pledge, setPledge] = useState<Commitment | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const sync = useCallback(async () => {
    try {
      const response = await fetch("/api/network", { cache: "no-store" });
      const data = (await response.json()) as Network & { error?: string };
      if (!response.ok) throw new Error(data.error || "No pudimos sincronizar la red.");
      const centers = data.centers ?? [];
      setNetwork({
        centers,
        needs: data.needs ?? [],
        volunteerRequests: data.volunteerRequests ?? [],
        reports: data.reports ?? [],
      });
      setError("");
      // Un centro cerrado desaparece de /api/network. Si el guardado ya no resuelve,
      // se suelta aquí: si no, se sigue publicando a un centro que nadie ve.
      setMyCenterId((current) => {
        if (!current || centers.some((center) => center.id === current)) return current;
        window.localStorage.removeItem("ra.center");
        flash("Tu centro ya no está activo. Elige otro.");
        return "";
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No pudimos sincronizar la red.");
    } finally {
      setLoading(false);
    }
  }, [flash]);

  /*
   * Estos dos efectos sincronizan con sistemas externos al montar: la red y
   * localStorage. Ninguno existe durante el render en el servidor, así que leerlos
   * antes provocaría un desajuste de hidratación. La regla los marca igualmente.
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { void sync(); }, [sync]);

  // Rol, centro y ciudad se recuerdan para no repetir la pregunta en cada visita.
  useEffect(() => {
    const savedRole = window.localStorage.getItem("ra.role") as Role | null;
    const savedCenter = window.localStorage.getItem("ra.center") ?? "";
    const savedCity = window.localStorage.getItem("ra.city") ?? "";
    if (savedCity) setCity(savedCity);
    if (savedCenter) setMyCenterId(savedCenter);

    const savedPledge = window.localStorage.getItem("ra.pledge");
    if (savedPledge) {
      try {
        const parsed = JSON.parse(savedPledge) as Commitment;
        if (stillValid(parsed)) setPledge(parsed);
        else window.localStorage.removeItem("ra.pledge");
      } catch {
        window.localStorage.removeItem("ra.pledge");
      }
    }

    const known = savedRole && ROLES.some((item) => item.id === savedRole) ? savedRole : null;
    if (known) setRole(known);

    const query = new URLSearchParams(window.location.search).get("vista");
    const linked = query ? SCREEN_BY_QUERY.get(query) : undefined;
    // Un enlace compartido manda: abre esa pantalla. Pero entrar por la raíz lleva
    // siempre al inicio. Antes el rol guardado secuestraba la entrada y el estado de la
    // red quedaba inalcanzable para cualquiera que hubiese elegido rol alguna vez.
    const target: Screen =
      linked && (ROLE_SCREENS.includes(linked as Role) || known) ? linked : "roles";
    if (ROLE_SCREENS.includes(target as Role)) {
      setRole(target as Role);
      window.localStorage.setItem("ra.role", target);
    }
    setScreen(target);
    window.history.replaceState({ screen: target }, "", urlForScreen(target));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  /*
   * La red cambia mientras la app está abierta: metas que bajan, centros que se
   * saturan, manos que se cubren. Se refresca sola cada 45 s con la pestaña a la
   * vista, y al volver a ella, para que nadie salga con datos de hace una hora.
   */
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void sync(); };
    const timer = setInterval(tick, 45_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [sync]);

  // El botón atrás del sistema recorre las pantallas en vez de cerrar la PWA.
  useEffect(() => {
    function onPop(event: PopStateEvent) {
      const fromState = (event.state as { screen?: Screen } | null)?.screen;
      const query = new URLSearchParams(window.location.search).get("vista");
      setScreen(fromState ?? (query ? SCREEN_BY_QUERY.get(query) ?? "roles" : "roles"));
      setToast("");
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: Screen) => {
    setScreen(next);
    setToast("");
    window.history.pushState({ screen: next }, "", urlForScreen(next));
  }, []);

  function chooseRole(next: Role) {
    setRole(next);
    window.localStorage.setItem("ra.role", next);
    navigate(next);
  }

  function clearRole() {
    setRole(null);
    window.localStorage.removeItem("ra.role");
    // Lo que se llenó bajo el rol anterior no puede sobrevivir al cambio.
    setLevels({});
    setTargets({});
    setProductsContext("");
    setPledgeNeedId("");
    navigate("roles");
  }

  function chooseCenter(id: string) {
    setMyCenterId(id);
    window.localStorage.setItem("ra.center", id);
    setProductsContext("");
  }

  /** Un toque equivocado no puede atar el dispositivo a ese centro para siempre. */
  function forgetCenter() {
    setMyCenterId("");
    window.localStorage.removeItem("ra.center");
    setLevels({});
    setTargets({});
    setProductsContext("");
  }

  function updateCity(value: string) {
    setCity(value);
    window.localStorage.setItem("ra.city", value);
  }

  const myCenter = useMemo(
    () => network.centers.find((center) => center.id === myCenterId),
    [network.centers, myCenterId],
  );

  // Se declara aquí, y no con el resto de datos derivados, porque el CTA lo consulta
  // antes: leerlo más tarde reventaría en tiempo de ejecución.
  const myNeeds = useMemo(
    () => (myCenter ? network.needs.filter((need) => need.centerId === myCenter.id) : []),
    [network.needs, myCenter],
  );

  const pulse = useMemo(() => buildPulse(network, position), [network, position]);

  /**
   * Abre la lista de productos partiendo de lo ya publicado. Solo se reconstruye si
   * cambió el contexto: volver atrás a corregir la ciudad no puede borrar las marcas.
   * El centro solo aplica al rol acopio; en otros roles precargaría datos ajenos.
   */
  const openProducts = useCallback(() => {
    if (role === "afectado" && !city.trim()) {
      flash("Primero indica la ciudad o municipio.");
      navigate("afectado");
      return;
    }
    const centerId = role === "acopio" ? myCenterId : "";
    const context = `${role ?? ""}:${centerId || city.trim().toLowerCase()}`;
    if (context !== productsContext) {
      const nextLevels: Record<string, Level> = {};
      const nextTargets: Record<string, number> = {};
      for (const item of CATALOG_ITEMS) {
        const published = centerId
          ? network.needs.find(
              (need) => need.centerId === centerId && need.name.toLowerCase() === item.name.toLowerCase(),
            )
          : undefined;
        nextLevels[item.name] = published ? published.status : "normal";
        nextTargets[item.name] = published ? published.target : item.start;
      }
      setLevels(nextLevels);
      setTargets(nextTargets);
      setProductsContext(context);
    }
    navigate("productos");
  }, [role, city, myCenterId, productsContext, network.needs, flash, navigate]);

  function locate() {
    if (!("geolocation" in navigator)) {
      flash("Este dispositivo no permite compartir ubicación.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setPosition({ latitude: result.coords.latitude, longitude: result.coords.longitude });
        setLocating(false);
        flash("Ubicación activada. Ordenamos por cercanía.");
      },
      () => {
        setLocating(false);
        flash("No pudimos acceder a tu ubicación.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  const gpsLabel = position ? `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}` : "";

  type SendResult = { ok: boolean; status: number; data: Record<string, unknown> };

  /** Devuelve el cuerpo: el compromiso de donación necesita la referencia y el vencimiento. */
  async function send(url: string, method: "POST" | "PATCH", body: unknown): Promise<SendResult> {
    setBusy(true);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        flash(typeof data.error === "string" ? data.error : "No pudimos guardar el cambio.");
        return { ok: false, status: response.status, data };
      }
      return { ok: true, status: response.status, data };
    } catch {
      flash("No pudimos guardar el cambio. Revisa tu conexión.");
      return { ok: false, status: 0, data: {} };
    } finally {
      setBusy(false);
    }
  }

  function finish(kind: DoneKind, body: string, note = "") {
    setDoneKind(kind);
    setDoneBody(body);
    setDoneNote(note);
    navigate("done");
    void sync();
  }

  /* ───────── Acciones ───────── */

  const urgentCount = CATALOG_ITEMS.filter((item) => levels[item.name] === "urgent").length;
  const blockedCount = CATALOG_ITEMS.filter((item) => levels[item.name] === "blocked").length;

  function fieldPlace() {
    return reference.trim() || gpsLabel || city.trim();
  }

  /** Manda al hub cuando falta la ciudad, en vez de perder lo que ya se llenó. */
  function missingCity() {
    if (city.trim()) return false;
    flash("Primero indica la ciudad o municipio.");
    navigate("afectado");
    return true;
  }

  function openReceived() {
    if (!myCenter) { flash("Elige primero tu centro de acopio."); return; }
    setReceived({});
    navigate("recibido");
  }

  async function submitReceived() {
    if (!myCenter) { flash("Elige primero tu centro de acopio."); return; }
    const lines = myNeeds
      .filter((need) => (received[need.name] ?? 0) > 0)
      .map((need) => ({ name: need.name, quantity: received[need.name] }));
    if (!lines.length) { flash("Indica cuánto llegó de al menos un producto."); return; }

    const result = await send("/api/coordination", "POST", {
      action: "needs-received",
      centerId: myCenter.id,
      received: lines,
    });
    if (!result.ok) return;
    const total = lines.reduce((sum, line) => sum + line.quantity, 0);
    setReceived({});
    finish("recibido", `${total} unidades registradas en ${myCenter.name}.`, "La meta baja para todos: los donantes ya ven lo que falta.");
  }

  async function submitProducts() {
    if (role === "acopio") {
      if (!myCenter) { flash("Elige primero tu centro de acopio."); return; }
      const published = new Set(
        network.needs.filter((need) => need.centerId === myCenter.id).map((need) => need.name.toLowerCase()),
      );
      // Solo se publica lo marcado. "Se necesita" viaja únicamente si ya existía,
      // para poder bajarlo de urgente sin inundar la lista de los donantes.
      const products = CATALOG_ITEMS.filter((item) => {
        const level = levels[item.name];
        if (!level) return false;
        return level !== "normal" || published.has(item.name.toLowerCase());
      }).map((item) => ({
        name: item.name,
        unit: item.unit,
        status: levels[item.name],
        target: Math.max(1, targets[item.name] ?? item.start),
      }));
      if (!products.length) { flash("Marca al menos un producto como urgente o suficiente."); return; }
      const result = await send("/api/coordination", "POST", {
        action: "needs-batch",
        centerId: myCenter.id,
        products,
      });
      if (!result.ok) return;
      // Se cuenta lo que el servidor guardó, no lo que se marcó en pantalla: una línea
      // "Ya hay" sobre un producto nunca publicado se descarta y no debe contarse.
      const saved = Number(result.data.created ?? 0) + Number(result.data.updated ?? 0);
      setProductsContext("");
      finish("productos", `${saved} productos actualizados en ${myCenter.name}.`);
      return;
    }

    if (missingCity()) return;
    const touched = CATALOG_ITEMS.filter((item) => levels[item.name] && levels[item.name] !== "normal");
    if (!touched.length) { flash("Marca al menos un producto como urgente o suficiente."); return; }
    const labels: Record<Level, string> = { urgent: "URGENTE", normal: "SE NECESITA", blocked: "YA HAY" };
    const details = `Estado de productos: ${touched
      .map((item) => `${item.name} [${labels[levels[item.name]]}]`)
      .join("; ")}.`;
    const result = await send("/api/network", "POST", {
      action: "report",
      category: "products",
      city: city.trim(),
      location: fieldPlace(),
      details,
    });
    if (!result.ok) return;
    setProductsContext("");
    finish("productos", `${urgentCount} productos urgentes reportados en ${city.trim()}.`);
  }

  async function submitHands() {
    const option = HAND_OPTIONS.find((item) => item.id === handKind) ?? HAND_OPTIONS[0];
    if (role === "acopio") {
      if (!myCenter) { flash("Elige primero tu centro de acopio."); return; }
      const result = await send("/api/coordination", "POST", {
        action: "volunteer-request",
        centerId: myCenter.id,
        kind: option.id,
        detail: option.detail,
        quantity: handQuantity,
      });
      if (result.ok) finish("manos", `${handQuantity} personas solicitadas para ${option.id.toLowerCase()}.`);
      return;
    }
    if (missingCity()) return;
    const result = await send("/api/network", "POST", {
      action: "report",
      category: "hands",
      city: city.trim(),
      location: fieldPlace(),
      details: `Se solicitan ${handQuantity} personas para ${option.id}. ${option.detail}.`,
    });
    if (result.ok) {
      finish("manos", `${handQuantity} personas solicitadas para ${option.id.toLowerCase()} en ${city.trim()}.`);
    }
  }

  /** Marca o quita la saturación del propio centro. Debe poder ir en los dos sentidos. */
  async function setCenterSaturated(next: boolean) {
    if (!myCenter) { flash("Elige primero tu centro de acopio."); return false; }
    const previous = myCenter.status;
    patchMyCenter({ status: next ? "saturated" : "active" });
    const result = await send("/api/centers", "PATCH", {
      id: myCenter.id,
      status: next ? "saturated" : "active",
    });
    if (result.ok) void sync();
    else patchMyCenter({ status: previous });
    return result.ok;
  }

  async function submitSaturation() {
    const option = SATURATION_OPTIONS.find((item) => item.id === saturationReason) ?? SATURATION_OPTIONS[0];
    if (role === "acopio") {
      if (!myCenter) { flash("Elige primero tu centro de acopio."); return; }
      if (!(await setCenterSaturated(true))) return;
      // El motivo también se publica: sin esto, logística ve un centro cerrado sin saber por qué.
      await send("/api/network", "POST", {
        action: "report",
        category: "saturation",
        city: myCenter.city,
        location: myCenter.name,
        details: `Punto saturado: ${option.id}. ${option.detail}.`,
      });
      finish(
        "saturado",
        `${myCenter.name} dejó de aparecer como destino sugerido. Motivo: ${option.id.toLowerCase()}.`,
        "Quítalo desde el interruptor del inicio cuando baje la afluencia.",
      );
      return;
    }
    if (missingCity()) return;
    const result = await send("/api/network", "POST", {
      action: "report",
      category: "saturation",
      city: city.trim(),
      location: fieldPlace(),
      details: `Punto saturado: ${option.id}. ${option.detail}.`,
    });
    if (result.ok) {
      finish("saturado", `Alerta publicada para ${city.trim()}. Estamos redirigiendo a los puntos con menos cobertura.`);
    }
  }

  async function submitPledge() {
    const need = network.needs.find((item) => item.id === pledgeNeedId);
    if (!need) { flash("Esa necesidad ya no está disponible."); navigate("donante"); return; }
    const center = network.centers.find((item) => item.id === need.centerId);
    const result = await send("/api/network", "POST", {
      action: "pledge",
      needId: need.id,
      quantity: pledgeQuantity,
    });
    if (!result.ok) {
      // 409: la meta cambió mientras el usuario decidía, así que los números en
      // pantalla ya no valen y reintentar aquí fallaría siempre.
      if (result.status === 409) { await sync(); navigate("donante"); }
      return;
    }
    const nextPledge: Commitment = {
      reference: typeof result.data.reference === "string" ? result.data.reference : "",
      expiresAt: typeof result.data.expiresAt === "string" ? result.data.expiresAt : "",
      quantity: pledgeQuantity,
      unit: need.unit,
      name: need.name,
      center: center?.name ?? "",
    };
    window.localStorage.setItem("ra.pledge", JSON.stringify(nextPledge));
    setPledge(nextPledge);
    setDoneRoute(center ? routeFor(center) : null);
    finish(
      "donar",
      `${pledgeQuantity} ${need.unit} de ${need.name.toLowerCase()} para ${center?.name ?? "el centro"}.`,
      nextPledge.reference
        ? `Referencia ${nextPledge.reference}${nextPledge.expiresAt ? ` · el cupo se libera solo a las ${hourOf(nextPledge.expiresAt)}` : ""}.`
        : "",
    );
  }

  async function acceptRequest(item: VolunteerRequest) {
    const center = network.centers.find((entry) => entry.id === item.centerId);
    const result = await send("/api/network", "POST", { action: "volunteer", requestId: item.id, quantity: 1 });
    if (!result.ok) {
      if (result.status === 409) await sync();
      return;
    }
    // La dirección y la ruta se conservan: sin esto el voluntario acepta y pierde el destino.
    setDoneRoute(center ? routeFor(center) : null);
    finish("voluntario", `Te esperan en ${center?.name ?? "el centro"} para ${item.kind.toLowerCase()}.`);
  }

  /**
   * Los interruptores del centro se pintan antes de que responda el servidor: el
   * gesto se siente instantáneo y, si falla, la vista vuelve sola a la verdad.
   */
  function patchMyCenter(change: Partial<Center>) {
    if (!myCenter) return;
    const centerId = myCenter.id;
    setNetwork((current) => ({
      ...current,
      centers: current.centers.map((item) => (item.id === centerId ? { ...item, ...change } : item)),
    }));
  }

  async function toggleVolunteers() {
    if (!myCenter) return;
    const next = !myCenter.volunteersSaturated;
    patchMyCenter({ volunteersSaturated: next });
    flash(next ? "Los voluntarios nuevos verán otros centros." : "Vuelves a aparecer para voluntarios.");
    const result = await send("/api/centers", "PATCH", { id: myCenter.id, volunteersSaturated: next });
    // Éxito o error, la red manda: al sincronizar se confirma o se deshace.
    void sync();
    if (!result.ok) patchMyCenter({ volunteersSaturated: !next });
  }
  /* ───────── Navegación ───────── */

  const home: Screen = role ?? "roles";

  // Delegar en el historial mantiene coherente la flecha de la app con el atrás del sistema.
  function goBack() {
    setToast("");
    window.history.back();
  }

  // El subtítulo de la pantalla de compromiso nombra el producto, así que la
  // necesidad hay que resolverla antes de armar las cabeceras.
  const pledgeNeedName = network.needs.find((need) => need.id === pledgeNeedId)?.name ?? "";

  const HEADERS: Partial<Record<Screen, [string, string]>> = {
    afectado: ["Zona afectada", "Tus reportes se publican al instante"],
    acopio: [
      myCenter?.name ?? "Centro de acopio",
      myCenter ? `${myCenter.address} · ${myCenter.city}` : "Elige tu centro",
    ],
    tutorial: ["Cómo funciona", "Cuatro caminos, ninguno pide registro"],
    productos: ["Productos", role === "acopio" ? "Marca estado y meta" : "Marca el estado de cada uno"],
    done: ["Listo", "Guarda la referencia"],
    recibido: ["Registrar lo que llegó", myCenter?.name ?? "Elige tu centro"],
    manos: ["Pedir manos", "Una tarea por solicitud"],
    saturado: ["Reportar saturación", role === "acopio" ? myCenter?.name ?? "Elige tu centro" : city || "Zona afectada"],
    personas: ["Persona herida", "Atención de emergencias"],
    logistica: [
      "Dónde faltan manos",
      "Ordenado por necesidad, no por cercanía",
    ],
    donante: ["Se necesita ahora", "Urgencia primero, luego cercanía"],
    donar: ["Comprometer donación", pledgeNeedName || "Reserva por 6 horas"],
    iniciativas: ["Empresas que donan", "Cada botón lleva al canal oficial"],
    bulos: ["Noticias falsas", "Verificadas y desmentidas"],
  };
  const header = HEADERS[screen];

  const pledgeNeed = network.needs.find((need) => need.id === pledgeNeedId);

  const CTA_LABELS: Partial<Record<Screen, string>> = {
    productos: role === "acopio" ? "Publicar lista" : "Publicar reporte",
    recibido: myNeeds.length > 0 ? "Registrar entrega" : undefined,
    manos: "Enviar solicitud",
    saturado: role === "acopio" ? "Marcar mi centro como saturado" : "Publicar alerta",
    // Sin necesidad no hay nada que comprometer: un botón inerte es peor que ninguno.
    donar: pledgeNeed ? "Comprometer donación" : undefined,
  };
  const cta = CTA_LABELS[screen];

  function runCta() {
    if (screen === "productos") void submitProducts();
    else if (screen === "recibido") void submitReceived();
    else if (screen === "manos") void submitHands();
    else if (screen === "saturado") void submitSaturation();
    else if (screen === "donar") void submitPledge();
    else if (screen === "done") navigate(home);
  }

  const tabs: { label: string; icon: IconName; target: Screen }[] =
    role === "donante"
      ? [
          { label: "Urgente", icon: "alert", target: "donante" },
          { label: "Acopios", icon: "building", target: "logistica" },
          { label: "Empresas", icon: "reports", target: "iniciativas" },
          { label: "Yo", icon: "users", target: "roles" },
        ]
      : role === "logistica"
        ? [
            { label: "Puntos", icon: "location", target: "logistica" },
            { label: "Urgente", icon: "alert", target: "donante" },
            { label: "Yo", icon: "users", target: "roles" },
          ]
        : [
            { label: "Inicio", icon: "home", target: home },
            { label: "Productos", icon: "package", target: "productos" },
            { label: "Yo", icon: "users", target: "roles" },
          ];

  // El rediseño navega solo con el botón atrás de la cabecera, sin barra inferior.
  const showTabs = false;

  /* ───────── Datos derivados ───────── */

  const activeNeeds = useMemo(() => {
    const byId = new Map(network.centers.map((center) => [center.id, center]));
    return network.needs.filter(
      (need) => need.status !== "blocked" && byId.get(need.centerId)?.status === "active" && remainingOf(need) > 0,
    );
  }, [network]);

  const sortedCenters = useMemo(() => {
    // Primero los que reciben ayuda, luego los que ya tienen bastantes voluntarios,
    // y al final los saturados. Dentro de cada grupo manda la necesidad real.
    const rank = (center: Center) =>
      center.status === "saturated" ? 2 : center.volunteersSaturated ? 1 : 0;
    const list = [...network.centers];
    list.sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      const byNeed =
        urgencyScore(b, network.needs, network.volunteerRequests) -
        urgencyScore(a, network.needs, network.volunteerRequests);
      if (byNeed !== 0) return byNeed;
      if (position) return distanceKm(position, a) - distanceKm(position, b);
      return a.name.localeCompare(b.name, "es");
    });
    return list;
  }, [network, position]);

  const knownCities = useMemo(
    () => Array.from(new Set(network.centers.map((center) => center.city))).sort((a, b) => a.localeCompare(b, "es")),
    [network.centers],
  );

  /* ───────── Render ───────── */

  return (
    <div className="phone">
      <a className="skip-link" href="#pantalla">Saltar al contenido</a>

      {header && (
        <header className="screen-head">
          <button type="button" onClick={goBack} aria-label="Volver">
            <UiIcon name="arrow-left" size={22} />
          </button>
          <div>
            <strong>{header[0]}</strong>
            <small>{header[1]}</small>
          </div>
          <button
            type="button"
            onClick={locate}
            disabled={locating}
            aria-label={position ? "Ubicación activa" : "Usar mi ubicación"}
            className={position ? "on" : ""}
          >
            <UiIcon name="location" size={20} />
          </button>
        </header>
      )}

      <main className="screen" id="pantalla" tabIndex={-1} key={screen}>
        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void sync()}>Reintentar</button>
          </div>
        )}

        {screen === "roles" && (
          <HomeScreen
            pulse={pulse}
            position={position}
            role={role}
            onPick={chooseRole}
            onTutorial={() => navigate("tutorial")}
            onHoaxes={() => navigate("bulos")}
            onInitiatives={() => navigate("iniciativas")}
            onMap={() => {
              setPointsView("mapa");
              navigate("logistica");
            }}
            onNeeds={() => navigate("donante")}
            onEmergency={() => navigate("personas")}
          />
        )}

        {screen === "tutorial" && <TutorialScreen onPick={chooseRole} />}

        {screen === "recibido" && (
          <ReceivedScreen
            needs={myNeeds}
            amounts={received}
            onAmount={(name, value) => setReceived((current) => ({ ...current, [name]: value }))}
          />
        )}

        {screen === "afectado" && (
          <AffectedHome
            city={city}
            reference={reference}
            cities={knownCities}
            gpsLabel={gpsLabel}
            locating={locating}
            onCity={updateCity}
            onReference={setReference}
            onLocate={locate}
            reports={network.reports}
            onProducts={openProducts}
            onHands={() => navigate("manos")}
            onSaturation={() => navigate("saturado")}
            onPeople={() => navigate("personas")}
          />
        )}

        {screen === "acopio" && (
          <CenterHome
            center={myCenter}
            centers={network.centers}
            needs={network.needs}
            requests={network.volunteerRequests}
            reports={network.reports}
            position={position}
            busy={busy}
            onChoose={chooseCenter}
            onChangeCenter={forgetCenter}
            onProducts={openProducts}
            onReceived={openReceived}
            onHands={() => navigate("manos")}
            onSaturation={() => navigate("saturado")}
            onToggleVolunteers={() => void toggleVolunteers()}
            onLiftSaturation={() => void setCenterSaturated(false)}
          />
        )}

        {screen === "productos" && (
          <ProductsScreen
            withTargets={role === "acopio"}
            levels={levels}
            targets={targets}
            urgentCount={urgentCount}
            blockedCount={blockedCount}
            onLevel={(name, level) => setLevels((current) => ({ ...current, [name]: level }))}
            onTarget={(name, value) => setTargets((current) => ({ ...current, [name]: value }))}
          />
        )}

        {screen === "manos" && (
          <HandsScreen kind={handKind} quantity={handQuantity} onKind={setHandKind} onQuantity={setHandQuantity} />
        )}

        {screen === "saturado" && (
          <SaturationScreen
            reason={saturationReason}
            onReason={setSaturationReason}
            alternatives={sortedCenters
              .filter((center) => center.status === "active" && !(role === "acopio" && center.id === myCenterId))
              .slice(0, 3)}
            needs={network.needs}
            position={position}
          />
        )}

        {screen === "personas" && <PeopleScreen onBack={goBack} />}

        {screen === "logistica" && (
          <LogisticsScreen
            centers={sortedCenters}
            needs={network.needs}
            requests={network.volunteerRequests}
            position={position}
            busy={busy}
            loading={loading}
            view={pointsView}
            onView={setPointsView}
            onAccept={(item) => void acceptRequest(item)}
          />
        )}

        {screen === "donante" && (
          <DonorScreen
            needs={activeNeeds}
            centers={network.centers}
            position={position}
            loading={loading}
            pledge={stillValid(pledge) ? pledge : null}
            onInitiatives={() => navigate("iniciativas")}
            onPick={(need) => {
              setPledgeNeedId(need.id);
              setPledgeQuantity(Math.min(4, remainingOf(need)) || 1);
              navigate("donar");
            }}
          />
        )}

        {screen === "donar" && !pledgeNeed && (
          <>
            <p className="empty">Esa necesidad ya está cubierta o dejó de estar disponible.</p>
            <button type="button" className="row-card" onClick={() => navigate("donante")}>
              <span className="glyph"><UiIcon name="alert" size={21} /></span>
              <span className="copy">
                <strong>Ver qué se necesita ahora</strong>
                <small>Volver al listado actualizado</small>
              </span>
              <UiIcon name="arrow-right" size={19} />
            </button>
          </>
        )}

        {screen === "donar" && pledgeNeed && (
          <PledgeScreen
            need={pledgeNeed}
            center={network.centers.find((center) => center.id === pledgeNeed.centerId)}
            quantity={pledgeQuantity}
            onQuantity={setPledgeQuantity}
          />
        )}

        {screen === "iniciativas" && <InitiativesScreen onFlash={flash} />}

        {screen === "bulos" && <HoaxesScreen />}

        {screen === "done" && <DoneScreen kind={doneKind} body={doneBody} note={doneNote} route={doneRoute} onHome={() => navigate(home)} />}
      </main>

      {cta && (
        <div className="cta-bar">
          <button type="button" onClick={runCta} disabled={busy}>
            {busy ? "Guardando…" : cta}
          </button>
        </div>
      )}

      {showTabs && (
        <nav className="tabs" aria-label="Navegación principal">
          {tabs.map((tab) => (
            <button
              key={tab.label}
              type="button"
              className={screen === tab.target ? "on" : ""}
              aria-current={screen === tab.target ? "page" : undefined}
              onClick={() => {
                if (tab.target === "roles") { clearRole(); return; }
                if (tab.target === "productos") { openProducts(); return; }
                navigate(tab.target);
              }}
            >
              <UiIcon name={tab.icon} size={21} />
              <small>{tab.label}</small>
            </button>
          ))}
        </nav>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* ────────────────────────── Pantallas ────────────────────────── */

function HomeScreen(props: {
  pulse: Pulse;
  position: Position | null;
  role: Role | null;
  onPick: (role: Role) => void;
  onTutorial: () => void;
  onHoaxes: () => void;
  onInitiatives: () => void;
  onMap: () => void;
  onNeeds: () => void;
  onEmergency: () => void;
}) {
  const { pulse } = props;
  const saved = ROLES.find((item) => item.id === props.role);
  const percent = pulse.goal > 0 ? Math.min(100, Math.round((pulse.delivered / pulse.goal) * 100)) : 0;
  const list = (values: string[]) =>
    Array.from(new Set(values)).slice(0, 3).join(", ");

  return (
    <section className="dc-body" style={{ padding: "22px 2px 34px", gap: 18 }}>
      <span className="mark" aria-hidden="true"><UiIcon name="location" size={26} /></span>
      <div style={{ display: "grid", gap: 8 }}>
        <h1 className="dc-title">¿Cómo estás ayudando hoy?</h1>
        <p className="dc-lead">Entra sin registro. Puedes cambiar de rol cuando quieras.</p>
      </div>

      {/*
        Atajos a lo que sirve sin haber elegido rol todavía. No fijan rol a
        propósito: mirar no es comprometerse.
      */}
      <nav className="shortcuts" aria-label="Accesos directos">
        <button type="button" onClick={props.onMap}>
          <span><UiIcon name="location" size={18} /></span>
          Mapa de puntos
        </button>
        <button type="button" onClick={props.onNeeds}>
          <span><UiIcon name="alert" size={18} /></span>
          Se necesita ahora
        </button>
        <button type="button" onClick={props.onInitiatives}>
          <span><UiIcon name="reports" size={18} /></span>
          Empresas que donan
        </button>
      </nav>

      {saved && (
        <button type="button" className="row-card resume" onClick={() => props.onPick(saved.id)}>
          <span className="code">{saved.code}</span>
          <span className="copy">
            <strong>Seguir como {saved.title.toLowerCase()}</strong>
            <small>Retomas donde ibas, con tu centro y tus marcas</small>
          </span>
          <UiIcon name="arrow-right" size={19} />
        </button>
      )}

      <div className="stack">
        {ROLES.filter((role) => role.id !== saved?.id).map((role) => (
          <button key={role.id} type="button" className="row-card" onClick={() => props.onPick(role.id)}>
            <span className="code">{role.code}</span>
            <span className="copy">
              <strong>{role.title}</strong>
              <small>{role.text}</small>
            </span>
            <UiIcon name="arrow-right" size={18} />
          </button>
        ))}

        <a className="row-card coord-entry" href="/coordinar">
          <span className="code">CA</span>
          <span className="copy">
            <strong>Registrar centros de acopio</strong>
            <small>Panel de coordinación · alta individual o carga masiva</small>
          </span>
          <UiIcon name="arrow-right" size={18} />
        </a>
      </div>

      <button type="button" className="ghost-row" onClick={props.onTutorial}>
        <UiIcon name="alert" size={17} />
        ¿Es tu primera vez? Mira cómo funciona en un minuto
      </button>

      <button type="button" className="ghost-row" onClick={props.onHoaxes}>
        <UiIcon name="close" size={17} />
        Noticias falsas que están circulando
      </button>

      <section style={{ display: "grid", gap: 10, paddingTop: 4 }}>
        <h2 className="dc-h" style={{ fontSize: "15px", margin: 0 }}>Ahora mismo</h2>

        <div className="dc-stats">
          <div><strong>{pulse.centers}</strong><small>puntos activos</small></div>
          <div><strong>{pulse.cities}</strong><small>ciudades</small></div>
          <div><strong>{pulse.hands}</strong><small>manos en terreno</small></div>
        </div>

        {/* Cuatro datos, uno por tarjeta: la rejilla se lee de un vistazo. */}
        <div className="dc-tiles">
          <article className="dc-card sm">
            <span className="dc-eyebrow soft">Qué falta</span>
            <strong className="dc-h" style={{ fontSize: "13px", lineHeight: 1.3 }}>
              {pulse.missing.length > 0 ? list(pulse.missing.map((row) => row.need.name)) : "Nada publicado"}
            </strong>
            <span style={{ color: "#dc2626", fontSize: "11px", fontWeight: 500 }}>
              {pulse.urgent} urgencias abiertas
            </span>
          </article>

          <article className="dc-card sm">
            <span className="dc-eyebrow soft">Cuánto se entregó</span>
            <strong className="dc-h" style={{ fontSize: "13px", lineHeight: 1.3 }}>
              {pulse.goal > 0 ? `${percent}% de lo pedido` : "Sin metas aún"}
            </strong>
            <span className="dc-bar"><i style={{ background: "#059669", width: `${percent}%` }} /></span>
          </article>

          <article className="dc-card sm">
            <span className="dc-eyebrow soft">Quién trabaja</span>
            <strong className="dc-h" style={{ fontSize: "13px", lineHeight: 1.3 }}>
              {pulse.working.length} centros reportando
            </strong>
            <span style={{ color: "#64748b", fontSize: "11px", fontWeight: 500 }}>
              {pulse.hands} personas en terreno
            </span>
          </article>

          <article className="dc-card sm">
            <span className="dc-eyebrow soft">Dónde faltan manos</span>
            <strong className="dc-h" style={{ fontSize: "13px", lineHeight: 1.3 }}>
              {pulse.wanted.length > 0 ? list(pulse.wanted.map((row) => row.center.city)) : "Sin solicitudes"}
            </strong>
            <span style={{ color: "#d97706", fontSize: "11px", fontWeight: 500 }}>
              {pulse.handsWanted} personas pedidas
            </span>
          </article>
        </div>
      </section>

      {/*
        La emergencia va abajo y en rojo: no compite con los roles, pero deja de ser
        letra pequeña. Lleva a la pantalla que explica por qué eso no se publica aquí.
      */}
      <div className="home-foot">
        <button type="button" className="emergency-row" onClick={props.onEmergency}>
          <strong>¿Hay una persona herida? Línea 123</strong>
          <UiIcon name="arrow-right" size={17} />
        </button>
        <p className="fineprint center">
          Esta app no recauda dinero. Solo conecta necesidades con quien puede cubrirlas.
        </p>
      </div>
    </section>
  );
}


const TUTORIAL: { role: Role; title: string; steps: string[] }[] = [
  {
    role: "afectado",
    title: "Estoy en una zona afectada",
    steps: [
      "Dices en qué ciudad estás. Puedes usar tu ubicación con un toque.",
      "Marcas qué falta tocando los productos: urgente, se necesita o ya hay.",
      "Publicas. Lo que marques aparece al instante para donantes y voluntarios.",
    ],
  },
  {
    role: "acopio",
    title: "Atiendo un centro de acopio",
    steps: [
      "Eliges tu centro de la lista, agrupada por ciudad. Queda recordado en este teléfono.",
      "Marcas qué necesitas y cuánto. Esa meta es la que ven los donantes.",
      "Cuando llegue la ayuda, registras lo recibido. Así la meta baja sola y nadie trae de más.",
      "Si te desbordas, marcas el centro como saturado. Puedes quitarlo cuando baje la afluencia.",
    ],
  },
  {
    role: "logistica",
    title: "Puedo ofrecer manos",
    steps: [
      "Ves los puntos ordenados por dónde más falta apoyo, no solo por cercanía.",
      "Eliges la tarea que puedes hacer y cuántas personas van contigo.",
      "Te apuntas y abres la ruta. Los centros que ya están llenos aparecen al final.",
    ],
  },
  {
    role: "donante",
    title: "Quiero donar",
    steps: [
      "Ves qué falta ahora mismo, priorizado por los propios centros.",
      "Comprometes una cantidad. Nadie más puede prometer eso durante 6 horas.",
      "Te damos una referencia y la hora límite. Si no llegas, el cupo se libera solo.",
    ],
  },
];

function TutorialScreen({ onPick }: { onPick: (role: Role) => void }) {
  return (
    <>
      <p className="lead-text">
        La app no pide registro ni datos personales. Eliges un rol, y cada rol tiene su propio camino.
      </p>
      {TUTORIAL.map((block) => (
        <section className="group howto" key={block.role}>
          <h2>{block.title}</h2>
          <ol>
            {block.steps.map((step, index) => (
              <li key={step}>
                <span aria-hidden="true">{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <button type="button" className="ghost-row" onClick={() => onPick(block.role)}>
            Empezar por aquí
            <UiIcon name="arrow-right" size={18} />
          </button>
        </section>
      ))}
      <p className="fineprint">
        Si hay vidas en riesgo, llama al <a href="tel:123">123</a> antes de publicar aquí.
      </p>
    </>
  );
}

function AffectedHome(props: {
  city: string;
  reference: string;
  cities: string[];
  gpsLabel: string;
  locating: boolean;
  onCity: (value: string) => void;
  onReference: (value: string) => void;
  onLocate: () => void;
  reports: FieldReport[];
  onProducts: () => void;
  onHands: () => void;
  onSaturation: () => void;
  onPeople: () => void;
}) {
  const nearby = props.reports.filter((report) => !props.city || report.city === props.city).slice(0, 3);
  return (
    <div className="dc-body">
      <section className="dc-card">
        <span className="dc-eyebrow">Dónde estás</span>
        <input
          className="dc-input"
          list="ciudades-conocidas"
          value={props.city}
          onChange={(event) => props.onCity(event.target.value)}
          autoComplete="address-level2"
          placeholder="Escribe tu ciudad"
          aria-label="Ciudad o municipio"
        />
        <datalist id="ciudades-conocidas">
          {props.cities.map((city) => <option key={city} value={city} />)}
        </datalist>
        <input
          className="dc-input"
          value={props.reference}
          onChange={(event) => props.onReference(event.target.value)}
          placeholder="Barrio o vereda (opcional)"
          aria-label="Barrio o referencia"
        />
        <button type="button" className="dc-dashed" onClick={props.onLocate} disabled={props.locating}>
          {props.locating ? "Buscando tu ubicación…" : props.gpsLabel || "Usar mi ubicación GPS"}
        </button>
      </section>

      <p className="dc-h">Qué quieres reportar</p>
      <div className="dc-tiles">
        <button type="button" className="dc-tile" onClick={props.onProducts}>
          <span><UiIcon name="package" size={18} /></span>
          <strong>Productos que faltan</strong>
        </button>
        <button type="button" className="dc-tile" onClick={props.onHands}>
          <span><UiIcon name="users" size={18} /></span>
          <strong>Pedir manos</strong>
        </button>
        <button type="button" className="dc-tile warn" onClick={props.onSaturation}>
          <span><UiIcon name="alert" size={18} /></span>
          <strong>Centro saturado</strong>
        </button>
        <button type="button" className="dc-tile danger" onClick={props.onPeople}>
          <span><UiIcon name="reports" size={18} /></span>
          <strong>Persona herida</strong>
        </button>
      </div>

      {nearby.length > 0 && (
        <section className="dc-body" style={{ gap: 8, padding: 0 }}>
          <div className="dc-kv">
            <strong className="dc-h">Reportes de tu ciudad</strong>
            <span className="dc-sub">{props.city || "Todas"}</span>
          </div>
          {nearby.map((report) => (
            <article className="dc-card sm" key={report.id}>
              <div className="dc-kv">
                <strong style={{ fontSize: "12.5px", lineHeight: 1.3 }}>{report.location}</strong>
                <span style={{ color: "#94a3b8", fontSize: "10.5px", fontWeight: 500 }}>{since(report.createdAt)}</span>
              </div>
              <p className="dc-sub" style={{ margin: 0 }}>{report.details}</p>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function CenterHome(props: {
  center?: Center;
  centers: Center[];
  needs: Need[];
  requests: VolunteerRequest[];
  reports: FieldReport[];
  position: Position | null;
  busy: boolean;
  onChoose: (id: string) => void;
  onChangeCenter: () => void;
  onProducts: () => void;
  onReceived: () => void;
  onHands: () => void;
  onSaturation: () => void;
  onToggleVolunteers: () => void;
  onLiftSaturation: () => void;
}) {
  const center = props.center;
  const [view, setView] = useState<"lista" | "mapa">("lista");
  const [query, setQuery] = useState("");

  const matching = useMemo(() => {
    const key = norm(query);
    if (!key) return props.centers;
    return props.centers.filter((item) => norm(`${item.name} ${item.city} ${item.address}`).includes(key));
  }, [props.centers, query]);

  if (!center) {
    return (
      <section>
        <h2 className="lead">¿Cuál es tu centro?</h2>
        <p className="lead-text">Lo recordamos en este dispositivo. Lo que publiques quedará a su nombre.</p>
        {props.centers.length === 0 ? (
          <p className="empty">Todavía no hay centros publicados.</p>
        ) : view === "mapa" ? (
          <>
            <ViewSwitch view={view} onView={setView} />
            <CentersMap
              centers={props.centers}
              needs={props.needs}
              requests={props.requests}
              position={props.position}
              chooseLabel="Este es mi centro"
              onChoose={(picked) => props.onChoose(picked.id)}
            />
          </>
        ) : (
          <>
          <ViewSwitch view={view} onView={setView} />
          <SearchBox value={query} onValue={setQuery} label="Buscar por nombre o ciudad" icon="building" />
          {matching.length === 0 && <p className="empty">Ningún centro coincide con “{query}”.</p>}
          {groupByCity(matching, props.position).map((block) => (
            <section className="group" key={block.city}>
              <h2>
                {block.city}
                <span>{block.centers.length}</span>
              </h2>
              <div className="stack">
                {block.centers.map((item) => (
                  <button key={item.id} type="button" className="row-card" onClick={() => props.onChoose(item.id)}>
                    <span className="copy">
                      <strong>{item.name}</strong>
                      <small>{item.address}</small>
                    </span>
                    {props.position && <span className="dist">{formatDistance(distanceKm(props.position, item))}</span>}
                  </button>
                ))}
              </div>
            </section>
          ))}
          </>
        )}
        <p className="fineprint">
          ¿Tu centro no aparece? <a href="/coordinar">Regístralo en coordinación</a>.
        </p>
      </section>
    );
  }

  const urgent = props.needs.filter((need) => need.centerId === center.id && need.status === "urgent").length;
  const hands = props.requests
    .filter((item) => item.centerId === center.id && item.status === "open")
    .reduce((sum, item) => sum + Math.max(0, item.quantity - item.accepted), 0);
  const inbox = props.reports.filter((report) => report.city === center.city).slice(0, 3);

  return (
    <>
      <section className="summary">
        <div><strong>{urgent}</strong><small>productos urgentes</small></div>
        <div><strong>{hands}</strong><small>manos solicitadas</small></div>
      </section>

      {/* El interruptor es la única forma de volver: marcar saturado no puede ser de ida. */}
      <section className="switch-card">
        <div>
          <strong>Nuestro centro está saturado</strong>
          <small>
            {center.status === "saturated"
              ? "No apareces como destino sugerido. Quítalo cuando baje la afluencia."
              : "Deja de recibir gente y donaciones."}
          </small>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={center.status === "saturated"}
          aria-label="Nuestro centro está saturado"
          className={center.status === "saturated" ? "on danger" : ""}
          disabled={props.busy}
          onClick={center.status === "saturated" ? props.onLiftSaturation : props.onSaturation}
        >
          <i />
        </button>
      </section>

      <section className="switch-card">
        <div>
          <strong>Ya tenemos suficientes voluntarios</strong>
          <small>Los voluntarios nuevos verán otros centros primero.</small>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(center.volunteersSaturated)}
          aria-label="Ya tenemos suficientes voluntarios"
          className={center.volunteersSaturated ? "on" : ""}
          disabled={props.busy}
          onClick={props.onToggleVolunteers}
        >
          <i />
        </button>
      </section>

      <div className="stack">
        <ActionRow icon="package" title="Publicar qué necesitamos" text="Estado y meta por producto" onClick={props.onProducts} />
        <ActionRow icon="check" title="Registrar lo que llegó" text="Baja la meta para todos" onClick={props.onReceived} />
        <ActionRow icon="users" title="Solicitar manos" text="Tarea y número de personas" onClick={props.onHands} />
        <ActionRow icon="building" title="Cambiar de centro" text="Elegir otro acopio en este dispositivo" onClick={props.onChangeCenter} />
      </div>

      {inbox.length > 0 && (
        <section className="feed">
          <h2>Reportes en {center.city}</h2>
          {inbox.map((report) => (
            <article key={report.id}>
              <strong>{report.location}</strong>
              <p>{report.details}</p>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function ProductsScreen(props: {
  withTargets: boolean;
  levels: Record<string, Level>;
  targets: Record<string, number>;
  urgentCount: number;
  blockedCount: number;
  onLevel: (name: string, level: Level) => void;
  onTarget: (name: string, value: number) => void;
}) {
  const [query, setQuery] = useState("");
  const key = norm(query);

  // Buscar evita recorrer siete grupos para marcar un solo producto, que es lo
  // que pasa cuando alguien entra sabiendo exactamente qué le falta.
  const groups = useMemo(
    () =>
      CATALOG.map((section) => ({
        ...section,
        items: key ? section.items.filter((item) => norm(item.name).includes(key)) : section.items,
      })).filter((section) => section.items.length > 0),
    [key],
  );

  return (
    <>
      <div className="dc-subhead">
        <input
          className="dc-input sm"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar producto"
          aria-label="Buscar un producto"
        />
      </div>

      <div className="dc-body wide-gap" style={{ padding: "14px 0 20px" }}>
        {groups.length === 0 && <p className="empty">Ningún producto coincide con “{query}”.</p>}
        {groups.map((section) => (
          <section style={{ display: "grid", gap: 8 }} key={section.group}>
            <span className="dc-eyebrow">{section.group}</span>
            {section.items.map((item) => {
              const level = props.levels[item.name] ?? "normal";
              const target = props.targets[item.name] ?? item.start;
              return (
                <article className="dc-card sm" key={item.name} style={{ gap: 10 }}>
                  <div className="dc-kv" style={{ alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: "13.5px", lineHeight: 1.2 }}>{item.name}</strong>
                    <span style={{ color: "#94a3b8", fontSize: "11px", fontWeight: 500 }}>{item.unit}</span>
                  </div>
                  <div className="dc-states" role="group" aria-label={`Estado de ${item.name}`}>
                    <button type="button" aria-pressed={level === "urgent"} onClick={() => props.onLevel(item.name, "urgent")}>Urgente</button>
                    <button type="button" aria-pressed={level === "normal"} onClick={() => props.onLevel(item.name, "normal")}>Se necesita</button>
                    <button type="button" aria-pressed={level === "blocked"} onClick={() => props.onLevel(item.name, "blocked")}>Ya hay</button>
                  </div>
                  {props.withTargets && level !== "blocked" && (
                    <div className="dc-step-row">
                      <span>Meta para tu centro</span>
                      <div className="dc-step sm">
                        <button type="button" aria-label={`Reducir meta de ${item.name}`} onClick={() => props.onTarget(item.name, Math.max(1, target - item.step))}>−</button>
                        <strong aria-live="polite">{target}</strong>
                        <button type="button" className="plus" aria-label={`Aumentar meta de ${item.name}`} onClick={() => props.onTarget(item.name, Math.min(100000, target + item.step))}>+</button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}

/**
 * Registrar lo que llegó. Es lo que cierra el circuito: sin esto se promete, la promesa
 * vence, y nada consta nunca como entregado.
 */
function ReceivedScreen(props: {
  needs: Need[];
  amounts: Record<string, number>;
  onAmount: (name: string, value: number) => void;
}) {
  if (props.needs.length === 0) {
    return (
      <p className="empty">
        Tu centro no tiene necesidades publicadas todavía. Publica primero qué necesitas y aquí podrás
        ir marcando lo que vaya llegando.
      </p>
    );
  }

  return (
    <>
      <p className="lead-text">
        Cuenta solo lo que ya está en tu bodega. Al registrarlo, la meta baja para todos y nadie trae de más.
      </p>
      {props.needs.map((need) => {
        const step = CATALOG_ITEMS.find((item) => item.name === need.name)?.step ?? 1;
        const pending = Math.max(0, need.target - need.covered);
        const amount = props.amounts[need.name] ?? 0;
        return (
          <article className={`product ${amount > 0 ? "urgent" : ""}`} key={need.id}>
            <strong>{need.name}</strong>
            <small className="meta">
              {need.covered} de {need.target} {need.unit}
              {need.committed > 0 ? ` · ${need.committed} prometidos` : ""}
            </small>
            <div className="stepper small">
              <span>Llegó</span>
              <button
                type="button"
                aria-label={`Reducir lo recibido de ${need.name}`}
                onClick={() => props.onAmount(need.name, Math.max(0, amount - step))}
              >
                <UiIcon name="minus" size={18} />
              </button>
              <strong aria-live="polite">{amount}</strong>
              <button
                type="button"
                aria-label={`Aumentar lo recibido de ${need.name}`}
                onClick={() => props.onAmount(need.name, Math.min(pending, amount + step))}
              >
                <UiIcon name="plus" size={18} />
              </button>
              <small>{need.unit}</small>
            </div>
          </article>
        );
      })}
    </>
  );
}

function HandsScreen(props: {
  kind: string;
  quantity: number;
  onKind: (value: string) => void;
  onQuantity: (value: number) => void;
}) {
  return (
    <div className="dc-body wide-gap">
      <div style={{ display: "grid", gap: 8 }}>
        <span className="dc-eyebrow">Tarea</span>
        {HAND_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`dc-pick${props.kind === option.id ? " on" : ""}`}
            aria-pressed={props.kind === option.id}
            onClick={() => props.onKind(option.id)}
          >
            <span className="sigla">{initials(option.id)}</span>
            <strong>{option.id}</strong>
            {props.kind === option.id && <span className="check"><UiIcon name="check" size={14} /></span>}
          </button>
        ))}
      </div>

      <section className="dc-card">
        <span className="dc-h" style={{ fontSize: "13px" }}>¿Cuántas personas?</span>
        <div className="dc-step">
          <button type="button" aria-label="Restar una persona" onClick={() => props.onQuantity(Math.max(1, props.quantity - 1))}>−</button>
          <strong aria-live="polite">{props.quantity}</strong>
          <button type="button" className="plus" aria-label="Sumar una persona" onClick={() => props.onQuantity(Math.min(60, props.quantity + 1))}>+</button>
        </div>
        <p style={{ color: "#94a3b8", fontSize: "11px", lineHeight: 1.3, margin: 0, textAlign: "center" }}>
          Entre 1 y 60 personas
        </p>
      </section>
    </div>
  );
}

function SaturationScreen(props: {
  reason: string;
  onReason: (value: string) => void;
  alternatives: Center[];
  needs: Need[];
  position: Position | null;
}) {
  return (
    <div className="dc-body wide-gap">
      <div style={{ display: "grid", gap: 8 }}>
        <span className="dc-eyebrow">Motivo</span>
        {SATURATION_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`dc-pick radio${props.reason === option.id ? " on" : ""}`}
            aria-pressed={props.reason === option.id}
            onClick={() => props.onReason(option.id)}
          >
            <span className="dot" aria-hidden="true"><i /></span>
            <strong>{option.id}</strong>
          </button>
        ))}
      </div>

      {props.alternatives.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          <p className="dc-h" style={{ fontSize: "13.5px", margin: 0 }}>Lleva lo que traías a estos centros</p>
          {props.alternatives.map((center) => {
            const urgent = props.needs.filter(
              (need) => need.centerId === center.id && need.status === "urgent",
            ).length;
            return (
              <article className="dc-card sm" key={center.id} style={{ gap: 8 }}>
                <div className="dc-kv" style={{ alignItems: "flex-start", gap: 8 }}>
                  <strong style={{ fontSize: "13px", lineHeight: 1.25 }}>{center.name}</strong>
                  {props.position && (
                    <span style={{ color: "#2563eb", flex: "none", fontSize: "11px", fontWeight: 600 }}>
                      {formatDistance(distanceKm(props.position, center))}
                    </span>
                  )}
                </div>
                <p className="dc-sub" style={{ margin: 0 }}>
                  {urgent > 0 ? `Urgente: ${urgent} productos` : "Recibiendo ayuda"}
                </p>
                <a className="dc-ghost" style={{ display: "block", textAlign: "center", textDecoration: "none" }}
                   href={routeUrl(center)} target="_blank" rel="noreferrer">Ver ruta</a>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PeopleScreen({ onBack }: { onBack: () => void }) {
  return (
    <section className="dc-emergency">
      <button type="button" className="dc-back" onClick={onBack} aria-label="Volver">
        <UiIcon name="arrow-left" size={19} />
      </button>
      <div style={{ display: "grid", gap: 12, paddingTop: 30 }}>
        <h2>Una persona herida no se reporta por la app</h2>
        <p>
          Llama al 123. Es la única vía que activa una ambulancia. Nadie en esta plataforma puede
          atender una emergencia médica.
        </p>
      </div>
      <a className="dc-call" href="tel:123">
        <strong>123</strong>
        <small>Llamar ahora</small>
      </a>
      <aside>
        Si ya llamaste y el centro necesita insumos médicos, vuelve y publícalos como producto urgente.
      </aside>
    </section>
  );
}

function LogisticsScreen(props: {
  centers: Center[];
  needs: Need[];
  requests: VolunteerRequest[];
  position: Position | null;
  busy: boolean;
  loading: boolean;
  view: "lista" | "mapa";
  onView: (value: "lista" | "mapa") => void;
  onAccept: (item: VolunteerRequest) => void;
}) {
  const [city, setCity] = useState("");

  const cities = useMemo(
    () => Array.from(new Set(props.centers.map((center) => center.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es")),
    [props.centers],
  );

  const shown = useMemo(
    () => props.centers.filter((center) => !city || center.city === city),
    [props.centers, city],
  );

  return (
    <>
      <div className="dc-subhead">
        <div className="dc-chips">
          <button type="button" aria-pressed={city === ""} onClick={() => setCity("")}>Todas</button>
          {cities.map((name) => (
            <button key={name} type="button" aria-pressed={city === name} onClick={() => setCity(name)}>{name}</button>
          ))}
        </div>
      </div>

      <div className="dc-body tight" style={{ padding: "14px 0 24px" }}>
        <div className="dc-toggle" style={{ alignSelf: "flex-start" }} role="group" aria-label="Ver como">
          <button type="button" aria-pressed={props.view === "lista"} onClick={() => props.onView("lista")}>Lista</button>
          <button type="button" aria-pressed={props.view === "mapa"} onClick={() => props.onView("mapa")}>Mapa</button>
        </div>

        {props.view === "mapa" && (
          <CentersMap
            centers={shown}
            needs={props.needs}
            requests={props.requests}
            position={props.position}
          />
        )}

        {props.loading && <p className="empty">Sincronizando…</p>}
        {!props.loading && shown.length === 0 && <p className="empty">No hay puntos en esa ciudad.</p>}

        {shown.map((center) => {
          const open = props.requests.filter(
            (item) => item.centerId === center.id && item.status === "open" && item.accepted < item.quantity,
          );
          const first = open[0];
          const missing = open.reduce((total, item) => total + (item.quantity - item.accepted), 0);
          const full = center.volunteersSaturated || center.status === "saturated";
          return (
            <article className="dc-card" key={center.id} style={{ opacity: full ? 0.72 : 1 }}>
              <div className="dc-kv" style={{ alignItems: "flex-start", gap: 10 }}>
                <span style={{ display: "grid", flex: 1, gap: 3, minWidth: 0 }}>
                  <strong style={{ fontSize: "13.5px", lineHeight: 1.25 }}>{center.name}</strong>
                  <span className="dc-sub">
                    {center.city}
                    {props.position ? ` · ${formatDistance(distanceKm(props.position, center))}` : ""}
                  </span>
                  {isApproximate(center) && (
                    <span className="approx">Ubicación aproximada · confirma la dirección</span>
                  )}
                </span>
                <span className={`dc-tag ${full ? "ok" : missing > 5 ? "urgent" : "warn"}`}>
                  {full ? "Lleno" : missing > 5 ? "Falta apoyo" : "Casi listo"}
                </span>
              </div>
              <p style={{ color: "#0f172a", fontSize: "12px", fontWeight: 600, lineHeight: 1.35, margin: 0 }}>
                {first ? `${first.kind} · faltan ${first.quantity - first.accepted} personas` : "Sin cupo de voluntarios hoy"}
              </p>
              <div className="dc-row-actions">
                <button
                  type="button"
                  className="dc-solid"
                  disabled={!first || props.busy}
                  style={!first ? { background: "#e2e8f0", color: "#94a3b8" } : undefined}
                  onClick={() => first && props.onAccept(first)}
                >
                  {first ? "Me apunto" : "Sin cupo"}
                </button>
                <a className="dc-ghost flexnone" style={{ textDecoration: "none" }}
                   href={routeUrl(center)} target="_blank" rel="noreferrer">Ruta</a>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

/* Conmutador lista/mapa del selector de centro, con la forma del rediseño. */
function ViewSwitch({
  view,
  onView,
}: { view: "lista" | "mapa"; onView: (value: "lista" | "mapa") => void }) {
  return (
    <div className="dc-toggle" style={{ alignSelf: "flex-start" }} role="group" aria-label="Forma de ver los puntos">
      <button type="button" aria-pressed={view === "lista"} onClick={() => onView("lista")}>Lista</button>
      <button type="button" aria-pressed={view === "mapa"} onClick={() => onView("mapa")}>Mapa</button>
    </div>
  );
}

function PledgeReminder({ pledge }: { pledge: Commitment }) {
  return (
    <section className="place-card">
      <span className="eyebrow">Tu compromiso</span>
      <strong>{pledge.quantity} {pledge.unit} de {pledge.name.toLowerCase()}</strong>
      {pledge.center && <small>Entregar en {pledge.center}</small>}
      <small>
        {pledge.reference ? `Referencia ${pledge.reference}` : "Sin referencia"}
        {pledge.expiresAt ? ` · el cupo se libera solo a las ${hourOf(pledge.expiresAt)}` : ""}
      </small>
    </section>
  );
}

function DonorScreen(props: {
  needs: Need[];
  centers: Center[];
  position: Position | null;
  loading: boolean;
  pledge: Commitment | null;
  onInitiatives: () => void;
  onPick: (need: Need) => void;
}) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [onlyUrgent, setOnlyUrgent] = useState(false);

  const byId = useMemo(() => new Map(props.centers.map((center) => [center.id, center])), [props.centers]);

  const cities = useMemo(() => {
    const names = props.needs.map((need) => byId.get(need.centerId)?.city).filter(Boolean) as string[];
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, "es"));
  }, [props.needs, byId]);

  const shown = useMemo(() => {
    const key = norm(query);
    const list = props.needs.filter((need) => {
      const center = byId.get(need.centerId);
      if (!center) return false;
      if (onlyUrgent && need.status !== "urgent") return false;
      if (city && center.city !== city) return false;
      return !key || norm(`${need.name} ${center.name} ${center.city}`).includes(key);
    });

    // Primero lo urgente y, dentro de eso, lo que el donante tiene más cerca:
    // una necesidad a diez cuadras se cubre; una a tres horas, casi nunca.
    const position = props.position;
    return list.sort((a, b) => {
      const byUrgency = (a.status === "urgent" ? 0 : 1) - (b.status === "urgent" ? 0 : 1);
      if (byUrgency !== 0) return byUrgency;
      if (!position) return 0;
      const centerA = byId.get(a.centerId);
      const centerB = byId.get(b.centerId);
      if (!centerA || !centerB) return 0;
      return distanceKm(position, centerA) - distanceKm(position, centerB);
    });
  }, [props.needs, byId, query, city, onlyUrgent, props.position]);

  if (props.loading) return <p className="empty">Sincronizando…</p>;

  return (
    <>
      <div className="dc-subhead">
        <input
          className="dc-input sm"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar necesidad"
          aria-label="Buscar qué llevar o a qué centro"
        />
        <div className="dc-chips">
          <button type="button" aria-pressed={onlyUrgent} onClick={() => setOnlyUrgent((current) => !current)}>
            Solo urgentes
          </button>
          <button type="button" aria-pressed={city === ""} onClick={() => setCity("")}>Todas</button>
          {cities.map((name) => (
            <button key={name} type="button" aria-pressed={city === name} onClick={() => setCity(name)}>{name}</button>
          ))}
        </div>
      </div>

      <div className="dc-body tight" style={{ padding: "14px 0 24px" }}>
        {props.pledge && (
          <div className="dc-live">
            <i aria-hidden="true" />
            <span>
              Tienes {props.pledge.quantity} {props.pledge.unit} de {props.pledge.name} reservados
              hasta las {new Date(props.pledge.expiresAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        )}

        <button type="button" className="dc-tile compact" style={{ minHeight: 0 }} onClick={props.onInitiatives}>
          <span><UiIcon name="reports" size={16} /></span>
          <strong>Empresas que donan · kits, cuentas y cajeros</strong>
        </button>

        {props.needs.length === 0 && (
          <p className="empty">Todavía no hay necesidades publicadas.</p>
        )}
        {props.needs.length > 0 && shown.length === 0 && (
          <p className="empty">Nada coincide con lo que buscas. Prueba quitando algún filtro.</p>
        )}

        {shown.map((need) => {
          const center = byId.get(need.centerId);
          if (!center) return null;
          const promised = need.covered + need.committed;
          const percent = Math.min(100, Math.round((promised / Math.max(1, need.target)) * 100));
          const urgent = need.status === "urgent";
          return (
            <button type="button" className="dc-card" key={need.id} onClick={() => props.onPick(need)} style={{ cursor: "pointer", gap: 9, textAlign: "left" }}>
              <div className="dc-kv" style={{ alignItems: "flex-start", gap: 8, width: "100%" }}>
                <span style={{ display: "grid", flex: 1, gap: 3, minWidth: 0 }}>
                  <strong style={{ fontSize: "14px", lineHeight: 1.25 }}>{need.name}</strong>
                  <span className="dc-sub">
                    {center.name} · {center.city}
                    {props.position ? ` · ${formatDistance(distanceKm(props.position, center))}` : ""}
                  </span>
                </span>
                <span className={`dc-tag ${urgent ? "urgent" : "soft"}`}>{urgent ? "Urgente" : "Se necesita"}</span>
              </div>
              {/* La meta no siempre la puso el centro: cuando la estimamos nosotros hay
                  que decirlo aquí, que es donde el donante decide cuánto llevar. */}
              {need.detail && <span className="approx">{need.detail}</span>}
              <span style={{ display: "grid", gap: 5, width: "100%" }}>
                <span className="dc-bar" role="img" aria-label={`${percent}% cubierto`}>
                  <i style={{ background: urgent ? "#dc2626" : "#2563eb", width: `${percent}%` }} />
                </span>
                <span className="dc-bar-copy">
                  <span>{promised} de {need.target} {need.unit}</span>
                  <span>faltan {remainingOf(need)}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function PledgeScreen(props: {
  need: Need;
  center?: Center;
  quantity: number;
  onQuantity: (value: number) => void;
}) {
  const remaining = remainingOf(props.need);
  const promised = props.need.covered + props.need.committed;
  const percent = Math.min(100, Math.round((promised / Math.max(1, props.need.target)) * 100));
  const urgent = props.need.status === "urgent";
  return (
    <div className="dc-body">
      <section className="dc-card">
        <div className="dc-kv" style={{ alignItems: "center" }}>
          <strong className="dc-h lg">{props.need.name}</strong>
          <span className={`dc-tag ${urgent ? "urgent" : "soft"}`}>{urgent ? "Urgente hoy" : "Se necesita"}</span>
        </div>
        <div className="dc-bar"><i style={{ background: urgent ? "#dc2626" : "#2563eb", width: `${percent}%` }} /></div>
        <span style={{ color: "#64748b", fontSize: "11.5px", fontWeight: 600 }}>
          {promised} de {props.need.target} {props.need.unit} · faltan {remaining}
        </span>
        {props.need.detail && (
          <span className="approx" style={{ marginTop: 6 }}>{props.need.detail}</span>
        )}
      </section>

      {props.center && (
        <section className="dc-card">
          <span className="dc-eyebrow">Entrega en</span>
          <strong className="dc-h" style={{ fontSize: "13.5px", lineHeight: 1.3 }}>{props.center.name}</strong>
          <span className="dc-sub" style={{ fontSize: "12px", lineHeight: 1.45 }}>
            {props.center.address}, {props.center.city}
            {props.center.hours ? <><br />{props.center.hours}</> : null}
          </span>
          <a className="dc-ghost" style={{ display: "block", textAlign: "center", textDecoration: "none" }}
             href={routeUrl(props.center)} target="_blank" rel="noreferrer">Ver ruta en Maps</a>
        </section>
      )}

      <section className="dc-card">
        <div className="dc-kv" style={{ alignItems: "baseline" }}>
          <strong className="dc-h" style={{ fontSize: "13px" }}>¿Cuánto vas a llevar?</strong>
          <span style={{ color: "#94a3b8", fontSize: "11px", fontWeight: 500 }}>máx {remaining}</span>
        </div>
        <div className="dc-step">
          <button type="button" aria-label="Reducir cantidad" onClick={() => props.onQuantity(Math.max(1, props.quantity - 1))}>−</button>
          <span className="dc-step-val">
            <strong style={{ fontSize: "30px", fontWeight: 700 }} aria-live="polite">{props.quantity}</strong>
            <small>{props.need.unit}</small>
          </span>
          <button type="button" className="plus" aria-label="Aumentar cantidad" onClick={() => props.onQuantity(Math.min(Math.max(1, remaining), props.quantity + 1))}>+</button>
        </div>
      </section>

      <p className="dc-note warn">
        Tu compromiso reserva el cupo por 6 horas. Si no llegas, vuelve a quedar disponible para otra persona.
      </p>
    </div>
  );
}

const DONE_TITLES: Record<DoneKind, string> = {
  productos: "Lista publicada",
  recibido: "Entrega registrada",
  manos: "Solicitud enviada",
  saturado: "Saturación registrada",
  donar: "Cupo reservado",
  voluntario: "Confirmado",
};

function DoneScreen({
  kind,
  body,
  note,
  route,
  onHome,
}: { kind: DoneKind; body: string; note: string; route: RouteHint | null; onHome: () => void }) {
  // El diseño separa referencia y hora límite en filas propias: son los dos datos
  // que alguien vuelve a mirar después, y en un párrafo se pierden.
  const reference = /[A-Z0-9]{6,}/.exec(note)?.[0] ?? "";
  const deadline = /\d{1,2}:\d{2}( ?[ap]\.? ?m\.?)?/i.exec(note)?.[0] ?? "";
  return (
    <section className="dc-done">
      <span className="tick" aria-hidden="true"><UiIcon name="check" size={28} /></span>
      <div style={{ display: "grid", gap: 8 }}>
        <h2>{DONE_TITLES[kind]}</h2>
        <p>{body}</p>
      </div>

      {(reference || deadline) && (
        <div className="dc-card">
          {reference && (
            <div className="dc-kv"><span>Referencia</span><strong>{reference}</strong></div>
          )}
          {reference && deadline && <div className="dc-hr" />}
          {deadline && (
            <div className="dc-kv"><span>Hora límite</span><strong className="warn">{deadline}</strong></div>
          )}
        </div>
      )}
      {!reference && !deadline && note && <p className="dc-sub" style={{ margin: 0 }}>{note}</p>}

      {route && (
        <div className="dc-card" style={{ gap: 8 }}>
          <span className="dc-eyebrow">Dónde</span>
          <strong className="dc-h" style={{ fontSize: "13px", lineHeight: 1.25 }}>{route.name}</strong>
          <span className="dc-sub">{route.address}</span>
          <a className="dc-ghost" style={{ display: "block", textAlign: "center", textDecoration: "none" }}
             href={route.url} target="_blank" rel="noreferrer">Abrir ruta</a>
        </div>
      )}

      <button type="button" className="dc-linkbtn" onClick={onHome}>Volver al inicio</button>
    </section>
  );
}

function ActionRow({
  icon,
  title,
  text,
  onClick,
  tag,
}: { icon: IconName; title: string; text: string; onClick: () => void; tag?: string }) {
  return (
    <button type="button" className="row-card" onClick={onClick}>
      <span className="glyph"><UiIcon name={icon} size={21} /></span>
      <span className="copy">
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      {tag ? <span className="tag">{tag}</span> : <UiIcon name="arrow-right" size={19} />}
    </button>
  );
}
