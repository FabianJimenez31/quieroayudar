"use client";

/**
 * Carga masiva de centros de acopio.
 *
 * Cuando una alcaldía o una fundación ya tiene el listado en Excel, pedirle que
 * lo teclee centro por centro es perder horas que no hay. Aquí se sube el
 * archivo (o se pega desde la hoja), se revisa fila por fila lo que va a quedar
 * publicado y solo entonces se envía.
 */

import { useRef, useState } from "react";
import UiIcon from "../UiIcon";
import { readSheet, parseDelimited, type SheetRows } from "./spreadsheet";
import { buildTemplateCsv, readCenters, TEMPLATE_HEADERS, type ImportedCenter } from "./centersImport";

/** Tope por tanda: el alta es una petición por centro y no queremos tumbar la API. */
const MAX_ROWS = 300;
const PREVIEW_ROWS = 60;
const CONCURRENCY = 3;

type Failure = { line: number; name: string; message: string };
type Summary = { created: number; failures: Failure[] };

export default function BulkCenters({
  existing,
  onPublished,
}: {
  existing: { name: string; city: string }[];
  onPublished: () => Promise<void> | void;
}) {
  const [items, setItems] = useState<ImportedCenter[]>([]);
  const [origin, setOrigin] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [excluded, setExcluded] = useState<number[]>([]);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  // Se aplica a toda la tanda: quien sube un listado lo hace para una sola emergencia a la vez.
  const [cause, setCause] = useState<"terremoto" | "tolima">("terremoto");
  const fileInput = useRef<HTMLInputElement>(null);

  const ready = items.filter((item) => item.errors.length === 0 && !excluded.includes(item.line));
  const broken = items.filter((item) => item.errors.length > 0);
  const duplicated = items.filter((item) => item.duplicate && item.errors.length === 0);

  function reset() {
    setItems([]);
    setOrigin("");
    setWarnings([]);
    setError("");
    setExcluded([]);
    setPasted("");
    setPasting(false);
    setProgress(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function load(rows: SheetRows, source: string) {
    setSummary(null);
    const reading = readCenters(rows, existing);
    if (reading.items.length === 0) {
      setItems([]);
      setError("La hoja no trae filas con datos.");
      return;
    }
    if (reading.missing.length > 0) {
      setItems([]);
      setError(
        `No encontramos la columna de ${reading.missing.join(", ")}. Descarga la plantilla y usa esos encabezados.`,
      );
      return;
    }

    const notices: string[] = [];
    if (reading.positional) {
      notices.push("La hoja no traía encabezados: se leyó en el orden de la plantilla. Revisa que cada columna corresponda.");
    }
    let list = reading.items;
    if (list.length > MAX_ROWS) {
      list = list.slice(0, MAX_ROWS);
      notices.push(`El archivo trae ${reading.items.length} filas. Se cargaron las primeras ${MAX_ROWS}; sube el resto en otra tanda.`);
    }

    setError("");
    setWarnings(notices);
    setItems(list);
    setOrigin(source);
    // Un centro que ya existe con el mismo nombre y ciudad queda desmarcado,
    // pero visible: a veces sí son dos puntos distintos con el mismo nombre.
    setExcluded(list.filter((item) => item.duplicate).map((item) => item.line));
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    try {
      load(await readSheet(file), `${file.name} · ${(file.size / 1024).toFixed(0)} KB`);
    } catch (caught) {
      setItems([]);
      setError(caught instanceof Error ? caught.message : "No pudimos leer el archivo.");
    }
  }

  function usePasted() {
    if (!pasted.trim()) return;
    load(parseDelimited(pasted), "Pegado desde la hoja de cálculo");
    setPasting(false);
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([buildTemplateCsv()], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "plantilla-centros-de-acopio.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function toggle(line: number) {
    setExcluded((current) => (current.includes(line) ? current.filter((value) => value !== line) : [...current, line]));
  }

  async function publish() {
    const queue = [...ready];
    if (queue.length === 0) return;
    setError("");
    setSummary(null);
    setProgress({ done: 0, total: queue.length });

    const failures: Failure[] = [];
    let created = 0;

    // De a pocos y en paralelo controlado: 300 peticiones de golpe desde un
    // celular con mala señal terminan en la mitad de los centros perdidos.
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          const response = await fetch("/api/centers", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: item.name,
              city: item.city,
              address: item.address,
              latitude: item.latitude,
              longitude: item.longitude,
              contact: item.contact,
              hours: item.hours,
              sourceName: item.sourceName,
              sourceUrl: item.sourceUrl,
              cause,
            }),
          });
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          if (!response.ok) throw new Error(body.error || `El servidor respondió ${response.status}.`);
          created += 1;
        } catch (caught) {
          failures.push({
            line: item.line,
            name: item.name,
            message: caught instanceof Error ? caught.message : "No se pudo publicar.",
          });
        }
        setProgress((current) => (current ? { ...current, done: current.done + 1 } : current));
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ready.length) }, worker));

    setProgress(null);
    setSummary({ created, failures });
    // Solo se quedan en pantalla las que fallaron, para reintentarlas sin volver a subir.
    const pending = new Set(failures.map((failure) => failure.line));
    setItems((current) => current.filter((item) => pending.has(item.line) || item.errors.length > 0 || excluded.includes(item.line)));
    if (created > 0) await onPublished();
  }

  const busy = progress !== null;

  return (
    <section className="bulk-import">
      <header>
        <div>
          <p className="eyebrow">Varios centros a la vez</p>
          <h2>Carga masiva por Excel</h2>
          <p>
            Sube el listado en .xlsx o CSV, o pégalo directo desde la hoja. Antes de publicar puedes revisar fila por
            fila lo que va a quedar en el mapa.
          </p>
        </div>
        <button type="button" onClick={downloadTemplate}>
          <UiIcon name="download" size={16} /> Descargar plantilla
        </button>
      </header>

      <label className="bulk-cause">
        <span>Causa de esta tanda</span>
        <div className="chips" role="radiogroup" aria-label="Causa de la tanda">
          {(["terremoto", "tolima"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={cause === option}
              className={`chip${cause === option ? " on" : ""}`}
              disabled={busy}
              onClick={() => setCause(option)}
            >
              {option === "tolima" ? "Incendios Tolima" : "Terremoto"}
            </button>
          ))}
        </div>
      </label>

      <div className="bulk-sources">
        <label className="bulk-file">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xlsm,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={(event) => void pickFile(event.target.files?.[0])}
          />
          <span className="bulk-file-face">
            <UiIcon name="package" size={22} />
            <strong>Elegir archivo</strong>
            <small>.xlsx, .csv o .tsv · hasta {MAX_ROWS} centros por tanda</small>
          </span>
        </label>
        <button type="button" className="bulk-paste-toggle" disabled={busy} onClick={() => setPasting((value) => !value)}>
          <UiIcon name="reports" size={22} />
          <strong>Pegar desde Excel</strong>
          <small>Copia las filas en la hoja y pégalas aquí</small>
        </button>
      </div>

      {pasting && (
        <div className="bulk-paste">
          <label>
            <span>Pega las filas (con o sin la fila de encabezados)</span>
            <textarea
              rows={6}
              value={pasted}
              placeholder={`${TEMPLATE_HEADERS.join("\t")}\nParroquia San José\tMedellín\tCalle 45 #33-12\t3001234567\t8 a. m. a 6 p. m.\t6.2412\t-75.5628`}
              onChange={(event) => setPasted(event.target.value)}
            />
          </label>
          <button type="button" className="admin-submit" onClick={usePasted} disabled={!pasted.trim()}>
            Revisar filas pegadas
          </button>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {warnings.map((notice) => (
        <p className="bulk-warning" key={notice}>
          <UiIcon name="alert" size={16} /> {notice}
        </p>
      ))}

      {summary && (
        <div className="bulk-summary" role="status">
          <strong>
            {summary.created > 0 ? `${summary.created} centros publicados.` : "No se publicó ningún centro."}
          </strong>
          {summary.failures.length > 0 && (
            <>
              <span>{summary.failures.length} quedaron pendientes y siguen en la tabla para reintentar:</span>
              <ul>
                {summary.failures.slice(0, 8).map((failure) => (
                  <li key={failure.line}>
                    Fila {failure.line} · {failure.name || "sin nombre"} — {failure.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="bulk-counts">
            <span className="ok">{ready.length} listos para publicar</span>
            {duplicated.length > 0 && <span className="dup">{duplicated.length} ya existen</span>}
            {broken.length > 0 && <span className="bad">{broken.length} con datos incompletos</span>}
            <small>{origin}</small>
          </div>

          <div className="bulk-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Publicar</th>
                  <th scope="col">Fila</th>
                  <th scope="col">Centro</th>
                  <th scope="col">Ciudad</th>
                  <th scope="col">Dirección</th>
                  <th scope="col">Coordenadas</th>
                  <th scope="col">Revisión</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, PREVIEW_ROWS).map((item) => {
                  const failed = item.errors.length > 0;
                  return (
                    <tr key={item.line} className={failed ? "bad" : excluded.includes(item.line) ? "off" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Publicar ${item.name || `fila ${item.line}`}`}
                          checked={!failed && !excluded.includes(item.line)}
                          disabled={failed || busy}
                          onChange={() => toggle(item.line)}
                        />
                      </td>
                      <td>{item.line}</td>
                      <td>
                        <strong>{item.name || "—"}</strong>
                        {item.contact && <small>{item.contact}</small>}
                      </td>
                      <td>{item.city || "—"}</td>
                      <td>{item.address || "—"}</td>
                      <td>
                        {item.latitude !== null && item.longitude !== null
                          ? `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}`
                          : "—"}
                      </td>
                      <td>
                        {failed && <span className="tag bad">{item.errors.join(" ")}</span>}
                        {item.duplicate && !failed && <span className="tag dup">Ya existe un centro así</span>}
                        {item.notes.map((note) => (
                          <span className="tag note" key={note}>
                            {note}
                          </span>
                        ))}
                        {!failed && !item.duplicate && item.notes.length === 0 && <span className="tag ok">Listo</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {items.length > PREVIEW_ROWS && (
              <p className="bulk-more">
                Se muestran {PREVIEW_ROWS} de {items.length} filas. Se publican todas las marcadas.
              </p>
            )}
          </div>

          <div className="bulk-actions">
            <button type="button" className="admin-submit" disabled={busy || ready.length === 0} onClick={() => void publish()}>
              {progress
                ? `Publicando ${progress.done}/${progress.total}…`
                : ready.length > 0
                  ? `Publicar ${ready.length} centros`
                  : "No hay filas marcadas"}
            </button>
            <button type="button" className="bulk-clear" disabled={busy} onClick={reset}>
              Descartar
            </button>
          </div>
        </>
      )}
    </section>
  );
}
