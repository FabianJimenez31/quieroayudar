"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import UiIcon, { type IconName } from "./UiIcon";
import { CATALOG, CATALOG_ITEMS, type CatalogItem } from "./catalog";
import CentersMap from "./CentersMap";
import HoaxesScreen from "./HoaxesScreen";
import InitiativesScreen from "./InitiativesScreen";
import { distanceKm, formatDistance, routeUrl } from "./geo";
import { parseCoordinates } from "./coordinar/centersImport";
import { drawNeedsShareImage } from "./coordinar/shareImage";
import type {
  Cause,
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
  | "ayuda-rol"
  | "tutorial"
  | "afectado"
  | "acopio"
  | "centro-nuevo"
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

/** Borrador del alta de centro público: mismos campos que acepta POST /v1/centers. */
type NewCenterDraft = {
  name: string;
  city: string;
  address: string;
  contact: string;
  hours: string;
  latitude: string;
  longitude: string;
  cause: Cause;
};

const BLANK_NEW_CENTER: NewCenterDraft = {
  name: "",
  city: "",
  address: "",
  contact: "",
  hours: "",
  latitude: "",
  longitude: "",
  cause: "terremoto",
};

const EMPTY: Network = { centers: [], needs: [], volunteerRequests: [], reports: [] };

/**
 * Cada pantalla tiene su propia entrada de historial. Sin esto, el botón atrás de Android
 * cierra la PWA instalada en vez de retroceder, y entrar a una pantalla sin `vista`
 * destruía el enlace con el que había llegado el usuario.
 */
const SCREEN_QUERY: Record<Screen, string> = {
  roles: "",
  "ayuda-rol": "pedir-ayuda",
  tutorial: "como-funciona",
  afectado: "afectado",
  acopio: "acopio",
  "centro-nuevo": "nuevo-centro",
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

/** Las dos emergencias activas hoy. "terremoto" es la causa por defecto. */
const CAUSES: { id: Cause; label: string; short: string }[] = [
  { id: "terremoto", label: "Terremoto", short: "Terremoto" },
  { id: "tolima", label: "Incendios en el Tolima", short: "Tolima" },
];

function causeOf(center: Center): Cause {
  return center.cause ?? "terremoto";
}

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

const ROLES: { id: Role; code: string; title: string; text: string; resumeLabel: string }[] = [
  { id: "acopio", code: "AC", title: "Centro de acopio", text: "Lidero un centro de acopio", resumeLabel: "centro de acopio" },
  { id: "afectado", code: "PA", title: "Zona afectada", text: "Estoy en el sitio del desastre", resumeLabel: "zona afectada" },
  { id: "logistica", code: "LG", title: "Ser voluntario", text: "Poner el cuerpo en un centro o en la calle", resumeLabel: "voluntario" },
  { id: "donante", code: "DN", title: "Quiero donar", text: "Productos que hacen falta ahora mismo", resumeLabel: "donante" },
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
  // Qué emergencia se está mirando: filtra los centros que se muestran en toda la app.
  // "terremoto" es la causa por defecto.
  const [cause, setCause] = useState<Cause>("terremoto");
  const [newCenter, setNewCenter] = useState<NewCenterDraft>(BLANK_NEW_CENTER);
  const [network, setNetwork] = useState<Network>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  // Solo el flujo de donante acota por radio; null = sin filtro de radio.
  const [donorRadiusKm, setDonorRadiusKm] = useState<number | null>(null);
  // Vive aquí y no en la pantalla de puntos para que el acceso directo del inicio
  // pueda abrirla directamente en mapa, sin obligar a tocar el interruptor.
  const [pointsView, setPointsView] = useState<"lista" | "mapa">("lista");

  const [city, setCity] = useState("");
  const [reference, setReference] = useState("");
  const [levels, setLevels] = useState<Record<string, Level>>({});
  const [targets, setTargets] = useState<Record<string, number>>({});
  // Productos fuera del catálogo fijo, agregados a mano desde "Otro producto".
  const [customItems, setCustomItems] = useState<CatalogItem[]>([]);
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
  const [sharing, setSharing] = useState(false);

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
    const savedCause = window.localStorage.getItem("ra.cause");
    if (savedCause && CAUSES.some((item) => item.id === savedCause)) setCause(savedCause as Cause);

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
    setCustomItems([]);
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
    setCustomItems([]);
    setProductsContext("");
  }

  function openNewCenter() {
    // Parte de la causa que se está mirando en el inicio; se puede cambiar en el formulario.
    setNewCenter({ ...BLANK_NEW_CENTER, cause });
    navigate("centro-nuevo");
  }

  /** Alta pública de centro: el back la acepta sin código de coordinador. */
  async function submitNewCenter() {
    const name = newCenter.name.trim();
    const cityValue = newCenter.city.trim();
    const address = newCenter.address.trim();
    const latitude = Number(newCenter.latitude);
    const longitude = Number(newCenter.longitude);
    if (!name || !cityValue || !address) {
      flash("Completa nombre, ciudad y dirección.");
      return;
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      flash("Falta la ubicación del centro.");
      return;
    }

    const result = await send("/api/centers", "POST", {
      name,
      city: cityValue,
      address,
      contact: newCenter.contact.trim(),
      hours: newCenter.hours.trim(),
      latitude,
      longitude,
      cause: newCenter.cause,
    });
    if (!result.ok) return;
    const created = result.data.center as Center | undefined;
    if (!created) return;
    setNetwork((current) => ({ ...current, centers: [created, ...current.centers] }));
    // Si se creó para la otra causa, cámbiate a esa vista para que el centro nuevo se vea de inmediato.
    if (newCenter.cause !== cause) updateCause(newCenter.cause);
    chooseCenter(created.id);
    setNewCenter(BLANK_NEW_CENTER);
    flash("Centro publicado. Ya aparece en el mapa.");
    navigate("acopio");
  }

  function updateCity(value: string) {
    setCity(value);
    window.localStorage.setItem("ra.city", value);
  }

  function updateCause(value: Cause) {
    setCause(value);
    window.localStorage.setItem("ra.cause", value);
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

  // Todo lo que se explora (mapa, listas, metas) se acota a la causa elegida en el
  // inicio. El centro propio (myCenter/myNeeds, arriba) no se filtra: quien ya
  // coordina un punto no puede perderlo de vista por cambiar de pestaña de causa.
  const visibleCenters = useMemo(
    () => network.centers.filter((center) => causeOf(center) === cause),
    [network.centers, cause],
  );
  const visibleCenterIds = useMemo(() => new Set(visibleCenters.map((center) => center.id)), [visibleCenters]);
  const visibleNeeds = useMemo(
    () => network.needs.filter((need) => visibleCenterIds.has(need.centerId)),
    [network.needs, visibleCenterIds],
  );
  const visibleVolunteerRequests = useMemo(
    () => network.volunteerRequests.filter((request) => visibleCenterIds.has(request.centerId)),
    [network.volunteerRequests, visibleCenterIds],
  );

  const pulse = useMemo(
    () =>
      buildPulse(
        { centers: visibleCenters, needs: visibleNeeds, volunteerRequests: visibleVolunteerRequests, reports: network.reports },
        position,
      ),
    [visibleCenters, visibleNeeds, visibleVolunteerRequests, network.reports, position],
  );

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
      // Necesidades ya publicadas que no vienen del catálogo fijo: se agregaron a mano
      // en una sesión anterior con "Otro producto" y deben poder seguir editándose.
      const catalogNames = new Set(CATALOG_ITEMS.map((item) => item.name.toLowerCase()));
      const nextCustom: CatalogItem[] = [];
      if (centerId) {
        for (const need of network.needs) {
          if (need.centerId !== centerId || catalogNames.has(need.name.toLowerCase())) continue;
          nextCustom.push({ name: need.name, unit: need.unit, step: 1, start: need.target });
          nextLevels[need.name] = need.status;
          nextTargets[need.name] = need.target;
        }
      }
      setLevels(nextLevels);
      setTargets(nextTargets);
      setCustomItems(nextCustom);
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
        if (screen === "donante") {
          setDonorRadiusKm(5);
          flash("Ubicación activada. Radio de 5 km.");
        } else {
          flash("Ubicación activada. Ordenamos por cercanía.");
        }
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

  const allProductItems = useMemo(() => [...CATALOG_ITEMS, ...customItems], [customItems]);
  const urgentCount = allProductItems.filter((item) => levels[item.name] === "urgent").length;
  const blockedCount = allProductItems.filter((item) => levels[item.name] === "blocked").length;

  /** Producto fuera del catálogo, agregado a mano desde "Otro producto". */
  function addCustomProduct(name: string, unit: string) {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const key = trimmedName.toLowerCase();
    if (allProductItems.some((item) => item.name.toLowerCase() === key)) {
      flash(`"${trimmedName}" ya está en la lista.`);
      return;
    }
    setCustomItems((current) => [...current, { name: trimmedName, unit: unit.trim() || "unidades", step: 1, start: 1 }]);
    setLevels((current) => ({ ...current, [trimmedName]: "urgent" }));
    setTargets((current) => ({ ...current, [trimmedName]: 1 }));
  }

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
    const customNames = new Set(customItems.map((item) => item.name.toLowerCase()));
    if (role === "acopio") {
      if (!myCenter) { flash("Elige primero tu centro de acopio."); return; }
      const published = new Set(
        network.needs.filter((need) => need.centerId === myCenter.id).map((need) => need.name.toLowerCase()),
      );
      // Solo se publica lo marcado. "Se necesita" viaja únicamente si ya existía,
      // para poder bajarlo de urgente sin inundar la lista de los donantes. Los
      // productos agregados a mano ("Otro producto") sí viajan aunque queden en
      // "Se necesita": agregarlos ya fue una acción explícita.
      const products = allProductItems.filter((item) => {
        const level = levels[item.name];
        if (!level) return false;
        if (customNames.has(item.name.toLowerCase())) return true;
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
    const touched = allProductItems.filter((item) => {
      const level = levels[item.name];
      if (!level) return false;
      return customNames.has(item.name.toLowerCase()) || level !== "normal";
    });
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

  /**
   * Se publica solo al reabrir: la red no tiene push, así que este reporte en el
   * feed es lo único que avisa a donantes y voluntarios que vuelven a hacer falta.
   */
  async function notifyReopened(category: "saturation" | "hands", detail: string) {
    if (!myCenter) return;
    await send("/api/network", "POST", {
      action: "report",
      category,
      city: myCenter.city,
      location: myCenter.name,
      details: detail,
    });
    void sync();
  }

  async function setDonationsAccepting(accepting: boolean) {
    if (!myCenter) return;
    const name = myCenter.name;
    if (!(await setCenterSaturated(!accepting))) return;
    if (accepting) {
      flash("Avisamos a la red que vuelves a recibir donaciones.");
      void notifyReopened("saturation", `${name} vuelve a aceptar donaciones.`);
    } else {
      flash("Dejas de aparecer como destino sugerido.");
    }
  }

  /** Cambia a qué emergencia sirve el propio centro. Puede ir en los dos sentidos. */
  async function setCenterCause(next: Cause) {
    if (!myCenter || myCenter.cause === next) return;
    const previous = causeOf(myCenter);
    patchMyCenter({ cause: next });
    const result = await send("/api/centers", "PATCH", { id: myCenter.id, cause: next });
    if (result.ok) {
      // Se sigue viendo el propio centro sin importar qué causa se esté explorando en el inicio.
      updateCause(next);
      void sync();
      flash(`Este centro ahora aparece en ${CAUSES.find((item) => item.id === next)?.short ?? next}.`);
    } else {
      patchMyCenter({ cause: previous });
    }
  }

  async function setVolunteersAccepting(accepting: boolean) {
    if (!myCenter) return;
    const name = myCenter.name;
    const saturated = !accepting;
    patchMyCenter({ volunteersSaturated: saturated });
    const result = await send("/api/centers", "PATCH", { id: myCenter.id, volunteersSaturated: saturated });
    void sync();
    if (!result.ok) { patchMyCenter({ volunteersSaturated: !saturated }); return; }
    if (accepting) {
      flash("Avisamos a la red que vuelves a aceptar voluntarios.");
      void notifyReopened("hands", `${name} vuelve a aceptar voluntarios.`);
    } else {
      flash("Los voluntarios nuevos verán otros centros primero.");
    }
  }

  async function submitSaturation() {
    const option = SATURATION_OPTIONS.find((item) => item.id === saturationReason) ?? SATURATION_OPTIONS[0];
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

  /**
   * Genera la tarjeta de necesidades del centro y abre el share-sheet nativo
   * (Instagram aparece ahí si está instalada). Sin share-sheet, descarga el
   * PNG para subirlo a mano.
   */
  async function shareCenterNeeds() {
    if (!myCenter) return;
    const items = myNeeds
      .filter((need) => need.status !== "blocked")
      .map((need) => ({
        name: need.name,
        unit: need.unit,
        remaining: Math.max(0, need.target - need.covered - need.committed),
        urgent: need.status === "urgent",
      }))
      .filter((need) => need.remaining > 0)
      .sort((a, b) => Number(b.urgent) - Number(a.urgent));

    if (items.length === 0) {
      flash("Todavía no tienes productos pendientes por compartir.");
      return;
    }

    setSharing(true);
    try {
      await document.fonts.ready;
      const canvas = document.createElement("canvas");
      drawNeedsShareImage(canvas, myCenter, items);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("No pudimos generar la imagen.");

      const file = new File([blob], `necesidades-${norm(myCenter.name).replace(/\s+/g, "-")}.png`, { type: "image/png" });
      const shareData: ShareData = {
        files: [file],
        title: "Necesitamos tu ayuda",
        text: `${myCenter.name} está pidiendo apoyo. Dona o entrega en quieroayudar.co`,
      };

      if (navigator.canShare?.(shareData)) {
        try {
          await navigator.share(shareData);
          return;
        } catch (caught) {
          if (caught instanceof Error && caught.name === "AbortError") return;
        }
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
      flash("Imagen descargada. Súbela a Instagram desde tu galería.");
    } catch (caught) {
      flash(caught instanceof Error ? caught.message : "No pudimos generar la imagen.");
    } finally {
      setSharing(false);
    }
  }

  /* ───────── Navegación ───────── */

  const home: Screen = role ?? "roles";

  // Delegar en el historial mantiene coherente la flecha de la app con el atrás del sistema.
  function goBack() {
    setToast("");
    window.history.back();
  }

  const HEADERS: Partial<Record<Screen, [string, string]>> = {
    "ayuda-rol": ["Punto de acopio o zona afectada", "Puedes cambiarlo después"],
    afectado: ["Zona afectada", city || "Indica dónde estás"],
    acopio: [
      myCenter?.name ?? "Centro de acopio",
      myCenter ? `${myCenter.address} · ${myCenter.city}` : "Elige tu centro",
    ],
    "centro-nuevo": ["Registrar centro de acopio", "Aparece de inmediato en el mapa"],
    tutorial: ["Cómo funciona", "Cuatro caminos, ninguno pide registro"],
    productos: ["Productos", role === "acopio" ? "Marca estado y meta" : "Marca el estado de cada uno"],
    recibido: ["Registrar lo que llegó", myCenter?.name ?? "Elige tu centro"],
    manos: ["Solicitar manos", "Se avisa a voluntarios cercanos"],
    saturado: ["Marcar saturación", city || "Zona afectada"],
    personas: ["Persona encontrada", "Atención de emergencias"],
    logistica: [
      "¿Dónde hago falta?",
      `${visibleCenters.filter((item) => item.status === "active").length} centros activos`,
    ],
    donante: ["Se necesita ahora", "Priorizado por los centros"],
    donar: ["Comprometer donación", "Reserva por 6 horas"],
    iniciativas: ["Iniciativas corporativas", "Empresas con canal abierto para donar"],
    bulos: ["Noticias falsas", "Verificadas y desmentidas"],
  };
  const header = HEADERS[screen];

  const pledgeNeed = network.needs.find((need) => need.id === pledgeNeedId);

  const CTA_LABELS: Partial<Record<Screen, string>> = {
    productos: role === "acopio" ? "Publicar lista" : "Publicar reporte",
    recibido: myNeeds.length > 0 ? "Registrar entrega" : undefined,
    manos: "Enviar solicitud",
    "centro-nuevo": "Publicar centro",
    saturado: "Publicar alerta",
    // Sin necesidad no hay nada que comprometer: un botón inerte es peor que ninguno.
    donar: pledgeNeed ? "Comprometer donación" : undefined,
    done: "Volver al inicio",
  };
  const cta = CTA_LABELS[screen];

  function runCta() {
    if (screen === "productos") void submitProducts();
    else if (screen === "recibido") void submitReceived();
    else if (screen === "manos") void submitHands();
    else if (screen === "centro-nuevo") void submitNewCenter();
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
          { label: "Inicio", icon: "home", target: "roles" },
        ]
      : role === "logistica"
        ? [
            { label: "Puntos", icon: "location", target: "logistica" },
            // { label: "Urgente", icon: "alert", target: "donante" },
            { label: "Inicio", icon: "home", target: "roles" },
          ]
        : [
            // { label: "Inicio", icon: "home", target: home },
            { label: "Productos", icon: "package", target: "productos" },
            { label: "Inicio", icon: "home", target: "roles" },
            // { label: "Yo", icon: "users", target: "roles" },
          ];

  const showTabs =
    role !== null && ["afectado", "acopio", "logistica", "donante", "iniciativas"].includes(screen);

  /* ───────── Datos derivados ───────── */

  const activeNeeds = useMemo(() => {
    const byId = new Map(visibleCenters.map((center) => [center.id, center]));
    return visibleNeeds.filter(
      (need) => need.status !== "blocked" && byId.get(need.centerId)?.status === "active" && remainingOf(need) > 0,
    );
  }, [visibleCenters, visibleNeeds]);

  const sortedCenters = useMemo(() => {
    // Primero los que reciben ayuda, luego los que ya tienen bastantes voluntarios,
    // y al final los saturados. Dentro de cada grupo manda la cercanía.
    const rank = (center: Center) =>
      center.status === "saturated" ? 2 : center.volunteersSaturated ? 1 : 0;
    const list = [...visibleCenters];
    list.sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      if (position) {
        const byDistance = distanceKm(position, a) - distanceKm(position, b);
        if (byDistance !== 0) return byDistance;
      }
      const byNeed =
        urgencyScore(b, visibleNeeds, visibleVolunteerRequests) -
        urgencyScore(a, visibleNeeds, visibleVolunteerRequests);
      if (byNeed !== 0) return byNeed;
      return a.name.localeCompare(b.name, "es");
    });
    return list;
  }, [visibleCenters, visibleNeeds, visibleVolunteerRequests, position]);

  const knownCities = useMemo(
    () => Array.from(new Set(visibleCenters.map((center) => center.city))).sort((a, b) => a.localeCompare(b, "es")),
    [visibleCenters],
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
           Ubicar
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
            cause={cause}
            onCause={updateCause}
            onPick={chooseRole}
            onAyuda={() => navigate("ayuda-rol")}
            onTutorial={() => navigate("tutorial")}
            onHoaxes={() => navigate("bulos")}
            onInitiatives={() => navigate("iniciativas")}
            onMap={() => {
              setPointsView("mapa");
              navigate("logistica");
            }}
            onNeeds={() => navigate("donante")}
          />
        )}

        {screen === "ayuda-rol" && <AyudaRoleScreen role={role} onPick={chooseRole} />}

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
            onCreateCenter={openNewCenter}
            onProducts={openProducts}
            onReceived={openReceived}
            onHands={() => navigate("manos")}
            onCause={(value) => void setCenterCause(value)}
            onDonationsAccepting={(value) => void setDonationsAccepting(value)}
            onVolunteersAccepting={(value) => void setVolunteersAccepting(value)}
            sharing={sharing}
            onShare={() => void shareCenterNeeds()}
          />
        )}

        {screen === "centro-nuevo" && (
          <NewCenterScreen
            draft={newCenter}
            onDraft={setNewCenter}
            cities={knownCities}
            locating={locating}
            onFlash={flash}
          />
        )}

        {screen === "productos" && (
          <ProductsScreen
            withTargets={role === "acopio"}
            levels={levels}
            targets={targets}
            urgentCount={urgentCount}
            blockedCount={blockedCount}
            customItems={customItems}
            onLevel={(name, level) => setLevels((current) => ({ ...current, [name]: level }))}
            onTarget={(name, value) => setTargets((current) => ({ ...current, [name]: value }))}
            onAddCustom={addCustomProduct}
          />
        )}

        {screen === "manos" && (
          <HandsScreen kind={handKind} quantity={handQuantity} onKind={setHandKind} onQuantity={setHandQuantity} />
        )}

        {screen === "saturado" && (
          <SaturationScreen
            reason={saturationReason}
            onReason={setSaturationReason}
            alternatives={sortedCenters.filter((center) => center.status === "active").slice(0, 3)}
            needs={visibleNeeds}
            position={position}
          />
        )}

        {screen === "personas" && <PeopleScreen />}

        {screen === "logistica" && (
          <LogisticsScreen
            centers={sortedCenters}
            needs={visibleNeeds}
            requests={visibleVolunteerRequests}
            position={position}
            onLocate={locate}
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
            centers={visibleCenters}
            position={position}
            radiusKm={donorRadiusKm}
            onClearRadius={() => setDonorRadiusKm(null)}
            onExpandRadius={() =>
              setDonorRadiusKm((current) => (current === null ? null : current < 15 ? 15 : null))
            }
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

        {screen === "done" && <DoneScreen kind={doneKind} body={doneBody} note={doneNote} route={doneRoute} />}
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
  cause: Cause;
  onCause: (cause: Cause) => void;
  onPick: (role: Role) => void;
  onAyuda: () => void;
  onTutorial: () => void;
  onHoaxes: () => void;
  onInitiatives: () => void;
  onMap: () => void;
  onNeeds: () => void;
}) {
  const { pulse } = props;
  const saved = ROLES.find((item) => item.id === props.role);
  const donar = ROLES.find((item) => item.id === "donante")!;
  const voluntario = ROLES.find((item) => item.id === "logistica")!;
  const where = (center: Center) =>
    `${center.name} · ${center.city}${
      props.position ? ` · a ${formatDistance(distanceKm(props.position, center))}` : ""
    }`;

  return (
    <section className="roles">

      <div className="roles-head">
        <h1>QuieroAyudar.co</h1>
        <button type="button" className="pill soft howto-pill" onClick={props.onTutorial}>
          ¿Cómo funciona?
        </button>
      </div>

      {/* Dos emergencias activas a la vez: esto elige cuál se ve en el resto de la app. */}
      <div className="cause-switch" role="radiogroup" aria-label="Emergencia a apoyar">
        {CAUSES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={props.cause === item.id}
            className={`cause-option${props.cause === item.id ? " on" : ""} cause-${item.id}`}
            onClick={() => props.onCause(item.id)}
          >
            <UiIcon name={item.id === "tolima" ? "flame" : "alert"} size={18} />
            {item.label}
          </button>
        ))}
      </div>

            {/*
        Atajos a lo que sirve sin haber elegido rol todavía: ver dónde están los
        puntos, qué se está pidiendo y qué empresas están recibiendo donaciones.
        No fijan rol a propósito: mirar no es comprometerse.
      */}
      
      <nav className="shortcuts" aria-label="Accesos directos">
        <button type="button" onClick={props.onMap}>
          <span><UiIcon name="location" size={16} /></span>
          Puntos de Acopio
        </button>
        <button type="button" onClick={props.onNeeds}>
          <span><UiIcon name="alert" size={16} /></span>
          Productos Urgentes
        </button>
        <button type="button" onClick={props.onInitiatives}>
          <span><UiIcon name="reports" size={16} /></span>
          Iniciativas
        </button>
      </nav>


      {saved && (
        <button type="button" className="row-card resume" onClick={() => props.onPick(saved.id)}>
          <span className="code">{saved.code}</span>
          <span className="copy">
            <strong>Seguir como {saved.resumeLabel}</strong>
            <small>Retomas donde ibas, con tu centro y tus marcas</small>
          </span>
          <UiIcon name="arrow-right" size={20} />
        </button>
      )}



      <h2><strong>¿Qué quieres hacer?</strong></h2>
      <p className="lead-text">Entra sin registro. Puedes cambiar de role cuando quieras.</p>

      <div className="stack">
        <button type="button" className="row-card" onClick={() => props.onPick(donar.id)}>
          <span className="code">
            <UiIcon name="package" size={20} />
          </span>
          <span className="copy">
            <strong>{donar.title}</strong>
            <small>{donar.text}</small>
          </span>
          <UiIcon name="arrow-right" size={20} />
        </button>
        <button type="button" className="row-card" onClick={() => props.onPick(voluntario.id)}>
          <span className="code">
            
          <UiIcon name="users" size={20} />

          </span>
          <span className="copy">
            <strong>{voluntario.title}</strong>
            <small>{voluntario.text}</small>
          </span>
          <UiIcon name="arrow-right" size={20} />
        </button>
        <button type="button" className="row-card" onClick={props.onAyuda}>
          <span className="code"><UiIcon name="location" size={20} /></span>

          <span className="copy">
            <strong>Gestionar punto de acopio o zona afectada</strong>
            <small>Reportar lo que falta en tu zona o centro</small>
          </span>
          <UiIcon name="arrow-right" size={20} />
        </button>

        {/*
          Alta de centros: quien coordina un acopio entra al panel completo, donde
          puede registrar uno a uno o subir el listado entero en Excel. Va aquí,
          entre las cajas de inicio, porque llega gente con la lista ya hecha.
        */}
        {/* <a className="row-card coord-entry" href="/coordinar">
          <span className="code">CA</span>
          <span className="copy">
            <strong>Registrar centros de acopio</strong>
            <small>Panel de coordinación: alta individual o carga masiva por Excel</small>
          </span>
          <UiIcon name="arrow-right" size={20} />
        </a> */}
      </div>

      <section className="howto-card">
        <strong>¿Es tu primera vez?</strong>
        <p>
          No necesitas cuenta. Elige una puerta y la app te va guiando. Solo pedimos verificar
          identidad para reportar personas heridas.
        </p>
        <button type="button" className="ghost-row" onClick={props.onTutorial}>
          <UiIcon name="alert" size={18} />
          Ver los pasos
        </button>
      </section>

      <button type="button" className="ghost-row" onClick={props.onHoaxes}>
        <UiIcon name="close" size={17} />
        Noticias falsas que están circulando
      </button>

      <section className="pulse">
        <h2>Ahora mismo</h2>
        <div className="figures">
          <div><strong>{pulse.centers}</strong><small>puntos activos</small></div>
          <div><strong>{pulse.cities}</strong><small>ciudades</small></div>
          {/* <div><strong>{pulse.hands}</strong><small>manos en terreno</small></div> */}
        </div>

        {/* <article className="pulse-card">
          <h3><UiIcon name="package" size={17} />Se necesita ahora</h3>
          {pulse.missing.length === 0 ? (
            <PulseEmpty
              text="Ningún centro ha publicado qué le falta."
              action="Atiendo un centro y quiero publicarlo"
              onAction={() => props.onPick("acopio")}
            />
          ) : (
            <ul>
              {pulse.missing.map((row) => (
                <li key={row.need.id}>
                  <strong>
                    {row.missing} {row.need.unit} de {row.need.name}
                  </strong>
                  <small>{where(row.center)}</small>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="pulse-card">
          <h3><UiIcon name="check" size={17} />Lo que ya se logró</h3>
          {pulse.goal === 0 ? (
            <PulseEmpty
              text="Todavía no hay metas publicadas que medir."
              action="Publicar lo que necesita mi centro"
              onAction={() => props.onPick("acopio")}
            />
          ) : (
            <>
              <p className="big">
                {pulse.delivered} <span>de {pulse.goal} entregados</span>
              </p>
              <div className="bar" role="img" aria-label={`${pulse.delivered} de ${pulse.goal} entregados`}>
                <i style={{ width: `${Math.min(100, Math.round((pulse.delivered / pulse.goal) * 100))}%` }} />
              </div>
              <small>
                {pulse.promised > 0
                  ? `${pulse.promised} más van en camino, ya prometidos por donantes.`
                  : "Cuenta solo lo que los centros confirmaron haber recibido."}
              </small>
            </>
          )}
        </article>

        <article className="pulse-card">
          <h3><UiIcon name="users" size={17} />Quién está trabajando</h3>
          {pulse.working.length === 0 ? (
            <PulseEmpty
              text="Nadie se ha apuntado todavía a una tarea."
              action="Puedo ir a echar una mano"
              onAction={() => props.onPick("logistica")}
            />
          ) : (
            <ul>
              {pulse.working.map((row) => (
                <li key={row.request.id}>
                  <strong>
                    {row.request.accepted} {row.request.accepted === 1 ? "persona" : "personas"} en {row.request.kind}
                  </strong>
                  <small>{where(row.center)}</small>
                </li>
              ))}
            </ul>
          )}
        </article> */}

        <article className="pulse-card">
          <h3><UiIcon name="alert" size={17} />Dónde faltan manos</h3>
          {pulse.wanted.length === 0 ? (
            <PulseEmpty
              text="Ningún centro ha pedido voluntarios."
              action="Atiendo un centro y necesito gente"
              onAction={() => props.onPick("acopio")}
            />
          ) : (
            <ul>
              {pulse.wanted.map((row) => (
                <li key={row.request.id}>
                  <strong>
                    Faltan {row.missing} para {row.request.kind}
                  </strong>
                  <small>{where(row.center)}</small>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <p className="fineprint">
        Si hay vidas en riesgo, llama al <a href="tel:123">123</a> antes de publicar aquí.
      </p>
    </section>
  );
}

/**
 * "Pedir ayuda" agrupa dos roles distintos (afectado y acopio) detrás de una sola
 * puerta. Se confirma el rol aquí aunque venga premarcado por el dispositivo: el
 * teléfono puede ser compartido y elegir el rol equivocado manda al flujo equivocado.
 */
function AyudaRoleScreen({ role, onPick }: { role: Role | null; onPick: (role: Role) => void }) {
  const options = ROLES.filter((item) => item.id === "afectado" || item.id === "acopio");

  return (
    <section className="roles">
      <h1>¿En dónde estas?</h1>

      <div className="stack">
        {options.map((option) => (
          <button key={option.id} type="button" className="row-card" onClick={() => onPick(option.id)}>
            <span className="code">{option.code}</span>
            <span className="copy">
              <strong>{option.title}</strong>
              <small>{option.text}</small>
            </span>
            {option.id === role && <span className="tag">ÚLTIMA VEZ</span>}
            <UiIcon name="arrow-right" size={20} />
          </button>
        ))}
      </div>
    </section>
  );
}

/** Un hueco vacío que propone la acción que lo llenaría, en vez de dar lástima. */
function PulseEmpty(props: { text: string; action: string; onAction: () => void }) {
  return (
    <div className="pulse-empty">
      <p>{props.text}</p>
      <button type="button" onClick={props.onAction}>{props.action}</button>
    </div>
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
    <>
      <section className="place-card">
        <span className="eyebrow">¿Dónde estás?</span>
        <label>
          <span>Ciudad o municipio</span>
          <input
            list="ciudades-conocidas"
            value={props.city}
            onChange={(event) => props.onCity(event.target.value)}
            autoComplete="address-level2"
            placeholder="Ej. Bogotá"
          />
          <datalist id="ciudades-conocidas">
            {props.cities.map((city) => <option key={city} value={city} />)}
          </datalist>
        </label>
        <label>
          <span>Barrio o referencia <small>opcional</small></span>
          <div className="with-button">
            <input
              value={props.reference}
              onChange={(event) => props.onReference(event.target.value)}
              placeholder={props.gpsLabel || "Barrio, vereda o punto conocido"}
            />
            <button type="button" onClick={props.onLocate} disabled={props.locating} aria-label="Usar mi ubicación">
              <UiIcon name="location" size={19} />
            </button>
          </div>
        </label>
      </section>

      <div className="stack">
        <ActionRow icon="package" title="Productos que necesitamos" text="Marca urgente, se necesita o ya hay" onClick={props.onProducts} />
        <ActionRow icon="users" title="Solicitar manos" text="Escombros, médicos, cocina, conductores" onClick={props.onHands} />
        <ActionRow icon="alert" title="Reportar saturación" text="Que dejen de llegar a este punto" onClick={props.onSaturation} />
        <ActionRow icon="reports" title="Persona herida o atrapada" text="Atención oficial de emergencias" onClick={props.onPeople} tag="123" />
      </div>

      {nearby.length > 0 && (
        <section className="feed">
          <h2>Publicado desde el terreno</h2>
          {nearby.map((report) => (
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
  onCreateCenter: () => void;
  onProducts: () => void;
  onReceived: () => void;
  onHands: () => void;
  onCause: (value: Cause) => void;
  onDonationsAccepting: (value: boolean) => void;
  onVolunteersAccepting: (value: boolean) => void;
  sharing: boolean;
  onShare: () => void;
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
          <>
            <p className="empty">Todavía no hay centros publicados.</p>
            <button type="button" className="link-row" onClick={props.onCreateCenter}>
            <UiIcon name="plus" size={16} />
            Crea un centro de acopio aquí.
          </button>
          </>
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
          {matching.length === 0 && 
          <>
            <p className="empty">Ningún centro coincide con “{query}”.</p>
            <button type="button" className="link-row" onClick={props.onCreateCenter}>
              <UiIcon name="plus" size={16} />
              Crea un centro de acopio aquí.
            </button>
          </>
          }
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
        
      </section>
    );
  }

  const urgent = props.needs.filter((need) => need.centerId === center.id && need.status === "urgent").length;
  const needed = props.needs.filter((need) => need.centerId === center.id && need.status === "normal").length;
  const hands = props.requests
    .filter((item) => item.centerId === center.id && item.status === "open")
    .reduce((sum, item) => sum + Math.max(0, item.quantity - item.accepted), 0);
  const inbox = props.reports.filter((report) => report.city === center.city).slice(0, 3);

  return (
    <>
      <section className="summary">
        <div><strong>{urgent}</strong><small>productos urgentes</small></div>
        <div><strong>{needed}</strong><small>productos necesitados</small></div>
        <div><strong>{hands}</strong><small>manos solicitadas</small></div>
      </section>

      <section className="switch-card">
        <div>
          <strong>Se aceptan donaciones</strong>
          <small>
            {center.status === "saturated"
              ? "No apareces como destino sugerido. Actívalo cuando vuelvas a recibir."
              : "Apágalo si dejas de recibir gente y donaciones."}
          </small>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={center.status !== "saturated"}
          aria-label="Se aceptan donaciones"
          className={center.status !== "saturated" ? "on" : ""}
          disabled={props.busy}
          onClick={() => props.onDonationsAccepting(center.status === "saturated")}
        >
          <i />
        </button>
      </section>

      <section className="switch-card">
        <div>
          <strong>Se aceptan voluntarios</strong>
          <small>
            {center.volunteersSaturated
              ? "Los voluntarios nuevos ven otros centros primero. Actívalo cuando necesites más."
              : "Apágalo si ya tienes suficientes voluntarios."}
          </small>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!center.volunteersSaturated}
          aria-label="Se aceptan voluntarios"
          className={!center.volunteersSaturated ? "on" : ""}
          disabled={props.busy}
          onClick={() => props.onVolunteersAccepting(Boolean(center.volunteersSaturated))}
        >
          <i />
        </button>
      </section>

      <button type="button" className="ghost-row" disabled={props.sharing} onClick={props.onShare}>
        <UiIcon name="share" size={18} />
        {props.sharing ? "Generando imagen…" : "Compartir necesidades en Instagram"}
      </button>

      <div className="stack">
        <ActionRow icon="package" title="Publicar qué necesitamos" text="Estado y meta por producto" onClick={props.onProducts} />
        <ActionRow icon="check" title="Registrar lo que llegó" text="Baja la meta para todos" onClick={props.onReceived} />
        <ActionRow icon="users" title="Solicitar manos" text="Tarea y número de personas" onClick={props.onHands} />
        <ActionRow icon="building" title="Cambiar de centro" text="Elegir otro acopio en este dispositivo" onClick={props.onChangeCenter} />
      </div>

      <section className="place-card">
        <label>
          <span>Causa a la que apoya este centro</span>
          <div className="cause-switch" role="radiogroup" aria-label="Causa del centro">
            {CAUSES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={causeOf(center) === item.id}
                className={`cause-option${causeOf(center) === item.id ? " on" : ""} cause-${item.id}`}
                onClick={() => props.onCause(item.id)}
              >
                <UiIcon name={item.id === "tolima" ? "flame" : "alert"} size={18} />
                {item.short}
              </button>
            ))}
          </div>
        </label>
      </section>

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

/**
 * Alta pública de un centro nuevo: el back ya la acepta sin código de coordinador
 * (POST /v1/centers), así que no hace falta mandar a nadie a /coordinar para esto.
 */
function NewCenterScreen(props: {
  draft: NewCenterDraft;
  onDraft: Dispatch<SetStateAction<NewCenterDraft>>;
  cities: string[];
  locating: boolean;
  onFlash: (text: string) => void;
}) {
  const set = props.onDraft;
  const [link, setLink] = useState("");
  const [resolvingLink, setResolvingLink] = useState(false);
  const [resolvingPosition, setResolvingPosition] = useState(false);
  const located = props.draft.latitude !== "" && props.draft.longitude !== "";

  // Rellena nombre/dirección/ciudad sin pisar lo que la persona ya haya escrito a mano.
  function fillPlaceDetails(data: { name: string | null; address: string | null; city: string | null }) {
    if (!data.name && !data.address && !data.city) return false;
    set((current) => ({
      ...current,
      name: current.name.trim() ? current.name : data.name ?? current.name,
      city: current.city.trim() ? current.city : data.city ?? current.city,
      address: current.address.trim() ? current.address : data.address ?? current.address,
    }));
    return true;
  }

  function takePosition() {
    if (!("geolocation" in navigator)) {
      props.onFlash("Este dispositivo no permite compartir ubicación.");
      return;
    }
    props.onFlash("Buscando tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (result) => {
        const latitude = result.coords.latitude;
        const longitude = result.coords.longitude;
        set((current) => ({ ...current, latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) }));
        props.onFlash("Ubicación tomada.");
        void fillPositionDetails(latitude, longitude);
      },
      () => props.onFlash("No pudimos leer tu ubicación. Pega el enlace del mapa."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  // La ubicación por GPS solo trae coordenadas: se completan nombre/dirección/ciudad
  // con la misma geocodificación inversa (Nominatim) que usa el enlace de Maps.
  async function fillPositionDetails(latitude: number, longitude: number) {
    setResolvingPosition(true);
    try {
      const response = await fetch(`/api/reverse-geocode?lat=${latitude}&lng=${longitude}`);
      if (!response.ok) return;
      const data = (await response.json()) as { name: string | null; address: string | null; city: string | null };
      if (fillPlaceDetails(data)) props.onFlash("Nombre y dirección tomados de tu ubicación.");
    } catch {
      // Silencioso: ya quedó la ubicación tomada, esto es solo un complemento.
    } finally {
      setResolvingPosition(false);
    }
  }

  function applyCoordinates(found: { latitude: number; longitude: number }) {
    set((current) => ({ ...current, latitude: found.latitude.toFixed(6), longitude: found.longitude.toFixed(6) }));
    props.onFlash("Ubicación tomada del enlace.");
  }

  async function applyLink(value: string) {
    setLink(value);
    const trimmed = value.trim();
    const found = parseCoordinates(trimmed);
    if (found) applyCoordinates(found);

    if (!/^https?:\/\//i.test(trimmed)) return;

    setResolvingLink(true);
    try {
      const response = await fetch(`/api/resolve-map-link?url=${encodeURIComponent(trimmed)}`);
      if (!response.ok) {
        if (!found) props.onFlash("No pudimos leer ese enlace. Prueba con las coordenadas.");
        return;
      }
      const data = (await response.json()) as {
        latitude: number | null;
        longitude: number | null;
        name: string | null;
        address: string | null;
        city: string | null;
      };
      if (!found && data.latitude != null && data.longitude != null) {
        applyCoordinates({ latitude: data.latitude, longitude: data.longitude });
      } else if (!found) {
        props.onFlash("No pudimos leer la ubicación de ese enlace. Prueba con las coordenadas.");
      }
      if (fillPlaceDetails(data)) props.onFlash("Nombre y dirección tomados del enlace.");
    } catch {
      if (!found) props.onFlash("No pudimos leer la ubicación de ese enlace. Prueba con las coordenadas.");
    } finally {
      setResolvingLink(false);
    }
  }

  return (
    <>
      <p className="lead-text">Queda publicado de una vez: lo ven donantes y voluntarios apenas lo guardas.</p>
      <button type="button" className="big-choice" onClick={takePosition} disabled={props.locating}>
        <span><UiIcon name="location" size={24} /></span>
        <strong>Estoy en el centro ahora</strong>
        <small>Toma la ubicación de tu teléfono</small>
      </button>

      <section className="place-card">
        <label>
          <span>O pega el enlace de Google Maps <small>también sirven las coordenadas sueltas</small></span>
          <input
            value={link}
            inputMode="url"
            placeholder="https://maps.google.com/…  o  6.2412, -75.5628"
            onChange={(event) => void applyLink(event.target.value)}
          />
        </label>
      </section>
      <section className="place-card">
        <label>
          <span>Causa a la que apoya</span>
          <div className="chips" role="radiogroup" aria-label="Causa del centro">
            {CAUSES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={props.draft.cause === item.id}
                className={`chip${props.draft.cause === item.id ? " on" : ""}`}
                onClick={() => set((current) => ({ ...current, cause: item.id }))}
              >
                {item.short}
              </button>
            ))}
          </div>
        </label>
        <label>
          <span>Nombre del centro</span>
          <input
            value={props.draft.name}
            placeholder="Parroquia San José"
            onChange={(event) => set((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label>
          <span>Ciudad o municipio</span>
          <input
            list="ciudades-conocidas-centro"
            value={props.draft.city}
            autoComplete="address-level2"
            placeholder="Medellín"
            onChange={(event) => set((current) => ({ ...current, city: event.target.value }))}
          />
          <datalist id="ciudades-conocidas-centro">
            {props.cities.map((city) => <option key={city} value={city} />)}
          </datalist>
        </label>
        <label>
          <span>Dirección</span>
          <input
            value={props.draft.address}
            autoComplete="street-address"
            placeholder="Calle 45 #33-12"
            onChange={(event) => set((current) => ({ ...current, address: event.target.value }))}
          />
        </label>
        <label>
          <span>Teléfono <small>opcional</small></span>
          <input
            type="tel"
            autoComplete="tel"
            value={props.draft.contact}
            placeholder="300 123 4567"
            onChange={(event) => set((current) => ({ ...current, contact: event.target.value }))}
          />
        </label>
        <label>
          <span>Horario <small>opcional</small></span>
          <input
            value={props.draft.hours}
            placeholder="8 a. m. a 6 p. m."
            onChange={(event) => set((current) => ({ ...current, hours: event.target.value }))}
          />
        </label>
      </section>

      {resolvingLink && <p className="lead-text">Resolviendo enlace…</p>}
      {resolvingPosition && <p className="lead-text">Buscando datos del lugar…</p>}

      {located && (
        <section className="place-card located">
          <span className="pill ok">Ubicación lista</span>
          <strong>{Number(props.draft.latitude).toFixed(5)}, {Number(props.draft.longitude).toFixed(5)}</strong>
        </section>
      )}
    </>
  );
}

function ProductRow(props: {
  item: CatalogItem;
  level: Level;
  target: number;
  withTargets: boolean;
  onLevel: (level: Level) => void;
  onTarget: (value: number) => void;
}) {
  const { item, level, target } = props;
  return (
    <article className={`product ${level}`}>
      <strong>{item.name}</strong>
      <div className="states" role="group" aria-label={`Estado de ${item.name}`}>
        <button type="button" aria-pressed={level === "urgent"} onClick={() => props.onLevel("urgent")}>Urgente</button>
        <button type="button" aria-pressed={level === "normal"} onClick={() => props.onLevel("normal")}>Se necesita</button>
        <button type="button" aria-pressed={level === "blocked"} onClick={() => props.onLevel("blocked")}>Ya hay</button>
      </div>
      {props.withTargets && level !== "blocked" && (
        <div className="stepper small">
          <span>Meta</span>
          <button type="button" aria-label={`Reducir meta de ${item.name}`} onClick={() => props.onTarget(Math.max(1, target - item.step))}>
            <UiIcon name="minus" size={18} />
          </button>
          <strong aria-live="polite">{target}</strong>
          <button type="button" aria-label={`Aumentar meta de ${item.name}`} onClick={() => props.onTarget(Math.min(100000, target + item.step))}>
            <UiIcon name="plus" size={18} />
          </button>
          <small>{item.unit}</small>
        </div>
      )}
    </article>
  );
}

function ProductsScreen(props: {
  withTargets: boolean;
  levels: Record<string, Level>;
  targets: Record<string, number>;
  urgentCount: number;
  blockedCount: number;
  customItems: CatalogItem[];
  onLevel: (name: string, level: Level) => void;
  onTarget: (name: string, value: number) => void;
  onAddCustom: (name: string, unit: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [customName, setCustomName] = useState("");
  const [customUnit, setCustomUnit] = useState("");
  const key = norm(query);

  // Sin búsqueda no se muestra nada del catálogo: son ~30 productos y la mayoría
  // de las visitas vienen a marcar uno o dos. Buscar evita ese listado base y,
  // si no hay coincidencia, es la señal de que hace falta agregarlo a mano.
  const groups = useMemo(
    () =>
      key
        ? CATALOG.map((section) => ({
            ...section,
            items: section.items.filter((item) => norm(item.name).includes(key)),
          })).filter((section) => section.items.length > 0)
        : [],
    [key],
  );
  const noMatches = key.length > 0 && groups.length === 0;
  const suggestedName = customName || query.trim();

  function addCustom() {
    const name = suggestedName.trim();
    if (!name) return;
    props.onAddCustom(name, customUnit);
    setCustomName("");
    setCustomUnit("");
    setQuery("");
  }

  return (
    <>
      <div className="counters">
        <span className="pill urgent">{props.urgentCount} urgentes</span>
        <span className="pill ok">{props.blockedCount} suficientes</span>
      </div>
      <SearchBox value={query} onValue={setQuery} label="Buscar un producto" icon="package" />
      <p className="lead-text">“Ya hay” evita que otros lleven algo que ya está cubierto.</p>

      {groups.map((section) => (
        <section className="group" key={section.group}>
          <h2>{section.group}</h2>
          {section.items.map((item) => (
            <ProductRow
              key={item.name}
              item={item}
              level={props.levels[item.name] ?? "normal"}
              target={props.targets[item.name] ?? item.start}
              withTargets={props.withTargets}
              onLevel={(level) => props.onLevel(item.name, level)}
              onTarget={(value) => props.onTarget(item.name, value)}
            />
          ))}
        </section>
      ))}

      {noMatches && (
        <section className="place-card">
          <p className="empty">Ningún producto coincide con “{query}”.</p>
          <label>
            <span>Agregarlo como producto nuevo</span>
            <input
              value={suggestedName}
              placeholder="Nombre del producto"
              onChange={(event) => setCustomName(event.target.value)}
            />
          </label>
          <label>
            <span>Unidad <small>opcional</small></span>
            <input
              value={customUnit}
              placeholder="unidades, kilos, cajas…"
              onChange={(event) => setCustomUnit(event.target.value)}
            />
          </label>
          <button type="button" className="ghost-row" onClick={addCustom} disabled={!suggestedName.trim()}>
            <UiIcon name="plus" size={18} />
            Agregar producto
          </button>
        </section>
      )}

      {props.customItems.length > 0 && (
        <section className="group">
          <h2>Otros productos</h2>
          {props.customItems.map((item) => (
            <ProductRow
              key={item.name}
              item={item}
              level={props.levels[item.name] ?? "urgent"}
              target={props.targets[item.name] ?? item.start}
              withTargets={props.withTargets}
              onLevel={(level) => props.onLevel(item.name, level)}
              onTarget={(value) => props.onTarget(item.name, value)}
            />
          ))}
        </section>
      )}
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
    <>
      <p className="lead-text">Elige una sola tarea para que sepan exactamente a qué van.</p>
      <div className="stack">
        {HAND_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`pick-card${props.kind === option.id ? " on" : ""}`}
            aria-pressed={props.kind === option.id}
            onClick={() => props.onKind(option.id)}
          >
            <span className="radio" aria-hidden="true">{props.kind === option.id && <UiIcon name="check" size={14} />}</span>
            <span className="copy">
              <strong>{option.id}</strong>
              <small>{option.detail}</small>
            </span>
          </button>
        ))}
      </div>
      <section className="stepper-card">
        <span>¿Cuántas personas necesitas?</span>
        <div className="stepper">
          <button type="button" aria-label="Restar una persona" onClick={() => props.onQuantity(Math.max(1, props.quantity - 1))}>
            <UiIcon name="minus" size={20} />
          </button>
          <strong aria-live="polite">{props.quantity}</strong>
          <button type="button" aria-label="Sumar una persona" onClick={() => props.onQuantity(Math.min(60, props.quantity + 1))}>
            <UiIcon name="plus" size={20} />
          </button>
        </div>
      </section>
    </>
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
    <>
      <p className="lead-text">Dejamos de enviar gente aquí y sugerimos los puntos con menos cobertura.</p>
      <div className="stack">
        {SATURATION_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`pick-card${props.reason === option.id ? " on" : ""}`}
            aria-pressed={props.reason === option.id}
            onClick={() => props.onReason(option.id)}
          >
            <span className="radio" aria-hidden="true">{props.reason === option.id && <UiIcon name="check" size={14} />}</span>
            <span className="copy">
              <strong>{option.id}</strong>
              <small>{option.detail}</small>
            </span>
          </button>
        ))}
      </div>

      {props.alternatives.length > 0 && (
        <section className="feed">
          <h2>Redirigir gente hacia</h2>
          {props.alternatives.map((center) => {
            const missing = props.needs.filter(
              (need) => need.centerId === center.id && need.status === "urgent",
            ).length;
            return (
              <article key={center.id}>
                <strong>{center.name}</strong>
                <p>
                  {missing > 0 ? `${missing} productos urgentes` : "Recibiendo ayuda"}
                  {props.position ? ` · ${formatDistance(distanceKm(props.position, center))}` : ""}
                </p>
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}

function PeopleScreen() {
  return (
    <section className="people">
      <span className="mark alert" aria-hidden="true"><UiIcon name="alert" size={26} /></span>
      <h2>Esto no se publica aquí</h2>
      <p>
        Los datos de personas heridas, atrapadas o desaparecidas no son públicos y no se registran
        en esta aplicación. Llama directamente a los organismos oficiales: son los únicos que pueden
        contactar a las familias.
      </p>
      <a className="call" href="tel:123">Llamar al 123</a>
      <p className="fineprint">
        Defensa Civil, Cruz Roja y Bomberos responden por esa línea. Esta plataforma no reemplaza la
        atención de emergencias.
      </p>
    </section>
  );
}

function LogisticsScreen(props: {
  centers: Center[];
  needs: Need[];
  requests: VolunteerRequest[];
  position: Position | null;
  onLocate: () => void;
  busy: boolean;
  loading: boolean;
  view: "lista" | "mapa";
  onView: (value: "lista" | "mapa") => void;
  onAccept: (item: VolunteerRequest) => void;
}) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");

  const cities = useMemo(
    () => Array.from(new Set(props.centers.map((center) => center.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es")),
    [props.centers],
  );

  // Filtrar aquí y no dentro del mapa: el mapa recibe la misma lista ya recortada
  // y así los dos modos enseñan exactamente lo mismo.
  const shown = useMemo(() => {
    const key = norm(query);
    return props.centers.filter(
      (center) =>
        (!city || center.city === city) &&
        (!key || norm(`${center.name} ${center.city} ${center.address}`).includes(key)),
    );
  }, [props.centers, query, city]);

  if (props.loading) return <p className="empty">Sincronizando…</p>;
  if (props.centers.length === 0) return <p className="empty">Todavía no hay centros publicados.</p>;
  return (
    <>
      <ViewSwitch view={props.view} onView={props.onView} />
      <SearchBox value={query} onValue={setQuery} label="Buscar punto o ciudad" icon="building" />
      <CityChips cities={cities} value={city} onValue={setCity} />
      {shown.length === 0 && <p className="empty">Ningún punto coincide con lo que buscas.</p>}
      {props.view === "mapa" ? (
        <>
          <p className="lead-text">
            Toca un punto para ver qué le falta y abrir la ruta. El punto azul eres tú.
          </p>
          <CentersMap
            centers={shown}
            needs={props.needs}
            requests={props.requests}
            position={props.position}
          />
        </>
      ) : (
        <>
      <div className="lead-row">
        <p className="lead-text">
          {props.position
            ? "Ordenado desde tu ubicación actual."
            : "Ordenado por necesidad real. Actívala para ordenarlo por cercanía."}
        </p>
        {props.position && (
          <button type="button" className="link-row" onClick={props.onLocate}>Cambiar</button>
        )}
      </div>
      <div className="stack">
        {shown.map((center) => {
          const open = props.requests.filter(
            (item) => item.centerId === center.id && item.status === "open" && item.accepted < item.quantity,
          );
          const saturated = center.status === "saturated";
          const full = Boolean(center.volunteersSaturated);
          const goToCenter = (item: VolunteerRequest) => {
            window.open(routeUrl(center), "_blank", "noreferrer");
            props.onAccept(item);
          };
          return (
            <article className={`center-card${saturated ? " sat" : ""}`} key={center.id}>
              <div className="center-top">
                <strong>{center.name}</strong>
                {props.position && <span className="dist">{formatDistance(distanceKm(props.position, center))}</span>}
              </div>
              <small>{center.address} · {center.city}</small>
              {saturated ? (
                <p className="note warn">Saturado. No te dirijas aquí.</p>
              ) : full ? (
                <p className="note">Ya tienen suficientes voluntarios.</p>
              ) : open.length === 0 ? (
                <p className="note">Sin solicitudes abiertas ahora mismo, pero acercate para validar.</p>
              ) : (
                open.map((item) => (
                  <div className="request" key={item.id}>
                    <div>
                      <strong>{item.kind}</strong>
                      <small>Faltan {item.quantity - item.accepted} personas</small>
                    </div>
                    <button type="button" disabled={props.busy} onClick={() => goToCenter(item)}>Ruta</button>
                  </div>
                ))
              )}
              {(saturated || full) && (
                <button type="button" className="route-cta" disabled>Sin cupo</button>
              )}
            </article>
          );
        })}
      </div>
        </>
      )}
    </>
  );
}

/** Lista o mapa. La lista manda por defecto: pesa nada y funciona con mala señal. */
function ViewSwitch({
  view,
  onView,
}: { view: "lista" | "mapa"; onView: (value: "lista" | "mapa") => void }) {
  return (
    <div className="view-switch" role="group" aria-label="Forma de ver los puntos">
      <button type="button" aria-pressed={view === "lista"} onClick={() => onView("lista")}>
        <UiIcon name="reports" size={17} />
        Lista
      </button>
      <button type="button" aria-pressed={view === "mapa"} onClick={() => onView("mapa")}>
        <UiIcon name="location" size={17} />
        Mapa
      </button>
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
  radiusKm: number | null;
  onClearRadius: () => void;
  onExpandRadius: () => void;
  loading: boolean;
  pledge: Commitment | null;
  onInitiatives: () => void;
  onPick: (need: Need) => void;
}) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [onlyUrgent, setOnlyUrgent] = useState(false);

  const byId = useMemo(() => new Map(props.centers.map((center) => [center.id, center])), [props.centers]);

  // El radio solo puede acotar si hay ubicación: sin ella no hay nada que medir.
  const radiusKm = props.position ? props.radiusKm : null;

  const inRadius = useMemo(() => {
    if (radiusKm === null || !props.position) return props.needs;
    const position = props.position;
    return props.needs.filter((need) => {
      const center = byId.get(need.centerId);
      return !!center && distanceKm(position, center) <= radiusKm;
    });
  }, [props.needs, byId, radiusKm, props.position]);

  // Si no hay urgentes dentro del radio, se le muestra al donante el más cercano
  // fuera de él en vez de dejarlo con una lista vacía sin explicación.
  const urgentOutsideRadius = useMemo(() => {
    if (radiusKm === null || !props.position) return [];
    const position = props.position;
    return props.needs
      .map((need) => {
        const center = byId.get(need.centerId);
        return center ? { need, distance: distanceKm(position, center) } : null;
      })
      .filter((row): row is { need: Need; distance: number } => row !== null)
      .filter((row) => row.need.status === "urgent" && row.distance > radiusKm)
      .sort((a, b) => a.distance - b.distance);
  }, [props.needs, byId, radiusKm, props.position]);

  const urgentInRadius = inRadius.some((need) => need.status === "urgent");
  const showRadiusEmptyState = radiusKm !== null && !urgentInRadius && urgentOutsideRadius.length > 0;

  const cities = useMemo(() => {
    const names = inRadius.map((need) => byId.get(need.centerId)?.city).filter(Boolean) as string[];
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, "es"));
  }, [inRadius, byId]);

  const shown = useMemo(() => {
    const key = norm(query);
    const list = inRadius.filter((need) => {
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
  }, [inRadius, byId, query, city, onlyUrgent, props.position]);

  const initiatives = (
    <ActionRow
      icon="reports"
      title="Iniciativas corporativas para donar"
      text="Kits en tienda, cuentas y cajeros de empresas"
      onClick={props.onInitiatives}
    />
  );

  if (props.loading) return <p className="empty">Sincronizando…</p>;
  if (props.needs.length === 0) {
    return (
      <>
        {props.pledge && <PledgeReminder pledge={props.pledge} />}
        <p className="empty">
          Todavía no hay necesidades publicadas. Si atiendes un centro de acopio, publícalas
          desde el rol correspondiente.
        </p>
        <div className="stack">{initiatives}</div>
      </>
    );
  }
  return (
    <>
      {props.pledge && <PledgeReminder pledge={props.pledge} />}
      <div className="stack">{initiatives}</div>
      <SearchBox value={query} onValue={setQuery} label="Buscar qué llevar o a qué centro" icon="package" />
      <div className="chips scroll">
        <button
          type="button"
          className={`chip${onlyUrgent ? " on" : ""}`}
          aria-pressed={onlyUrgent}
          onClick={() => setOnlyUrgent((current) => !current)}
        >
          <UiIcon name="alert" size={14} />
          Solo urgentes
        </button>
        {radiusKm !== null && (
          <button type="button" className="chip on" onClick={props.onClearRadius}>
            <UiIcon name="location" size={14} />
            Centros a menos de {radiusKm} km de ti · Quitar
          </button>
        )}
      </div>
      {showRadiusEmptyState && (
        <div className="note radius-empty">
          <span>
            No hay urgentes en tu zona · hay {urgentOutsideRadius.length}{" "}
            {urgentOutsideRadius.length === 1 ? "producto urgente" : "productos urgentes"} a{" "}
            {formatDistance(urgentOutsideRadius[0].distance)}
          </span>
          <button type="button" onClick={props.onExpandRadius}>Ampliar radio</button>
        </div>
      )}
      <CityChips cities={cities} value={city} onValue={setCity} />
      <p className="lead-text">Lo que ves lo pidieron los centros. Lo que ya está cubierto no aparece.</p>
      {shown.length === 0 && <p className="empty">Nada coincide con lo que buscas. Prueba quitando algún filtro.</p>}
      <div className="stack">
        {shown.map((need) => {
          const center = byId.get(need.centerId);
          if (!center) return null;
          const promised = need.covered + need.committed;
          const percent = Math.min(100, Math.round((promised / Math.max(1, need.target)) * 100));
          return (
            <button type="button" className="need-card" key={need.id} onClick={() => props.onPick(need)}>
              <div className="need-top">
                <strong>{need.name}</strong>
                <span className={`pill ${need.status === "urgent" ? "urgent" : "soft"}`}>
                  {need.status === "urgent" ? "Urgente" : "Se necesita"}
                </span>
              </div>
              <small>{center.name}</small>
              <div
                className="progress"
                role="progressbar"
                aria-label={`Avance de ${need.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <i style={{ width: `${percent}%` }} />
              </div>
              <div className="progress-copy">
                <span>{promised} de {need.target} {need.unit}</span>
                {props.position && <span>{formatDistance(distanceKm(props.position, center))}</span>}
              </div>
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
  return (
    <>
      <section className="detail-card">
        <h2>{props.need.name}</h2>
        {props.need.detail && <p>{props.need.detail}</p>}
        {props.center && (
          <>
            <span className="eyebrow">Entregar en</span>
            <strong>{props.center.name}</strong>
            <small>{props.center.address} · {props.center.city}</small>
            {props.center.hours && <small>Horario: {props.center.hours}</small>}
          </>
        )}
      </section>
      <section className="stepper-card">
        <span>¿Cuánto puedes llevar?</span>
        <div className="stepper">
          <button type="button" aria-label="Reducir cantidad" onClick={() => props.onQuantity(Math.max(1, props.quantity - 1))}>
            <UiIcon name="minus" size={20} />
          </button>
          <strong aria-live="polite">{props.quantity}</strong>
          <button type="button" aria-label="Aumentar cantidad" onClick={() => props.onQuantity(Math.min(Math.max(1, remaining), props.quantity + 1))}>
            <UiIcon name="plus" size={20} />
          </button>
        </div>
        <small>{props.need.unit} · faltan {remaining}</small>
      </section>
      <p className="note">
        Tu compromiso reserva el cupo por 6 horas. Si no llegas, se libera automáticamente para otro donante.
      </p>
      {props.center && (
        <a className="route" href={routeUrl(props.center)} target="_blank" rel="noreferrer">
          Ver ruta <UiIcon name="external" size={15} />
        </a>
      )}
    </>
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
}: { kind: DoneKind; body: string; note: string; route: RouteHint | null }) {
  return (
    <section className="done">
      <span className="mark ok" aria-hidden="true"><UiIcon name="check" size={30} /></span>
      <h2>{DONE_TITLES[kind]}</h2>
      <p>{body}</p>
      {note && <p className="fineprint">{note}</p>}
      {route && (
        <section className="detail-card">
          <span className="eyebrow">Dónde</span>
          <strong>{route.name}</strong>
          <small>{route.address}</small>
          <a className="route" href={route.url} target="_blank" rel="noreferrer">
            Abrir ruta <UiIcon name="external" size={15} />
          </a>
        </section>
      )}
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
