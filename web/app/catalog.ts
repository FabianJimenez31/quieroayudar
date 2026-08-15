/**
 * Catálogo único de productos.
 *
 * Lo usan la app de campo (`RedApoyoApp`) y el panel de coordinación
 * (`coordinar/CoordinatorApp`). Debe ser una sola fuente porque el backend cruza las
 * necesidades por nombre exacto en minúsculas (`needs-batch`, app/main.py): si los dos
 * lados escriben el nombre distinto, se crean necesidades duplicadas que el centro ya no
 * puede cerrar desde terreno.
 *
 * `step` y `start` alimentan el stepper de meta: nunca se escribe una cantidad a mano.
 */

export type CatalogItem = {
  name: string;
  unit: string;
  step: number;
  start: number;
};

export type CatalogGroup = {
  group: string;
  items: CatalogItem[];
};

export const CATALOG: CatalogGroup[] = [
  {
    group: "Agua segura",
    items: [
      { name: "Agua embotellada", unit: "garrafones", step: 20, start: 100 },
      { name: "Garrafones o bidones", unit: "unidades", step: 10, start: 40 },
      { name: "Recipientes con tapa", unit: "unidades", step: 10, start: 50 },
      { name: "Pastillas potabilizadoras", unit: "paquetes", step: 10, start: 50 },
    ],
  },
  {
    group: "Alimentos",
    items: [
      { name: "Alimentos no perecederos", unit: "kilos", step: 25, start: 100 },
      { name: "Raciones listas para consumir", unit: "raciones", step: 25, start: 100 },
      { name: "Alimentos para bebés", unit: "paquetes", step: 10, start: 30 },
    ],
  },
  {
    group: "Higiene y dignidad",
    items: [
      { name: "Jabón y detergente", unit: "unidades", step: 10, start: 50 },
      { name: "Kits de aseo", unit: "kits", step: 10, start: 50 },
      { name: "Toallas higiénicas", unit: "paquetes", step: 10, start: 40 },
      { name: "Pañales", unit: "paquetes", step: 10, start: 60 },
      { name: "Papel higiénico y toallitas", unit: "paquetes", step: 10, start: 40 },
    ],
  },
  {
    group: "Salud y primeros auxilios",
    items: [
      { name: "Botiquines", unit: "kits", step: 5, start: 20 },
      { name: "Gasas, vendas y esparadrapo", unit: "paquetes", step: 10, start: 40 },
      { name: "Guantes y tapabocas", unit: "cajas", step: 5, start: 20 },
      { name: "Suero oral", unit: "unidades", step: 20, start: 80 },
      { name: "Medicamentos solicitados por personal de salud", unit: "cajas", step: 5, start: 20 },
    ],
  },
  {
    group: "Abrigo y refugio",
    items: [
      { name: "Cobijas", unit: "unidades", step: 10, start: 50 },
      { name: "Colchonetas", unit: "unidades", step: 10, start: 40 },
      { name: "Carpas y lonas", unit: "unidades", step: 5, start: 15 },
      { name: "Ropa nueva o en buen estado por talla", unit: "bolsas", step: 10, start: 30 },
    ],
  },
  {
    group: "Niñez y mascotas",
    items: [
      { name: "Leche maternizada solicitada", unit: "latas", step: 10, start: 30 },
      { name: "Alimento para mascotas", unit: "bultos", step: 5, start: 20 },
      { name: "Correas, guacales y platos", unit: "unidades", step: 5, start: 20 },
    ],
  },
  {
    group: "Limpieza y logística",
    items: [
      { name: "Bolsas para residuos", unit: "rollos", step: 10, start: 40 },
      { name: "Escobas y palas", unit: "unidades", step: 5, start: 20 },
      { name: "Botas, cascos y guantes de trabajo", unit: "juegos", step: 5, start: 20 },
      { name: "Linternas y pilas", unit: "unidades", step: 10, start: 40 },
      { name: "Power banks y cables", unit: "unidades", step: 5, start: 20 },
    ],
  },
];

export const CATALOG_ITEMS: CatalogItem[] = CATALOG.flatMap((section) => section.items);

/** Unidad sugerida para un producto del catálogo, por nombre exacto. */
export function unitFor(name: string): string {
  const key = name.trim().toLowerCase();
  return CATALOG_ITEMS.find((item) => item.name.toLowerCase() === key)?.unit ?? "unidades";
}
