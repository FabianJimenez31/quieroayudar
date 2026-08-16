/**
 * Formas que devuelve `/api/network`. Viven aparte porque el mapa y la app las
 * comparten: si cada uno declarase las suyas, una cambiaría sin la otra.
 */

export type Level = "urgent" | "normal" | "blocked";

/** Emergencia a la que sirve un centro. "terremoto" es la causa por defecto. */
export type Cause = "terremoto" | "tolima";

export type Center = {
  id: string;
  name: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  contact: string;
  hours: string;
  sourceName?: string;
  sourceUrl?: string;
  verifiedAt?: string | null;
  status: "active" | "saturated" | "closed";
  volunteersSaturated?: boolean;
  /** "approximate" = solo tenemos la dirección; el pin es del barrio o de la calle. */
  locationPrecision?: "exact" | "approximate";
  cause?: Cause;
};

export type Need = {
  id: string;
  centerId: string;
  name: string;
  detail: string;
  priority: "critical" | "high" | "medium";
  target: number;
  covered: number;
  committed: number;
  unit: string;
  status: Level;
};

export type VolunteerRequest = {
  id: string;
  centerId: string;
  kind: string;
  detail: string;
  quantity: number;
  accepted: number;
  status: "open" | "filled" | "closed";
};

export type FieldReport = {
  id: string;
  category: "products" | "hands" | "saturation";
  city: string;
  location: string;
  details: string;
  createdAt: string;
};

export type Network = {
  centers: Center[];
  needs: Need[];
  volunteerRequests: VolunteerRequest[];
  reports: FieldReport[];
};

export type Position = { latitude: number; longitude: number };
