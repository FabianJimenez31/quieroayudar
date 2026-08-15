"use client";

import { Suspense, lazy, useEffect, useState } from "react";
import type { CentersMapCanvasProps } from "./CentersMapCanvas";

/**
 * MapLibre pesa más que toda la app junta y toca `window` al importarse, así que
 * no puede entrar ni en el paquete inicial ni en el render del servidor. Se carga
 * cuando el usuario ya está en el navegador y pidió ver el mapa.
 */
const Canvas = lazy(() => import("./CentersMapCanvas"));

export default function CentersMap(props: CentersMapCanvasProps) {
  const [mounted, setMounted] = useState(false);

  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="map-frame map-loading">Cargando mapa…</div>;

  return (
    <Suspense fallback={<div className="map-frame map-loading">Cargando mapa…</div>}>
      <Canvas {...props} />
    </Suspense>
  );
}
