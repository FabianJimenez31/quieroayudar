import type { Metadata } from "next";
import CoordinatorApp from "./CoordinatorApp";

export const metadata: Metadata = {
  title: "Coordinación · Red de Apoyo",
  description: "Alta de centros de acopio y ajuste de inventario, solicitudes y reportes.",
};

export default function CoordinationPage() {
  return <CoordinatorApp />;
}
