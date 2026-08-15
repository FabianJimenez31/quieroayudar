"use client";

/**
 * Panel de coordinación.
 *
 * Antes era un escritorio: barra lateral, cinco pestañas y formularios de ocho
 * campos. Quien coordina un acopio lo hace de pie, con una mano, en un celular
 * y con gente esperando. Así que usa el mismo lenguaje que la app pública:
 * una pregunta por pantalla, un botón grande abajo, y todo lo que se toca
 * responde de inmediato aunque la red vaya lenta.
 *
 * Nada del contrato con la API cambió: los mismos endpoints y las mismas
 * acciones de siempre.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import UiIcon, { type IconName } from "../UiIcon";
import { CATALOG, CATALOG_ITEMS, unitFor } from "../catalog";
import { distanceKm, formatDistance } from "../geo";
import { parseCoordinates } from "./centersImport";
import BulkCenters from "./BulkCenters";

/* ─────────────────────────── Tipos ─────────────────────────── */

type Center = {
  id: string;
  name: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  contact: string;
  hours: string;
  status: "active" | "saturated" | "closed";
  createdAt?: string;
};
type Need = {
  id: string;
  centerId: string;
  name: string;
  detail: string;
  priority: "critical" | "high" | "medium";
  target: number;
  covered: number;
  committed: number;
  unit: string;
  status: "urgent" | "normal" | "blocked";
  createdAt?: string;
};
type VolunteerRequest = {
  id: string;
  centerId: string;
  kind: string;
  detail: string;
  quantity: number;
  accepted: number;
  status: "open" | "filled" | "closed";
  createdAt?: string;
};
type Report = {
  id: string;
  category: "products" | "hands" | "saturation";
  city: string;
  location: string;
  details: string;
  status: "pending" | "verified" | "rejected";
  createdAt?: string;
};
type Data = { centers: Center[]; needs: Need[]; volunteerRequests: VolunteerRequest[]; reports: Report[] };
type Position = { latitude: number; longitude: number };
type CenterDraft = { name: string; city: string; address: string; contact: string; hours: string; latitude: string; longitude: string };

const BLANK_CENTER: CenterDraft = { name: "", city: "", address: "", contact: "", hours: "", latitude: "", longitude: "" };

type Screen =
  | "inicio"
  | "centro-lugar"
  | "centro-datos"
  | "pedir-centro"
  | "pedir-que"
  | "pedir-cuanto"
  | "manos-centro"
  | "manos-tarea"
  | "elegir-centro"
  | "centros"
  | "pedidos"
  | "reportes"
  | "masiva";

const EMPTY: Data = { centers: [], needs: [], volunteerRequests: [], reports: [] };

const TASKS: { kind: string; icon: IconName; detail: string }[] = [
  { kind: "Clasificación y carga", icon: "package", detail: "Organizar, empacar y cargar donaciones" },
  { kind: "Cocina y reparto", icon: "users", detail: "Preparar y entregar alimentos" },
  { kind: "Conductores con vehículo", icon: "location", detail: "Traslado de personas o suministros" },
  { kind: "Remoción de escombros", icon: "alert", detail: "Trabajo pesado en terreno" },
  { kind: "Asistencia médica", icon: "check", detail: "Personal de salud con credencial" },
  { kind: "Apoyo veterinario", icon: "home", detail: "Animales heridos o extraviados" },
];

/** Pantallas que son un paso de un flujo: llevan flecha de volver y sin pestañas. */
const FLOW: Screen[] = [
  "centro-lugar",
  "centro-datos",
  "pedir-centro",
  "pedir-que",
  "pedir-cuanto",
  "manos-centro",
  "manos-tarea",
  "elegir-centro",
  "masiva",
];

const TITLES: Record<Screen, [string, string]> = {
  inicio: ["Coordinación", "Publica lo que hace falta"],
  "centro-lugar": ["Nuevo centro · 1 de 2", "¿Dónde queda?"],
  "centro-datos": ["Nuevo centro · 2 de 2", "¿Cómo se llama?"],
  "pedir-centro": ["Pedir productos · 1 de 3", "¿En qué centro?"],
  "pedir-que": ["Pedir productos · 2 de 3", "¿Qué hace falta?"],
  "pedir-cuanto": ["Pedir productos · 3 de 3", "¿Cuánto de cada uno?"],
  "manos-centro": ["Pedir manos · 1 de 2", "¿En qué centro?"],
  "manos-tarea": ["Pedir manos · 2 de 2", "¿Para qué tarea?"],
  "elegir-centro": ["Mi centro", "El que coordinas a diario"],
  centros: ["Centros", "Estado de cada punto"],
  pedidos: ["Pedidos", "Lo que se está pidiendo"],
  reportes: ["Reportes", "Lo que llega desde terreno"],
  masiva: ["Carga masiva", "Varios centros por Excel"],
};

/* ────────────────────────── Utilidades ────────────────────────── */

const norm = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function startFor(name: string) {
  return CATALOG_ITEMS.find((item) => item.name === name)?.start ?? 20;
}

function stepFor(name: string) {
  return CATALOG_ITEMS.find((item) => item.name === name)?.step ?? 10;
}

function sortCenters(centers: Center[], position: Position | null) {
  return [...centers].sort((a, b) => {
    if (position) return distanceKm(position, a) - distanceKm(position, b);
    return a.name.localeCompare(b.name, "es");
  });
}

function whenOf(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  if (minutes < 1440) return `hace ${Math.round(minutes / 60)} h`;
  return `hace ${Math.round(minutes / 1440)} d`;
}

/* ─────────────────────────── App ─────────────────────────── */

export default function CoordinatorApp() {
  const [data, setData] = useState<Data>(EMPTY);
  const [trail, setTrail] = useState<Screen[]>(["inicio"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [position, setPosition] = useState<Position | null>(null);
  const [myCenterId, setMyCenterId] = useState("");

  // Borradores de los flujos. Viven aquí para que volver un paso no los borre.
  const [centerDraft, setCenterDraft] = useState<CenterDraft>(BLANK_CENTER);
  const [needTarget, setNeedTarget] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [urgent, setUrgent] = useState(true);
  const [handsTarget, setHandsTarget] = useState("");
  const [handKind, setHandKind] = useState(TASKS[0].kind);
  const [handQuantity, setHandQuantity] = useState(6);
  const [handDetail, setHandDetail] = useState("");

  const screen = trail[trail.length - 1];
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(0);

  const flash = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3600);
  }, []);

  const go = useCallback((next: Screen) => {
    setError("");
    setTrail((current) => {
      // Las secciones de listado reemplazan la pila; los pasos de un flujo se apilan.
      if (!FLOW.includes(next)) return next === "inicio" ? ["inicio"] : ["inicio", next];
      // Volver a un paso ya visitado no lo duplica: recorta hasta él, para que
      // la flecha de atrás siga contando la historia real y no un bucle.
      const seen = current.indexOf(next);
      return seen >= 0 ? current.slice(0, seen + 1) : [...current, next];
    });
    window.scrollTo({ top: 0 });
  }, []);

  const back = useCallback(() => {
    setError("");
    setTrail((current) => (current.length > 1 ? current.slice(0, -1) : current));
    window.scrollTo({ top: 0 });
  }, []);

  const sync = useCallback(async (): Promise<void> => {
    const code = window.sessionStorage.getItem("ra.coordinator") ?? "";
    const response = await fetch("/api/coordination", {
      cache: "no-store",
      headers: code ? { "x-coordinator-code": code } : undefined,
    });
    const body = (await response.json()) as Data & { error?: string };
    if (!response.ok) throw new Error(body.error || "No pudimos cargar la red.");
    setData({
      centers: body.centers ?? [],
      needs: body.needs ?? [],
      volunteerRequests: body.volunteerRequests ?? [],
      reports: body.reports ?? [],
    });
    setError("");
  }, []);

  const refresh = useCallback(async () => {
    try { await sync(); } catch (caught) { setError(caught instanceof Error ? caught.message : "No pudimos cargar la red."); }
  }, [sync]);

  // Carga inicial. La regla marca el setState del catch aunque ocurra después.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  // Se actualiza sola mientras la pestaña esté a la vista: quien coordina deja
  // el panel abierto y necesita ver llegar los reportes sin tocar nada.
  useEffect(() => {
    // Nunca mientras hay un cambio viajando: la respuesta del refresco es
    // anterior al cambio y borraría en pantalla lo que se acaba de tocar.
    const tick = () => { if (document.visibilityState === "visible" && inFlight.current === 0) void refresh(); };
    const timer = setInterval(tick, 45_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [refresh]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMyCenterId(window.localStorage.getItem("ra.coordinator.center") ?? ""); }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function locate() {
    navigator.geolocation?.getCurrentPosition(
      (result) => setPosition({ latitude: result.coords.latitude, longitude: result.coords.longitude }),
      () => flash("No pudimos leer tu ubicación. Puedes seguir sin ella."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function rememberCenter(id: string) {
    setMyCenterId(id);
    window.localStorage.setItem("ra.coordinator.center", id);
  }

  /**
   * Publicar es anónimo. Solo cerrar un centro o retirar un reporte piden clave,
   * y se pide justo cuando hace falta, no al entrar.
   */
  const send = useCallback(async (url: string, method: "POST" | "PATCH", payload: Record<string, unknown>) => {
    const attempt = async (code: string) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (code) headers["x-coordinator-code"] = code;
      const response = await fetch(url, { method, headers, body: JSON.stringify(payload) });
      return { response, body: (await response.json().catch(() => ({}))) as { error?: string } };
    };

    inFlight.current += 1;
    try {
      let result = await attempt(window.sessionStorage.getItem("ra.coordinator") ?? "");
      if (result.response.status === 401) {
        const typed = window.prompt("Esta acción retira información de la red. Clave de coordinación:") ?? "";
        if (!typed.trim()) throw new Error("Acción cancelada.");
        window.sessionStorage.setItem("ra.coordinator", typed.trim());
        result = await attempt(typed.trim());
        if (result.response.status === 401) window.sessionStorage.removeItem("ra.coordinator");
      }
      if (!result.response.ok) throw new Error(result.body.error || "No pudimos guardar el cambio.");
    } finally {
      inFlight.current -= 1;
    }
  }, []);

  /** Mutación con respuesta inmediata: se pinta el cambio y se revierte si falla. */
  const optimistic = useCallback(
    async (apply: (current: Data) => Data, url: string, method: "POST" | "PATCH", payload: Record<string, unknown>, success: string) => {
      const previous = data;
      setData(apply);
      setError("");
      try {
        await send(url, method, payload);
        flash(success);
        void sync().catch(() => undefined);
      } catch (caught) {
        setData(previous);
        setError(caught instanceof Error ? caught.message : "No pudimos guardar el cambio.");
      }
    },
    [data, flash, send, sync],
  );

  /** Alta o publicación: bloquea el botón, y al terminar vuelve al inicio. */
  const publish = useCallback(
    async (url: string, method: "POST" | "PATCH", payload: Record<string, unknown>, success: string, after: () => void) => {
      setBusy(true);
      setError("");
      try {
        await send(url, method, payload);
        await sync();
        flash(success);
        after();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "No pudimos guardar el cambio.");
      } finally {
        setBusy(false);
      }
    },
    [flash, send, sync],
  );

  /* ───────── Datos derivados ───────── */

  const centers = useMemo(() => sortCenters(data.centers, position), [data.centers, position]);
  const openCenters = useMemo(() => centers.filter((center) => center.status !== "closed"), [centers]);
  const myCenter = data.centers.find((center) => center.id === myCenterId) ?? null;
  const pendingReports = data.reports.filter((report) => report.status === "pending").length;
  const liveNeeds = data.needs.filter((need) => need.status !== "blocked");
  const urgentNeeds = liveNeeds.filter((need) => need.status === "urgent").length;
  const openHands = data.volunteerRequests.filter((item) => item.status === "open");

  /* ───────── Acciones de los flujos ───────── */

  function startCenter() {
    setCenterDraft(BLANK_CENTER);
    go("centro-lugar");
  }

  function startNeeds() {
    setPicked([]);
    setAmounts({});
    setUrgent(true);
    setNeedTarget(myCenterId && myCenter ? myCenterId : "");
    go(myCenterId && myCenter ? "pedir-que" : "pedir-centro");
  }

  function startHands() {
    setHandKind(TASKS[0].kind);
    setHandQuantity(6);
    setHandDetail("");
    setHandsTarget(myCenterId && myCenter ? myCenterId : "");
    go(myCenterId && myCenter ? "manos-tarea" : "manos-centro");
  }

  async function submitCenter() {
    await publish(
      "/api/centers",
      "POST",
      {
        name: centerDraft.name.trim(),
        city: centerDraft.city.trim(),
        address: centerDraft.address.trim(),
        contact: centerDraft.contact.trim(),
        hours: centerDraft.hours.trim(),
        latitude: Number(centerDraft.latitude),
        longitude: Number(centerDraft.longitude),
      },
      "Centro publicado. Ya aparece en el mapa.",
      () => setTrail(["inicio"]),
    );
  }

  async function submitNeeds() {
    const products = picked.map((name) => ({
      name,
      detail: "",
      unit: unitFor(name),
      status: urgent ? "urgent" : "normal",
      target: amounts[name] ?? 1,
    }));
    await publish(
      "/api/coordination",
      "POST",
      { action: "needs-batch", centerId: needTarget, products },
      `${products.length} ${products.length === 1 ? "producto publicado" : "productos publicados"}. Ya los ven los donantes.`,
      () => setTrail(["inicio"]),
    );
  }

  async function submitHands() {
    await publish(
      "/api/coordination",
      "POST",
      { action: "volunteer-request", centerId: handsTarget, kind: handKind, detail: handDetail.trim(), quantity: handQuantity },
      "Solicitud publicada. Ya la ven los voluntarios cercanos.",
      () => setTrail(["inicio"]),
    );
  }

  function setCenterStatus(center: Center, status: Center["status"]) {
    void optimistic(
      (current) => ({ ...current, centers: current.centers.map((item) => (item.id === center.id ? { ...item, status } : item)) }),
      "/api/centers",
      "PATCH",
      { id: center.id, status },
      status === "active" ? "Recibiendo ayuda." : status === "saturated" ? "Marcado como saturado." : "Centro cerrado.",
    );
  }

  function setNeedStatus(need: Need, status: Need["status"]) {
    void optimistic(
      (current) => ({ ...current, needs: current.needs.map((item) => (item.id === need.id ? { ...item, status } : item)) }),
      "/api/coordination",
      "PATCH",
      { action: "need", id: need.id, target: need.target, covered: need.covered, status },
      status === "blocked" ? "Ya no se pide." : "Vuelve a pedirse.",
    );
  }

  function receive(need: Need, quantity: number) {
    void optimistic(
      (current) => ({
        ...current,
        needs: current.needs.map((item) =>
          item.id === need.id
            ? { ...item, covered: Math.min(item.target, item.covered + quantity), committed: Math.max(0, item.committed - quantity) }
            : item,
        ),
      }),
      "/api/coordination",
      "POST",
      { action: "needs-received", centerId: need.centerId, received: [{ name: need.name, quantity }] },
      `Llegaron ${quantity} ${need.unit}.`,
    );
  }

  function setHandsStatus(item: VolunteerRequest, status: VolunteerRequest["status"]) {
    void optimistic(
      (current) => ({
        ...current,
        volunteerRequests: current.volunteerRequests.map((row) => (row.id === item.id ? { ...row, status } : row)),
      }),
      "/api/coordination",
      "PATCH",
      { action: "volunteer-request", id: item.id, status },
      status === "open" ? "Solicitud abierta." : status === "filled" ? "Solicitud cubierta." : "Solicitud cerrada.",
    );
  }

  function setReportStatus(report: Report, status: Report["status"]) {
    void optimistic(
      (current) => ({ ...current, reports: current.reports.map((item) => (item.id === report.id ? { ...item, status } : item)) }),
      "/api/coordination",
      "PATCH",
      { action: "report", id: report.id, status },
      status === "verified" ? "Reporte publicado." : "Reporte retirado.",
    );
  }

  /* ───────── Botón grande de cada paso ───────── */

  const coordsReady = Number.isFinite(Number(centerDraft.latitude)) && Number.isFinite(Number(centerDraft.longitude)) && centerDraft.latitude !== "" && centerDraft.longitude !== "";
  const centerReady = Boolean(centerDraft.name.trim() && centerDraft.city.trim() && centerDraft.address.trim());

  // El botón grande es solo texto y estado durante el render; lo que hace se
  // resuelve al tocarlo. Así no se crean objetos con callbacks en cada pintado.
  let cta = "";
  let ctaOff = false;
  if (screen === "centro-lugar") { cta = "Continuar"; ctaOff = !coordsReady; }
  if (screen === "centro-datos") { cta = busy ? "Publicando…" : "Publicar centro"; ctaOff = busy || !centerReady; }
  if (screen === "pedir-que") { cta = picked.length ? `Continuar con ${picked.length}` : "Marca lo que hace falta"; ctaOff = picked.length === 0; }
  if (screen === "pedir-cuanto") { cta = busy ? "Publicando…" : `Publicar ${picked.length} ${picked.length === 1 ? "producto" : "productos"}`; ctaOff = busy || picked.length === 0; }
  if (screen === "manos-tarea") { cta = busy ? "Publicando…" : "Publicar solicitud"; ctaOff = busy; }

  function runCta() {
    if (screen === "centro-lugar") return go("centro-datos");
    if (screen === "centro-datos") return void submitCenter();
    if (screen === "pedir-que") return go("pedir-cuanto");
    if (screen === "pedir-cuanto") return void submitNeeds();
    if (screen === "manos-tarea") return void submitHands();
  }

  const inFlow = FLOW.includes(screen);
  const [title, subtitle] = TITLES[screen];

  return (
    <div className="phone coord-phone">
      <a className="skip-link" href="#panel">Saltar al contenido</a>

      <header className="screen-head">
        {inFlow ? (
          <button type="button" onClick={back} aria-label="Volver">
            <UiIcon name="arrow-left" size={22} />
          </button>
        ) : (
          <Link className="coord-home-link" href="/" aria-label="Ver la red pública">
            <span className="brand-mark" />
          </Link>
        )}
        <div>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </div>
        <button
          type="button"
          onClick={locate}
          aria-label={position ? "Ubicación activa" : "Usar mi ubicación"}
          className={position ? "on" : ""}
        >
          <UiIcon name="location" size={20} />
        </button>
      </header>

      <main className="screen" id="panel" tabIndex={-1} key={screen}>
        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void refresh()}>Reintentar</button>
          </div>
        )}

        {screen === "inicio" && (
          <HomeScreen
            centers={data.centers}
            needs={liveNeeds}
            urgent={urgentNeeds}
            hands={openHands.length}
            reports={data.reports}
            pending={pendingReports}
            myCenter={myCenter}
            onCenterStatus={setCenterStatus}
            onChooseCenter={() => go("elegir-centro")}
            onNeeds={startNeeds}
            onHands={startHands}
            onCenter={startCenter}
            onBulk={() => go("masiva")}
            onReports={() => go("reportes")}
          />
        )}

        {screen === "elegir-centro" && (
          <CenterPicker
            centers={openCenters}
            position={position}
            selected={myCenterId}
            empty="Aún no hay centros. Registra el primero desde el inicio."
            onPick={(center) => { rememberCenter(center.id); flash(`Tu centro ahora es ${center.name}.`); back(); }}
          />
        )}

        {screen === "centro-lugar" && (
          <PlaceStep draft={centerDraft} onDraft={setCenterDraft} onFlash={flash} />
        )}

        {screen === "centro-datos" && <CenterDataStep draft={centerDraft} onDraft={setCenterDraft} />}

        {screen === "pedir-centro" && (
          <CenterPicker
            centers={openCenters}
            position={position}
            selected={needTarget}
            empty="Registra primero un centro para poder pedir productos."
            onPick={(center) => { setNeedTarget(center.id); go("pedir-que"); }}
          />
        )}

        {screen === "pedir-que" && (
          <ProductStep
            picked={picked}
            onToggle={(name) => {
              setPicked((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]));
              setAmounts((current) => (current[name] ? current : { ...current, [name]: startFor(name) }));
            }}
            center={data.centers.find((center) => center.id === needTarget)}
            onChangeCenter={() => go("pedir-centro")}
          />
        )}

        {screen === "pedir-cuanto" && (
          <AmountStep
            picked={picked}
            amounts={amounts}
            urgent={urgent}
            onUrgent={setUrgent}
            onAmount={(name, value) => setAmounts((current) => ({ ...current, [name]: value }))}
            onDrop={(name) => setPicked((current) => current.filter((item) => item !== name))}
          />
        )}

        {screen === "manos-centro" && (
          <CenterPicker
            centers={openCenters}
            position={position}
            selected={handsTarget}
            empty="Registra primero un centro para poder pedir manos."
            onPick={(center) => { setHandsTarget(center.id); go("manos-tarea"); }}
          />
        )}

        {screen === "manos-tarea" && (
          <HandsStep
            kind={handKind}
            quantity={handQuantity}
            detail={handDetail}
            center={data.centers.find((center) => center.id === handsTarget)}
            onKind={setHandKind}
            onQuantity={setHandQuantity}
            onDetail={setHandDetail}
            onChangeCenter={() => go("manos-centro")}
          />
        )}

        {screen === "centros" && (
          <CentersScreen
            centers={centers}
            position={position}
            myCenterId={myCenterId}
            onStatus={setCenterStatus}
            onMine={rememberCenter}
            onNew={startCenter}
            onBulk={() => go("masiva")}
          />
        )}

        {screen === "pedidos" && (
          <RequestsScreen
            needs={data.needs}
            hands={data.volunteerRequests}
            centers={data.centers}
            onReceive={receive}
            onNeedStatus={setNeedStatus}
            onHandsStatus={setHandsStatus}
            onNewNeed={startNeeds}
            onNewHands={startHands}
          />
        )}

        {screen === "reportes" && <ReportsScreen reports={data.reports} onStatus={setReportStatus} />}

        {screen === "masiva" && <BulkCenters existing={data.centers} onPublished={refresh} />}
      </main>

      {cta && (
        <div className="cta-bar">
          <button type="button" onClick={runCta} disabled={ctaOff}>{cta}</button>
        </div>
      )}

      {!inFlow && (
        <nav className="tabs" aria-label="Secciones del panel">
          <TabButton label="Inicio" icon="home" on={screen === "inicio"} onClick={() => go("inicio")} />
          <TabButton label="Centros" icon="building" on={screen === "centros"} onClick={() => go("centros")} />
          <TabButton label="Pedidos" icon="package" on={screen === "pedidos"} onClick={() => go("pedidos")} />
          <TabButton label="Reportes" icon="reports" on={screen === "reportes"} badge={pendingReports} onClick={() => go("reportes")} />
        </nav>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function TabButton({ label, icon, on, badge, onClick }: { label: string; icon: IconName; on: boolean; badge?: number; onClick: () => void }) {
  return (
    <button type="button" className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={onClick}>
      <span className="tab-icon">
        <UiIcon name={icon} size={21} />
        {badge ? <i>{badge}</i> : null}
      </span>
      <small>{label}</small>
    </button>
  );
}

/* ─────────────────────────── Inicio ─────────────────────────── */

function HomeScreen(props: {
  centers: Center[];
  needs: Need[];
  urgent: number;
  hands: number;
  reports: Report[];
  pending: number;
  myCenter: Center | null;
  onCenterStatus: (center: Center, status: Center["status"]) => void;
  onChooseCenter: () => void;
  onNeeds: () => void;
  onHands: () => void;
  onCenter: () => void;
  onBulk: () => void;
  onReports: () => void;
}) {
  const active = props.centers.filter((center) => center.status === "active").length;
  const mine = props.myCenter;

  // Un solo hilo de novedades: lo último que pasó en la red, sin importar de qué tipo.
  const feed = useMemo(() => {
    const rows = [
      ...props.needs.map((need) => ({ at: need.createdAt, text: `${need.name} · ${need.target} ${need.unit}`, tag: "Producto", tone: "coral" })),
      ...props.reports.filter((report) => report.status !== "rejected").map((report) => ({ at: report.createdAt, text: `${report.city} · ${report.location}`, tag: "Reporte", tone: "gold" })),
    ];
    return rows
      .filter((row) => row.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 5);
  }, [props.needs, props.reports]);

  return (
    <>
      <section className="summary coord-summary">
        <div><strong>{active}</strong><small>centros activos</small></div>
        <div><strong>{props.urgent}</strong><small>productos urgentes</small></div>
        <div><strong>{props.hands}</strong><small>manos pedidas</small></div>
      </section>

      {mine ? (
        <section className="place-card my-center">
          <p className="eyebrow">Mi centro</p>
          <strong>{mine.name}</strong>
          <small>{mine.city} · {mine.address}</small>
          <div className="states">
            <button type="button" aria-pressed={mine.status === "active"} onClick={() => props.onCenterStatus(mine, "active")}>Recibiendo</button>
            <button type="button" aria-pressed={mine.status === "saturated"} onClick={() => props.onCenterStatus(mine, "saturated")}>Saturado</button>
            <button type="button" aria-pressed={mine.status === "closed"} onClick={() => props.onCenterStatus(mine, "closed")}>Cerrado</button>
          </div>
          <button type="button" className="link-row" onClick={props.onChooseCenter}>Cambiar de centro</button>
        </section>
      ) : (
        <button type="button" className="ghost-row" onClick={props.onChooseCenter}>
          <UiIcon name="building" size={18} />
          Elige tu centro y todo se llena solo
        </button>
      )}

      <div className="stack">
        <ActionRow icon="package" title="Pedir productos" text="Marca qué falta y cuánto" onClick={props.onNeeds} />
        <ActionRow icon="users" title="Pedir manos" text="Voluntarios para un turno" onClick={props.onHands} />
        <ActionRow icon="building" title="Registrar un centro" text="Dos pasos y queda en el mapa" onClick={props.onCenter} />
        {props.pending > 0 && (
          <ActionRow icon="reports" title={`${props.pending} reportes por revisar`} text="Llegaron desde terreno" tone="alert" onClick={props.onReports} />
        )}
      </div>

      <button type="button" className="ghost-row" onClick={props.onBulk}>
        <UiIcon name="download" size={18} />
        Subir varios centros desde un Excel
      </button>

      {feed.length > 0 && (
        <section className="feed">
          <h2>Lo último</h2>
          {feed.map((row, index) => (
            <article key={`${row.tag}-${index}`}>
              <span className={`pill ${row.tone === "coral" ? "urgent" : "soft"}`}>{row.tag}</span>
              <div>
                <strong>{row.text}</strong>
                <small>{whenOf(row.at)}</small>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function ActionRow({ icon, title, text, tone, onClick }: { icon: IconName; title: string; text: string; tone?: string; onClick: () => void }) {
  return (
    <button type="button" className={`row-card${tone ? ` ${tone}` : ""}`} onClick={onClick}>
      <span className="glyph"><UiIcon name={icon} size={21} /></span>
      <span className="copy">
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <UiIcon name="arrow-right" size={20} />
    </button>
  );
}

/* ─────────────────────── Elegir centro ─────────────────────── */

function CenterPicker(props: {
  centers: Center[];
  position: Position | null;
  selected: string;
  empty: string;
  onPick: (center: Center) => void;
}) {
  const [query, setQuery] = useState("");
  const found = useMemo(() => {
    const key = norm(query);
    if (!key) return props.centers;
    return props.centers.filter((center) => norm(`${center.name} ${center.city} ${center.address}`).includes(key));
  }, [props.centers, query]);

  if (props.centers.length === 0) return <p className="empty">{props.empty}</p>;

  return (
    <>
      <label className="search-box">
        <UiIcon name="location" size={18} />
        <input
          type="search"
          value={query}
          placeholder="Buscar por nombre o ciudad"
          aria-label="Buscar centro"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {found.length === 0 ? (
        <p className="empty">Ningún centro coincide con “{query}”.</p>
      ) : (
        <div className="stack">
          {found.map((center) => (
            <button
              key={center.id}
              type="button"
              className={`pick-card${props.selected === center.id ? " on" : ""}`}
              onClick={() => props.onPick(center)}
            >
              <span className="radio">{props.selected === center.id && <UiIcon name="check" size={14} />}</span>
              <span className="copy">
                <strong>{center.name}</strong>
                <small>
                  {center.city}
                  {props.position ? ` · a ${formatDistance(distanceKm(props.position, center))}` : ""}
                  {center.status === "saturated" ? " · saturado" : ""}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ─────────────────────── Alta de centro ─────────────────────── */

function PlaceStep(props: {
  draft: CenterDraft;
  onDraft: Dispatch<SetStateAction<CenterDraft>>;
  onFlash: (text: string) => void;
}) {
  const [link, setLink] = useState("");
  const ready = props.draft.latitude !== "" && props.draft.longitude !== "";

  function takePosition() {
    props.onFlash("Buscando tu ubicación…");
    navigator.geolocation?.getCurrentPosition(
      (result) => {
        props.onDraft((current) => ({
          ...current,
          latitude: result.coords.latitude.toFixed(6),
          longitude: result.coords.longitude.toFixed(6),
        }));
        props.onFlash("Ubicación tomada.");
      },
      () => props.onFlash("No pudimos leer tu ubicación. Pega el enlace del mapa."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  /** Pegar el enlace del mapa es lo que la gente ya tiene a mano en el chat. */
  function applyLink(value: string) {
    setLink(value);
    const found = parseCoordinates(value);
    if (found) {
      props.onDraft((current) => ({
        ...current,
        latitude: found.latitude.toFixed(6),
        longitude: found.longitude.toFixed(6),
      }));
      props.onFlash("Ubicación tomada del enlace.");
    }
  }

  return (
    <>
      <p className="lead-text">El punto en el mapa es lo único que no se puede adivinar. Todo lo demás viene después.</p>

      <button type="button" className="big-choice" onClick={takePosition}>
        <span><UiIcon name="location" size={24} /></span>
        <strong>Estoy en el centro ahora</strong>
        <small>Toma la ubicación de tu teléfono</small>
      </button>

      <section className="place-card">
        <label>
          <span>O pega el enlace de Google Maps <small>sirve también con las coordenadas sueltas</small></span>
          <input
            value={link}
            inputMode="url"
            placeholder="https://maps.google.com/…  o  6.2412, -75.5628"
            onChange={(event) => applyLink(event.target.value)}
          />
        </label>
      </section>

      {ready && (
        <section className="place-card located">
          <span className="pill ok">Ubicación lista</span>
          <strong>{Number(props.draft.latitude).toFixed(5)}, {Number(props.draft.longitude).toFixed(5)}</strong>
          <a
            href={`https://www.google.com/maps?q=${props.draft.latitude},${props.draft.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="link-row"
          >
            Ver en el mapa <UiIcon name="external" size={15} />
          </a>
        </section>
      )}
    </>
  );
}

function CenterDataStep(props: { draft: CenterDraft; onDraft: Dispatch<SetStateAction<CenterDraft>> }) {
  const set = props.onDraft;
  const [extra, setExtra] = useState(false);

  return (
    <>
      <section className="place-card">
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
            value={props.draft.city}
            autoComplete="address-level2"
            placeholder="Medellín"
            onChange={(event) => set((current) => ({ ...current, city: event.target.value }))}
          />
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
      </section>

      {/* Teléfono y horario ayudan, pero no valen retrasar la publicación. */}
      {extra ? (
        <section className="place-card">
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
      ) : (
        <button type="button" className="ghost-row" onClick={() => setExtra(true)}>
          <UiIcon name="plus" size={18} />
          Agregar teléfono y horario
        </button>
      )}
    </>
  );
}

/* ─────────────────────── Pedir productos ─────────────────────── */

function ProductStep(props: { picked: string[]; center?: Center; onToggle: (name: string) => void; onChangeCenter: () => void }) {
  const [query, setQuery] = useState("");
  const key = norm(query);

  const groups = useMemo(
    () =>
      CATALOG.map((group) => ({
        ...group,
        items: key ? group.items.filter((item) => norm(item.name).includes(key)) : group.items,
      })).filter((group) => group.items.length > 0),
    [key],
  );

  return (
    <>
      {props.center && (
        <button type="button" className="context-row" onClick={props.onChangeCenter}>
          <span><UiIcon name="building" size={17} /></span>
          <span className="copy"><strong>{props.center.name}</strong><small>{props.center.city}</small></span>
          <span className="link-row">Cambiar</span>
        </button>
      )}

      <label className="search-box">
        <UiIcon name="package" size={18} />
        <input
          type="search"
          value={query}
          placeholder="Buscar un producto"
          aria-label="Buscar producto"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {groups.length === 0 && <p className="empty">Nada coincide con “{query}”.</p>}

      {groups.map((group) => (
        <section className="group" key={group.group}>
          <h2>{group.group}</h2>
          <div className="chips">
            {group.items.map((item) => (
              <button
                key={item.name}
                type="button"
                className={`chip${props.picked.includes(item.name) ? " on" : ""}`}
                aria-pressed={props.picked.includes(item.name)}
                onClick={() => props.onToggle(item.name)}
              >
                {props.picked.includes(item.name) && <UiIcon name="check" size={14} />}
                {item.name}
              </button>
            ))}
          </div>
        </section>
      ))}

      <p className="medicine-note">
        <UiIcon name="alert" size={16} />
        Medicamentos: solo sellados, vigentes y solicitados por personal de salud.
      </p>
    </>
  );
}

function AmountStep(props: {
  picked: string[];
  amounts: Record<string, number>;
  urgent: boolean;
  onUrgent: (value: boolean) => void;
  onAmount: (name: string, value: number) => void;
  onDrop: (name: string) => void;
}) {
  return (
    <>
      <section className="status-choice big">
        <button type="button" aria-pressed={props.urgent} onClick={() => props.onUrgent(true)}>Urgente hoy</button>
        <button type="button" aria-pressed={!props.urgent} onClick={() => props.onUrgent(false)}>Se necesita pronto</button>
      </section>

      {props.picked.map((name) => {
        const step = stepFor(name);
        const value = props.amounts[name] ?? startFor(name);
        return (
          <section className="stepper-card" key={name}>
            <span>{name}</span>
            <div className="stepper">
              <button type="button" aria-label={`Menos ${name}`} onClick={() => props.onAmount(name, Math.max(step, value - step))}>
                <UiIcon name="minus" size={20} />
              </button>
              <strong>{value}</strong>
              <button type="button" aria-label={`Más ${name}`} onClick={() => props.onAmount(name, Math.min(100000, value + step))}>
                <UiIcon name="plus" size={20} />
              </button>
            </div>
            <small>{unitFor(name)}</small>
            <button type="button" className="link-row danger" onClick={() => props.onDrop(name)}>Quitar de la lista</button>
          </section>
        );
      })}
    </>
  );
}

/* ─────────────────────── Pedir manos ─────────────────────── */

function HandsStep(props: {
  kind: string;
  quantity: number;
  detail: string;
  center?: Center;
  onKind: (value: string) => void;
  onQuantity: (value: number) => void;
  onDetail: (value: string) => void;
  onChangeCenter: () => void;
}) {
  const [extra, setExtra] = useState(false);

  return (
    <>
      {props.center && (
        <button type="button" className="context-row" onClick={props.onChangeCenter}>
          <span><UiIcon name="building" size={17} /></span>
          <span className="copy"><strong>{props.center.name}</strong><small>{props.center.city}</small></span>
          <span className="link-row">Cambiar</span>
        </button>
      )}

      <div className="task-grid">
        {TASKS.map((task) => (
          <button
            key={task.kind}
            type="button"
            className={`task-card${props.kind === task.kind ? " on" : ""}`}
            aria-pressed={props.kind === task.kind}
            onClick={() => props.onKind(task.kind)}
          >
            <span><UiIcon name={task.icon} size={20} /></span>
            <strong>{task.kind}</strong>
            <small>{task.detail}</small>
          </button>
        ))}
      </div>

      <section className="stepper-card">
        <span>¿Cuántas personas hacen falta?</span>
        <div className="stepper">
          <button type="button" aria-label="Menos personas" onClick={() => props.onQuantity(Math.max(1, props.quantity - 1))}>
            <UiIcon name="minus" size={20} />
          </button>
          <strong>{props.quantity}</strong>
          <button type="button" aria-label="Más personas" onClick={() => props.onQuantity(Math.min(500, props.quantity + 1))}>
            <UiIcon name="plus" size={20} />
          </button>
        </div>
      </section>

      {extra ? (
        <section className="place-card">
          <label>
            <span>Qué deben hacer <small>opcional</small></span>
            <textarea
              rows={3}
              value={props.detail}
              placeholder="Turno de 8 a. m. a 12 m.; traer guantes"
              onChange={(event) => props.onDetail(event.target.value)}
            />
          </label>
        </section>
      ) : (
        <button type="button" className="ghost-row" onClick={() => setExtra(true)}>
          <UiIcon name="plus" size={18} />
          Agregar instrucciones para el voluntario
        </button>
      )}
    </>
  );
}

/* ─────────────────────── Listados ─────────────────────── */

function CentersScreen(props: {
  centers: Center[];
  position: Position | null;
  myCenterId: string;
  onStatus: (center: Center, status: Center["status"]) => void;
  onMine: (id: string) => void;
  onNew: () => void;
  onBulk: () => void;
}) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");

  const cities = useMemo(
    () => Array.from(new Set(props.centers.map((center) => center.city))).sort((a, b) => a.localeCompare(b, "es")),
    [props.centers],
  );

  const found = useMemo(() => {
    const key = norm(query);
    return props.centers.filter(
      (center) =>
        (!city || center.city === city) &&
        (!key || norm(`${center.name} ${center.city} ${center.address}`).includes(key)),
    );
  }, [props.centers, query, city]);

  return (
    <>
      <label className="search-box">
        <UiIcon name="building" size={18} />
        <input
          type="search"
          value={query}
          placeholder="Buscar centro"
          aria-label="Buscar centro"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {cities.length > 1 && (
        <div className="chips scroll">
          <button type="button" className={`chip${city === "" ? " on" : ""}`} onClick={() => setCity("")}>Todas</button>
          {cities.map((name) => (
            <button key={name} type="button" className={`chip${city === name ? " on" : ""}`} onClick={() => setCity(name)}>{name}</button>
          ))}
        </div>
      )}

      {found.length === 0 ? (
        <p className="empty">No hay centros que coincidan.</p>
      ) : (
        found.map((center) => (
          <section className={`place-card center-row${center.status === "closed" ? " off" : ""}`} key={center.id}>
            <strong>{center.name}</strong>
            <small>
              {center.city} · {center.address}
              {props.position ? ` · a ${formatDistance(distanceKm(props.position, center))}` : ""}
            </small>
            <div className="states">
              <button type="button" aria-pressed={center.status === "active"} onClick={() => props.onStatus(center, "active")}>Recibiendo</button>
              <button type="button" aria-pressed={center.status === "saturated"} onClick={() => props.onStatus(center, "saturated")}>Saturado</button>
              <button type="button" aria-pressed={center.status === "closed"} onClick={() => props.onStatus(center, "closed")}>Cerrado</button>
            </div>
            {props.myCenterId === center.id ? (
              <span className="pill ok">Es mi centro</span>
            ) : (
              <button type="button" className="link-row" onClick={() => props.onMine(center.id)}>Marcar como mi centro</button>
            )}
          </section>
        ))
      )}

      <button type="button" className="ghost-row" onClick={props.onNew}>
        <UiIcon name="plus" size={18} />
        Registrar un centro nuevo
      </button>
      <button type="button" className="ghost-row" onClick={props.onBulk}>
        <UiIcon name="download" size={18} />
        Subir varios desde un Excel
      </button>
    </>
  );
}

function RequestsScreen(props: {
  needs: Need[];
  hands: VolunteerRequest[];
  centers: Center[];
  onReceive: (need: Need, quantity: number) => void;
  onNeedStatus: (need: Need, status: Need["status"]) => void;
  onHandsStatus: (item: VolunteerRequest, status: VolunteerRequest["status"]) => void;
  onNewNeed: () => void;
  onNewHands: () => void;
}) {
  const [kind, setKind] = useState<"productos" | "manos">("productos");
  const [query, setQuery] = useState("");
  const nameOf = (id: string) => props.centers.find((center) => center.id === id)?.name ?? "Centro";
  const key = norm(query);

  const needs = props.needs.filter((need) => !key || norm(`${need.name} ${nameOf(need.centerId)}`).includes(key));
  const hands = props.hands.filter((item) => !key || norm(`${item.kind} ${nameOf(item.centerId)}`).includes(key));

  return (
    <>
      <div className="status-choice">
        <button type="button" aria-pressed={kind === "productos"} onClick={() => setKind("productos")}>Productos</button>
        <button type="button" aria-pressed={kind === "manos"} onClick={() => setKind("manos")}>Manos</button>
      </div>

      <label className="search-box">
        <UiIcon name="package" size={18} />
        <input
          type="search"
          value={query}
          placeholder={kind === "productos" ? "Buscar producto o centro" : "Buscar tarea o centro"}
          aria-label="Buscar"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {kind === "productos" &&
        (needs.length === 0 ? (
          <p className="empty">Aún no se está pidiendo nada.</p>
        ) : (
          needs.map((need) => {
            const step = stepFor(need.name);
            const done = Math.min(100, Math.round(((need.covered + need.committed) / Math.max(1, need.target)) * 100));
            return (
              <section className={`product${need.status === "urgent" ? " urgent" : ""}${need.status === "blocked" ? " blocked" : ""}`} key={need.id}>
                <strong>{need.name}</strong>
                <small className="meta">{nameOf(need.centerId)} · {need.covered + need.committed} de {need.target} {need.unit}</small>
                <div className="bar"><i style={{ width: `${done}%` }} /></div>
                {need.status === "blocked" ? (
                  <button type="button" className="link-row" onClick={() => props.onNeedStatus(need, "urgent")}>Volver a pedirlo</button>
                ) : (
                  <div className="need-actions">
                    <button type="button" onClick={() => props.onReceive(need, step)}>
                      <UiIcon name="plus" size={16} /> Llegaron {step}
                    </button>
                    <button type="button" className="link-row danger" onClick={() => props.onNeedStatus(need, "blocked")}>Ya no hace falta</button>
                  </div>
                )}
              </section>
            );
          })
        ))}

      {kind === "manos" &&
        (hands.length === 0 ? (
          <p className="empty">No hay solicitudes de voluntarios.</p>
        ) : (
          hands.map((item) => (
            <section className="place-card" key={item.id}>
              <strong>{item.kind}</strong>
              <small>{nameOf(item.centerId)} · {item.accepted} de {item.quantity} confirmados</small>
              <div className="states">
                <button type="button" aria-pressed={item.status === "open"} onClick={() => props.onHandsStatus(item, "open")}>Abierta</button>
                <button type="button" aria-pressed={item.status === "filled"} onClick={() => props.onHandsStatus(item, "filled")}>Cubierta</button>
                <button type="button" aria-pressed={item.status === "closed"} onClick={() => props.onHandsStatus(item, "closed")}>Cerrada</button>
              </div>
            </section>
          ))
        ))}

      <button type="button" className="ghost-row" onClick={kind === "productos" ? props.onNewNeed : props.onNewHands}>
        <UiIcon name="plus" size={18} />
        {kind === "productos" ? "Pedir más productos" : "Pedir más manos"}
      </button>
    </>
  );
}

function ReportsScreen(props: { reports: Report[]; onStatus: (report: Report, status: Report["status"]) => void }) {
  const [filter, setFilter] = useState<"pending" | "verified" | "rejected">("pending");
  const labels = { products: "Productos", hands: "Manos", saturation: "Saturación" };
  const list = props.reports.filter((report) => report.status === filter);

  return (
    <>
      <div className="status-choice">
        <button type="button" aria-pressed={filter === "pending"} onClick={() => setFilter("pending")}>Por revisar</button>
        <button type="button" aria-pressed={filter === "verified"} onClick={() => setFilter("verified")}>Publicados</button>
        <button type="button" aria-pressed={filter === "rejected"} onClick={() => setFilter("rejected")}>Retirados</button>
      </div>

      <p className="banner warn">
        Los reportes se publican solos al llegar. Este panel sirve para retirar lo falso, duplicado o peligroso.
      </p>

      {list.length === 0 ? (
        <p className="empty">Nada por aquí.</p>
      ) : (
        list.map((report) => (
          <section className="place-card report-row" key={report.id}>
            <div className="report-meta">
              <span className={`report-category ${report.category}`}>{labels[report.category]}</span>
              <small>{whenOf(report.createdAt)}</small>
            </div>
            <strong>{report.city} · {report.location}</strong>
            <p>{report.details}</p>
            <div className="states">
              <button type="button" aria-pressed={report.status === "verified"} onClick={() => props.onStatus(report, "verified")}>Dejar publicado</button>
              <button type="button" aria-pressed={report.status === "rejected"} onClick={() => props.onStatus(report, "rejected")}>Retirar</button>
            </div>
          </section>
        ))
      )}
    </>
  );
}
