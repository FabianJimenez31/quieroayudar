/**
 * Lectura de hojas de cálculo sin dependencias: CSV, TSV y XLSX.
 *
 * El .xlsx es un ZIP con XML dentro, y el navegador ya sabe descomprimir
 * (`DecompressionStream`). Meter una librería de Excel en una PWA que la gente
 * abre desde el celular en zona afectada costaría más de un mega de descarga
 * para lo que aquí resuelven doscientas líneas.
 */

export type SheetRows = string[][];

const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const ZIP_EOCD = 0x06054b50;

export async function readSheet(file: File): Promise<SheetRows> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) return readXlsx(await file.arrayBuffer());
  if (name.endsWith(".xls")) {
    throw new Error("El formato .xls es antiguo. Ábrelo y guárdalo como .xlsx o CSV.");
  }
  if (name.endsWith(".numbers") || name.endsWith(".ods")) {
    throw new Error("Exporta la hoja como .xlsx o CSV y vuelve a subirla.");
  }
  return parseDelimited(await readText(file));
}

/* ───────────────────────────── Texto plano ───────────────────────────── */

/** Excel en Windows sigue exportando CSV en Windows-1252: si no es UTF-8, se reintenta. */
async function readText(file: File) {
  const buffer = await file.arrayBuffer();
  try {
    return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } catch {
    return stripBom(new TextDecoder("windows-1252").decode(buffer));
  }
}

function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Detecta el separador mirando la primera línea, fuera de comillas. */
function detectDelimiter(text: string) {
  const counts: Record<string, number> = { "\t": 0, ";": 0, ",": 0, "|": 0 };
  let quoted = false;
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    else if (character === "\n" && !quoted) break;
    else if (!quoted && character in counts) counts[character] += 1;
  }
  const [best, times] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return times > 0 ? best : ",";
}

/** CSV/TSV con comillas y saltos de línea dentro de celda. */
export function parseDelimited(text: string, delimiter = detectDelimiter(text)): SheetRows {
  const rows: SheetRows = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1; }
        else quoted = false;
      } else cell += character;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === delimiter) { row.push(cell); cell = ""; continue; }
    if (character === "\r") continue;
    if (character === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += character;
  }
  row.push(cell);
  rows.push(row);

  return rows.filter((line) => line.some((value) => value.trim() !== ""));
}

/* ─────────────────────────────── XLSX ─────────────────────────────── */

type ZipEntry = { name: string; method: number; compressedSize: number; offset: number };

async function readXlsx(buffer: ArrayBuffer): Promise<SheetRows> {
  const entries = readZipEntries(buffer);
  const sheet = pickFirstSheet(entries);
  if (!sheet) throw new Error("El archivo no trae ninguna hoja legible.");

  const sharedEntry = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
  const shared = sharedEntry ? parseSharedStrings(await readEntry(buffer, sharedEntry)) : [];
  return parseSheetXml(await readEntry(buffer, sheet), shared);
}

function readZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  // El directorio central vive al final; su marca se busca hacia atrás porque
  // el comentario final del ZIP es de largo variable.
  let end = -1;
  const floor = Math.max(0, view.byteLength - 66_000);
  for (let index = view.byteLength - 22; index >= floor; index -= 1) {
    if (view.getUint32(index, true) === ZIP_EOCD) { end = index; break; }
  }
  if (end < 0) throw new Error("El archivo no parece un Excel válido (.xlsx).");

  const total = view.getUint16(end + 10, true);
  const entries: ZipEntry[] = [];
  let cursor = view.getUint32(end + 16, true);

  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== ZIP_CENTRAL) break;
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    entries.push({
      name: new TextDecoder().decode(new Uint8Array(buffer, cursor + 46, nameLength)),
      method: view.getUint16(cursor + 10, true),
      // Los tamaños del directorio central mandan: la cabecera local puede
      // traerlos en cero cuando el escritor usó descriptor de datos.
      compressedSize: view.getUint32(cursor + 20, true),
      offset: view.getUint32(cursor + 42, true),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Sin resolver los rels del libro: la hoja 1 es la primera en todo Excel real. */
function pickFirstSheet(entries: ZipEntry[]) {
  return entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
    .sort((a, b) => Number(a.name.match(/\d+/)![0]) - Number(b.name.match(/\d+/)![0]))[0];
}

async function readEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buffer);
  if (view.getUint32(entry.offset, true) !== ZIP_LOCAL) {
    throw new Error("No pudimos leer el contenido del Excel.");
  }
  const start =
    entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = new Uint8Array(buffer, start, entry.compressedSize);

  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error("El Excel usa una compresión que no podemos abrir. Guárdalo como CSV.");
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Este navegador no puede abrir .xlsx. Guarda la hoja como CSV e inténtalo de nuevo.");
  }

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
    strings.push(collectText(match[1] ?? ""));
  }
  return strings;
}

function parseSheetXml(xml: string, shared: string[]): SheetRows {
  const rows: SheetRows = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const line: string[] = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2] ?? "";
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1] ?? "n";
      const column = /\br="([A-Z]+)/.exec(attributes)?.[1];

      let value: string;
      if (type === "inlineStr") value = collectText(body);
      else {
        const raw = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        value = type === "s" ? shared[Number(raw)] ?? "" : decodeXml(raw);
      }

      const index = column ? columnIndex(column) : line.length;
      while (line.length < index) line.push("");
      line[index] = value;
    }
    if (line.some((value) => value.trim() !== "")) rows.push(line);
  }
  return rows;
}

/** "AB" → 27. Las hojas nombran columnas en base 26 sin cero. */
function columnIndex(letters: string) {
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function collectText(fragment: string) {
  // Una celda con formatos mezclados parte el texto en varios <t>.
  let text = "";
  for (const match of fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += match[1];
  return decodeXml(text);
}

function decodeXml(value: string) {
  return value
    .replace(/_x000D_/g, "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
