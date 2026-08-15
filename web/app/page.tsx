import type { Metadata } from "next";
import RedApoyoApp from "./RedApoyoApp";

export const metadata: Metadata = {
  title: "Ayuda humanitaria en tiempo real",
  description:
    "Red abierta para publicar necesidades, encontrar centros de acopio, donar y ofrecer voluntariado en Colombia.",
};

export default function Home() {
  return <RedApoyoApp />;
}
