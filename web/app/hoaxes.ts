/**
 * Bulos verificados sobre el terremoto del 10 de agosto de 2026.
 *
 * Regla de la casa: aquí solo entra lo que un verificador reconocido ya desmintió,
 * con enlace a la verificación. Nada de "me dijeron" ni de sospechas propias. Si algo
 * no está verificado, no se publica — desmentir en falso también es desinformar.
 *
 * Se ordena por lo que más daño hace en una emergencia: primero lo que le cuesta
 * dinero o tiempo a la gente, después lo que solo confunde.
 */

export type HoaxKind = "estafa" | "prediccion" | "imagen" | "video" | "conspiracion";

export type Hoax = {
  kind: HoaxKind;
  /** Lo que circula, en las palabras en que circula. */
  claim: string;
  /** Por qué es falso, en una frase que se pueda repetir. */
  truth: string;
  /** Quién lo desmintió. */
  source: string;
  url: string;
};

export const HOAX_LABEL: Record<HoaxKind, string> = {
  estafa: "Estafa",
  prediccion: "Predicción falsa",
  imagen: "Imagen de IA",
  video: "Video reciclado",
  conspiracion: "Bulo conspirativo",
};

export const HOAXES_VERIFIED_AT = "15 de agosto de 2026";

export const HOAXES: Hoax[] = [
  {
    kind: "estafa",
    claim:
      "Campañas de recolección que llegan por WhatsApp o redes con enlaces y códigos QR, a nombre de socorristas, líderes o fundaciones.",
    truth:
      "La Policía alertó que hay delincuentes suplantando organizaciones de rescate y pidiendo plata a cuentas personales. Una entidad real nunca recauda en una cuenta a nombre de una persona, ni te apura.",
    source: "Policía Nacional · El País",
    url: "https://www.elpais.com.co/colombia/policia-alerta-sobre-estafas-que-usan-el-terremoto-para-pedir-donaciones-falsas-1425.html",
  },
  {
    kind: "estafa",
    claim:
      "Mensajes de un familiar o amigo pidiendo dinero urgente por la emergencia.",
    truth:
      "Es un método conocido: roban la cuenta de WhatsApp y escriben a los contactos. Nunca compartas contraseñas ni códigos de seguridad para donar. Llama a la persona antes de enviar nada.",
    source: "Bancolombia · Semana",
    url: "https://www.semana.com/tecnologia/articulo/bancolombia-hace-llamado-a-extremar-precauciones-para-evitar-estafas-digitales-durante-las-donaciones-por-terremoto/202645/",
  },
  {
    kind: "prediccion",
    claim:
      "Cadenas y audios que anuncian la hora de una réplica, algunos atribuidos al IDEAM.",
    truth:
      "El IDEAM desmintió públicamente esa cadena: ninguna entidad en el mundo puede predecir un sismo ni fijar su hora. En Colombia, la autoridad sísmica es el Servicio Geológico Colombiano.",
    source: "ColombiaCheck",
    url: "https://colombiacheck.com/",
  },
  {
    kind: "imagen",
    claim: "Fotos del Monumento a la Resistencia de Cali derrumbado por el sismo.",
    truth:
      "La imagen fue creada con inteligencia artificial: los detectores le dieron entre 88 % y 99,99 % de probabilidad, y apareció la marca de agua SynthID de Google. La Alcaldía de Cali no reporta ese derrumbe.",
    source: "Factchequeado",
    url: "https://factchequeado.com/verificaciones/20260811/desdesinformaciones-terremoto-colombia-10agosto/",
  },
  {
    kind: "video",
    claim: "Un video de niños en un salón de clase durante el temblor, presentado como de Colombia.",
    truth:
      "Está grabado en la escuela Tubalan, en Filipinas, el 8 de junio de 2026, durante otro terremoto. Lo confirmó el instituto sismológico filipino.",
    source: "Factchequeado",
    url: "https://factchequeado.com/verificaciones/20260811/desdesinformaciones-terremoto-colombia-10agosto/",
  },
  {
    kind: "video",
    claim: "Un video de gases y ceniza del volcán Puracé, atribuido al 10 de agosto.",
    truth:
      "Las imágenes son de días antes del terremoto: circulaban desde el 7 de agosto. El Servicio Geológico Colombiano no reportó una erupción ese día.",
    source: "Factchequeado · La Silla Vacía",
    url: "https://factchequeado.com/verificaciones/20260811/desdesinformaciones-terremoto-colombia-10agosto/",
  },
  {
    kind: "conspiracion",
    claim: "Que el terremoto lo provocó el proyecto HAARP.",
    truth:
      "No hay ninguna evidencia científica que lo respalde. HAARP es una instalación de investigación de la ionosfera y no puede generar sismos.",
    source: "Factchequeado",
    url: "https://factchequeado.com/verificaciones/20260814/terremoto-colombia-haarp-falso/",
  },
];

/** Cómo revisar algo antes de reenviarlo. Corto a propósito: se tiene que recordar. */
export const HOAX_TIPS = [
  "Desconfía de lo que te apura. La urgencia es la herramienta principal del estafador.",
  "Busca la cuenta oficial. Si el dinero va a una cuenta personal, no es una entidad.",
  "Mira la fecha del video antes de reenviarlo. Casi siempre es de otro país o de otro año.",
  "Si nadie más lo publica, probablemente no pasó. Contrasta con un medio o una alcaldía.",
];
