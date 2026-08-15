import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Une clases de Tailwind resolviendo conflictos. Lo espera el componente de mapcn. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
