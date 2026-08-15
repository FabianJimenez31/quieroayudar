/**
 * Iniciativas corporativas abiertas tras el sismo del 10 de agosto de 2026.
 *
 * Aquí hay plata de por medio, así que cada ficha lleva su fuente y la fecha en
 * que se comprobó. Nada de esto se recauda desde la app: siempre se sale al canal
 * oficial de la empresa. Si una campaña se cierra o cambia de cuenta, se corrige
 * este archivo — es preferible una lista corta y cierta a una larga y vieja.
 */

export type InitiativeKind = "kit" | "caja" | "cuenta" | "cajero" | "especie" | "acopio";

export type Initiative = {
  id: string;
  company: string;
  /** Qué es, en una línea que se entienda sin contexto. */
  headline: string;
  kind: InitiativeKind;
  /** Pasos concretos para donar. Uno por línea, en imperativo. */
  steps: string[];
  /** Datos que se copian tal cual: cuentas, llaves Bre-B, WhatsApp. */
  data?: { label: string; value: string }[];
  link?: { label: string; url: string };
  source: { name: string; url: string };
  /** Hasta cuándo está abierta, cuando la empresa lo anunció. */
  until?: string;
};

export const KIND_LABEL: Record<InitiativeKind, string> = {
  kit: "Kit en tienda",
  caja: "Aporte en caja",
  cuenta: "Cuenta bancaria",
  cajero: "Cajero y app",
  especie: "Donación en especie",
  acopio: "Centros de acopio",
};

/** Fecha en la que se verificó toda la lista contra las fuentes citadas. */
export const INITIATIVES_VERIFIED_AT = "14 de agosto de 2026";

export const INITIATIVES: Initiative[] = [
  {
    id: "d1",
    company: "Tiendas D1",
    headline: "Compras un kit de ayuda y D1 dona otro igual",
    kind: "kit",
    steps: [
      "Pide un kit de $15.000 (aseo o alimentos básicos) o de $30.000 (lo mismo en mayor cantidad) en cualquiera de las más de 2.850 tiendas, o en d1.com.co.",
      "No te llevas el producto: recibes el recibo de pago y D1 lo despacha desde sus centros de distribución a los bancos de alimentos.",
      "Por cada kit que compra un cliente, la empresa dona otro. La meta son 1.000 toneladas entregadas con la Fundación Santo Domingo.",
    ],
    link: { label: "Donar en d1.com.co", url: "https://www.d1.com.co" },
    source: {
      name: "El País",
      url: "https://www.elpais.com.co/colombia/tiendas-d1-activo-espacio-para-donar-kits-de-ayuda-para-damnificados-del-terremoto-asi-puede-ayudar-1340.html",
    },
  },
  {
    id: "exito",
    company: "Grupo Éxito",
    headline: "Goticas en caja en Éxito, Carulla, Surtimax y Super Inter",
    kind: "caja",
    steps: [
      "Al pagar en cualquiera de las cuatro cadenas, di que quieres aportar a la campaña de Goticas.",
      "Lo recaudado va a la Fundación Éxito, que entrega paquetes nutricionales a 3.500 familias en San José del Palmar, Cali, Pereira y Manizales.",
    ],
    until: "Abierta hasta el 15 de septiembre de 2026",
    source: {
      name: "Forbes Colombia",
      url: "https://forbes.co/actualidad/empresas-se-movilizan-para-recoger-recursos-y-ayuda-para-las-victimas-del-terremoto",
    },
  },
  {
    id: "aval",
    company: "Grupo Aval y billetera dale!",
    headline: "Donación en más de 2.700 cajeros automáticos",
    kind: "cajero",
    steps: [
      "Usa un cajero de Banco de Bogotá, Banco de Occidente, Banco Popular o AV Villas y elige la opción de donación.",
      "También se puede aportar desde la billetera dale! sin ir a un cajero.",
      "Todo lo recaudado se entrega a la Cruz Roja Colombiana.",
    ],
    source: {
      name: "El Colombiano",
      url: "https://www.elcolombiano.com/negocios/empresas-donaciones-terremoto-colombia-bancolombia-argos-andi-GE39862545",
    },
  },
  {
    id: "bancolombia",
    company: "Fundación Bancolombia",
    headline: "Cuenta de ahorros abierta para alimentos, salud y albergue",
    kind: "cuenta",
    steps: [
      "Transfiere a la cuenta de ahorros de la Fundación Bancolombia desde cualquier banco.",
      "Está abierta a clientes, empleados y público en general.",
    ],
    data: [{ label: "Cuenta de ahorros Bancolombia", value: "24542391932" }],
    until: "Primera fase de recaudo hasta el 30 de agosto de 2026",
    source: {
      name: "Portafolio",
      url: "https://www.portafolio.co/negocios/empresas/bancolombia-habilita-cuenta-para-canalizar-donaciones-dirigidas-a-afectados-por-terremoto-en-colombia-500114",
    },
  },
  {
    id: "abaco",
    company: "ABACO · Bancos de Alimentos de Colombia",
    headline: "Red de 26 bancos de alimentos: plata o mercado",
    kind: "cuenta",
    steps: [
      "Dona en línea, por transferencia o con la llave Bre-B.",
      "Para entregas grandes o para saber qué producto está priorizado, escribe al WhatsApp antes de mover la carga.",
      "Puntos físicos principales: Armenia, Cali y Manizales.",
    ],
    data: [
      { label: "Cuenta de ahorros Bancolombia", value: "04867105340" },
      { label: "Cuenta corriente Bancolombia", value: "15264342372" },
      { label: "Llave Bre-B", value: "0090989753" },
      { label: "NIT", value: "900326456-1" },
      { label: "WhatsApp para entregas grandes", value: "313 245 7978" },
    ],
    link: { label: "Donar en donahoy.abaco.org.co", url: "https://donahoy.abaco.org.co/colombia2026" },
    source: {
      name: "El Tiempo",
      url: "https://www.eltiempo.com/colombia/otras-ciudades/ayudas-tras-terremoto-en-colombia-centros-de-acopio-bancos-de-sangre-bancos-de-alimentos-canales-oficiales-y-puntos-de-donaciones-en-el-pais-3577631",
    },
  },
  {
    id: "banco-alimentos-bogota",
    company: "Banco de Alimentos de Bogotá",
    headline: "Llave Bre-B y bodega en el centro de Bogotá",
    kind: "cuenta",
    steps: [
      "Dona con la llave Bre-B, o lleva mercado a la bodega de la Calle 19 A # 32-50.",
    ],
    data: [{ label: "Llave Bre-B", value: "0091677852" }],
    link: { label: "bancodealimentos.org.co", url: "https://www.bancodealimentos.org.co" },
    source: {
      name: "El Tiempo",
      url: "https://www.eltiempo.com/colombia/otras-ciudades/ayudas-tras-terremoto-en-colombia-centros-de-acopio-bancos-de-sangre-bancos-de-alimentos-canales-oficiales-y-puntos-de-donaciones-en-el-pais-3577631",
    },
  },
  {
    id: "argos",
    company: "Fundación Grupo Argos",
    headline: "Campaña de $1.000 millones administrada por Corporación Presentes",
    kind: "cuenta",
    steps: [
      "Aporta a la campaña de la Fundación Grupo Argos; los fondos los administra la Corporación Presentes.",
      "La compañía además evalúa Obras por Impuestos para financiar la reconstrucción de infraestructura.",
    ],
    source: {
      name: "El Colombiano",
      url: "https://www.elcolombiano.com/negocios/empresas-donaciones-terremoto-colombia-bancolombia-argos-andi-GE39862545",
    },
  },
  {
    id: "andi",
    company: "ANDI y Consejo Gremial Nacional",
    headline: "Corredor humanitario con la red de bancos de alimentos",
    kind: "acopio",
    steps: [
      "Lleva alimentos, medicamentos e insumos a los centros principales: Buenaventura, Istmina, Manizales y Pereira.",
      "Centros secundarios: Armenia, Bogotá, Bucaramanga, Cali, Ibagué y Medellín.",
      "La ANDI destina además el 50% de las inscripciones al 11º Congreso Empresarial Colombiano.",
    ],
    source: {
      name: "El Colombiano",
      url: "https://www.elcolombiano.com/negocios/empresas-donaciones-terremoto-colombia-bancolombia-argos-andi-GE39862545",
    },
  },
  {
    id: "ara",
    company: "Tiendas Ara",
    headline: "39 toneladas de mercado y bonos redimibles para las familias",
    kind: "especie",
    steps: [
      "La donación la entrega la cadena con el Gobierno Nacional y los bancos de alimentos: agua, arroz, aceite, pasta, granos, enlatados, harina, panela, avena, leche en polvo y aseo.",
      "Suma además bonos redimibles para que las familias afectadas compren canasta básica.",
      "No hay recaudo al público: si quieres aportar en especie, usa los centros de acopio de la app.",
    ],
    source: {
      name: "El Colombiano",
      url: "https://www.elcolombiano.com/negocios/ara-d1-ayudas-damnificados-terremoto-colombia-toneladas-alimentos-MF39873294",
    },
  },
  {
    id: "bavaria",
    company: "Bavaria",
    headline: "250.000 unidades de agua y Pony Malta",
    kind: "especie",
    steps: [
      "Entrega coordinada con el Despacho de la Primera Dama y las autoridades locales.",
      "No hay recaudo al público.",
    ],
    source: {
      name: "El Colombiano",
      url: "https://www.elcolombiano.com/negocios/empresas-donaciones-terremoto-colombia-bancolombia-argos-andi-GE39862545",
    },
  },
  {
    id: "bbva",
    company: "BBVA",
    headline: "3.500 kits de alimentos no perecederos y aseo",
    kind: "especie",
    steps: [
      "Los reparten los bancos de alimentos regionales en Chocó, Valle del Cauca, Risaralda y Caldas.",
      "No hay recaudo al público.",
    ],
    source: {
      name: "Portafolio",
      url: "https://www.portafolio.co/negocios/empresas/grupo-aval-exito-nutresa-bavaria-grandes-empresas-de-colombia-activan-ayudas-para-afectados-por-el-terremo-500113",
    },
  },
  {
    id: "ecopetrol",
    company: "Ecopetrol",
    headline: "$5.000 millones, voluntarios y ayuda humanitaria",
    kind: "especie",
    steps: [
      "Recursos propios y personal de la empresa movilizados a las zonas afectadas.",
      "No hay recaudo al público.",
    ],
    source: {
      name: "El Colombiano",
      url: "https://www.elcolombiano.com/inicio/ecopetrol-dona-5000-millones-terremoto-ED39901656",
    },
  },
];

/**
 * Empresas que la ANDI y el Ministerio de Comercio reportan vinculadas a
 * "Colombia Un Solo Corazón" pero sin canal público de donación propio: se
 * listan para dar contexto, no para mandar a nadie a buscarlas.
 */
export const ALSO_JOINED = [
  "Grupo Nutresa",
  "Grupo Olímpica",
  "Avianca",
  "Organización Ardila Lülle",
  "Coca-Cola",
  "McDonald's",
  "Tecnoglass",
  "Ultracem",
  "AFIDRO",
];

/** Cifra agregada que publica la ANDI sobre el aporte del empresariado. */
export const BUSINESS_TOTAL = {
  amount: "$15.047 millones",
  note: "aportados por el empresariado colombiano, según la ANDI",
  source: {
    name: "El Heraldo",
    url: "https://www.elheraldo.co/economia/2026/08/13/empresarios-colombianos-superan-los-15000-millones-en-donaciones-para-victimas-del-terremoto/",
  },
};
