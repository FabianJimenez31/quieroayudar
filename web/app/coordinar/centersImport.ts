/**
 * De una hoja de cálculo cualquiera a centros de acopio publicables.
 *
 * Quien llena el Excel está en medio de una emergencia, no cuadrando un ETL:
 * los encabezados se reconocen con sinónimos, las coordenadas se aceptan en
 * columnas o dentro de un enlace de Google Maps, y la coma decimal —lo normal
 * en Colombia— se entiende igual que el punto.
 */

import type { SheetRows } from "./spreadsheet";

export type ImportedCenter = {
  line: number;
  name: string;
  city: string;
  address: string;
  contact: string;
  hours: string;
  sourceName: string;
  sourceUrl: string;
  latitude: number | null;
  longitude: number | null;
  duplicate: boolean;
  notes: string[];
  errors: string[];
};

export type ImportReading = {
  items: ImportedCenter[];
  /** Campos obligatorios que ninguna columna llenó. */
  missing: string[];
  /** Cierto cuando la hoja no traía encabezados y se usó el orden de la plantilla. */
  positional: boolean;
};

export const TEMPLATE_HEADERS = [
  "Nombre",
  "Ciudad",
  "Dirección",
  "Teléfono",
  "Horario",
  "Latitud",
  "Longitud",
  "Enlace de mapa",
  "Responsable o fuente",
] as const;

const TEMPLATE_EXAMPLES = [
  [
    "Parroquia San José",
    "Medellín",
    "Calle 45 #33-12, barrio Buenos Aires",
    "3001234567",
    "8 a. m. a 6 p. m.",
    "6.2412",
    "-75.5628",
    "",
    "Cruz Roja seccional",
  ],
  [
    "Coliseo La Esperanza",
    "Quibdó",
    "Carrera 7 #10-40",
    "3109876543",
    "24 horas",
    "",
    "",
    "https://www.google.com/maps?q=5.6947,-76.6611",
    "Alcaldía",
  ],
];

/** Sinónimos por campo, ya normalizados (sin tildes, sin espacios, minúsculas). */
const ALIASES: Record<string, string[]> = {
  name: ["nombre", "name", "centro", "nombrecentro", "nombredelcentro", "puntodeacopio", "acopio", "lugar", "punto"],
  city: ["ciudad", "city", "municipio", "localidad", "poblacion", "ciudadmunicipio"],
  address: ["direccion", "address", "dir", "ubicacion", "direccionexacta", "domicilio"],
  contact: ["telefono", "contacto", "celular", "phone", "whatsapp", "contact", "numero", "telefonocontacto"],
  hours: ["horario", "horarios", "hours", "atencion", "horadeatencion", "horarioatencion"],
  latitude: ["latitud", "lat", "latitude"],
  longitude: ["longitud", "lng", "lon", "long", "longitude"],
  link: ["enlacedemapa", "enlacemapa", "mapa", "maps", "googlemaps", "enlace", "link", "url", "coordenadas", "ubicacionmapa", "gps"],
  sourceName: ["responsableofuente", "responsable", "fuente", "organizacion", "entidad", "source", "encargado", "operador"],
  sourceUrl: ["urlfuente", "fuenteurl", "sitioweb", "sitio", "web", "paginaweb", "enlacefuente"],
};

const FIELD_ORDER = ["name", "city", "address", "contact", "hours", "latitude", "longitude", "link", "sourceName"];

/** Colombia continental e insular, con holgura. Sirve para avisar, no para bloquear. */
const COLOMBIA = { minLat: -4.5, maxLat: 13.6, minLng: -82.2, maxLng: -66.6 };

export function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function matchColumns(header: string[]) {
  const columns: Record<string, number> = {};
  header.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (!key) return;
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (columns[field] === undefined && aliases.includes(key)) columns[field] = index;
    }
  });
  return columns;
}

/** Coordenadas sueltas o escondidas en un enlace de Google/Apple Maps. */
export function parseCoordinates(value: string): { latitude: number; longitude: number } | null {
  const text = value.trim();
  if (!text) return null;

  const patterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/, // google maps /@lat,lng,zoom
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // enlaces de ficha de lugar
    /[?&](?:q|query|ll|sll|center|daddr|destination|coordinate)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
  ];
  for (const pattern of patterns) {
    const found = pattern.exec(text);
    if (found) return build(Number(found[1]), Number(found[2]));
  }

  // "4,6512; -74,0813" — coma decimal con punto y coma de separador.
  const commaDecimal = /^(-?\d+,\d+)\s*[;|]\s*(-?\d+,\d+)$/.exec(text);
  if (commaDecimal) {
    return build(Number(commaDecimal[1].replace(",", ".")), Number(commaDecimal[2].replace(",", ".")));
  }

  const plain = /^(-?\d+(?:\.\d+)?)\s*[,;| ]\s*(-?\d+(?:\.\d+)?)$/.exec(text);
  if (plain) return build(Number(plain[1]), Number(plain[2]));

  return null;

  function build(latitude: number, longitude: number) {
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  }
}

/** Acepta "6.2412", "6,2412" y "1.234,56": manda el último separador que aparezca. */
export function toNumber(value: string): number | null {
  const text = value.trim().replace(/\s|°/g, "");
  if (!text) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized = text;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = text.replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function trimTo(value: string, maximum: number, label: string, notes: string[]) {
  const clean = value.trim().replace(/\s+/g, " ");
  if (clean.length <= maximum) return clean;
  notes.push(`${label} se recortó a ${maximum} caracteres.`);
  return clean.slice(0, maximum);
}

const keyOf = (name: string, city: string) => `${normalizeHeader(name)}|${normalizeHeader(city)}`;

export function readCenters(rows: SheetRows, existing: { name: string; city: string }[]): ImportReading {
  const clean = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (clean.length === 0) return { items: [], missing: ["Nombre", "Ciudad", "Dirección"], positional: false };

  let columns = matchColumns(clean[0]);
  let body = clean.slice(1);
  let headerOffset = 2; // fila 1 = encabezados

  // Sin encabezados reconocibles, se asume el orden de la plantilla y la
  // primera fila también es un centro: es lo que pasa cuando alguien copia
  // y pega el listado sin el título de las columnas.
  const positional = Object.keys(columns).length < 2;
  if (positional) {
    columns = Object.fromEntries(FIELD_ORDER.map((field, index) => [field, index]));
    body = clean;
    headerOffset = 1;
  }

  const missing = (["name", "city", "address"] as const)
    .filter((field) => columns[field] === undefined)
    .map((field) => ({ name: "Nombre", city: "Ciudad", address: "Dirección" })[field]);

  const seen = new Set(existing.map((center) => keyOf(center.name, center.city)));
  const items = body.map((row, index) => toCenter(row, columns, index + headerOffset, seen));
  return { items, missing, positional };
}

function toCenter(row: string[], columns: Record<string, number>, line: number, seen: Set<string>): ImportedCenter {
  const notes: string[] = [];
  const errors: string[] = [];
  const cell = (field: string) => {
    const index = columns[field];
    return index === undefined ? "" : (row[index] ?? "").trim();
  };

  const name = trimTo(cell("name"), 100, "El nombre", notes);
  const city = trimTo(cell("city"), 80, "La ciudad", notes);
  const address = trimTo(cell("address"), 180, "La dirección", notes);
  const contact = trimTo(cell("contact"), 80, "El teléfono", notes);
  const hours = trimTo(cell("hours"), 100, "El horario", notes);
  const sourceName = trimTo(cell("sourceName"), 120, "La fuente", notes);
  let sourceUrl = trimTo(cell("sourceUrl"), 500, "El enlace de la fuente", notes);

  let latitude = toNumber(cell("latitude"));
  let longitude = toNumber(cell("longitude"));

  // La columna de enlace hace doble oficio: si trae coordenadas, completan las
  // que falten; si es una página cualquiera, queda como fuente del dato.
  const link = cell("link");
  if (link) {
    const fromLink = parseCoordinates(link);
    if (fromLink && (latitude === null || longitude === null)) {
      latitude = fromLink.latitude;
      longitude = fromLink.longitude;
      notes.push("Coordenadas tomadas del enlace.");
    } else if (!fromLink && !sourceUrl && /^https?:\/\//i.test(link)) {
      sourceUrl = link.slice(0, 500);
    }
  }

  if (!name) errors.push("Falta el nombre.");
  if (!city) errors.push("Falta la ciudad.");
  if (!address) errors.push("Falta la dirección.");

  if (latitude === null || longitude === null) {
    errors.push("Faltan las coordenadas (latitud y longitud, o un enlace de mapa).");
  } else {
    // Invertir latitud y longitud es el error más común al copiar de un mapa:
    // ninguna latitud del planeta llega a -60 en Colombia, pero la longitud sí.
    if (latitude < -60 && longitude >= COLOMBIA.minLat && longitude <= COLOMBIA.maxLat) {
      [latitude, longitude] = [longitude, latitude];
      notes.push("Latitud y longitud venían invertidas: se corrigieron.");
    }
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      errors.push("Las coordenadas están fuera de rango.");
    } else if (latitude === 0 && longitude === 0) {
      errors.push("Las coordenadas están en cero.");
    } else if (
      latitude < COLOMBIA.minLat ||
      latitude > COLOMBIA.maxLat ||
      longitude < COLOMBIA.minLng ||
      longitude > COLOMBIA.maxLng
    ) {
      notes.push("El punto cae fuera de Colombia: verifica antes de publicar.");
    }
  }

  const duplicate = Boolean(name && city && seen.has(keyOf(name, city)));
  if (name && city) seen.add(keyOf(name, city));

  return {
    line,
    name,
    city,
    address,
    contact,
    hours,
    sourceName,
    sourceUrl,
    latitude,
    longitude,
    duplicate,
    notes,
    errors,
  };
}

/** Plantilla con BOM para que Excel respete las tildes al abrirla. */
export function buildTemplateCsv() {
  const escape = (value: string) => (/[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [TEMPLATE_HEADERS.join(","), ...TEMPLATE_EXAMPLES.map((row) => row.map(escape).join(","))];
  return `\ufeff${lines.join("\r\n")}\r\n`;
}
