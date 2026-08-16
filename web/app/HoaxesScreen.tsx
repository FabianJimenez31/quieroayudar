"use client";

import UiIcon from "./UiIcon";
import { HOAXES, HOAX_LABEL, HOAX_TIPS, HOAXES_VERIFIED_AT, type Hoax } from "./hoaxes";

/**
 * Bulos verificados. Va aparte del resto de la app a propósito: mezclar lo falso con
 * lo cierto en la misma lista es la forma más rápida de que alguien recuerde el bulo
 * y olvide el desmentido. Aquí todo lo que se lee es falso, y se dice desde el título.
 */

export default function HoaxesScreen() {
  const scams = HOAXES.filter((item) => item.kind === "estafa");
  const rest = HOAXES.filter((item) => item.kind !== "estafa");

  return (
    <div className="dc-body wide-gap" style={{ padding: "16px 0" }}>
      <p className="dc-note danger">
        Todo lo que aparece en esta pantalla es <strong>falso</strong>. Está aquí para que lo
        reconozcas y no lo reenvíes.
      </p>

      <section style={{ display: "grid", gap: 8 }}>
        <span className="dc-eyebrow">Te pueden robar</span>
        {scams.map((item) => (
          <HoaxCard key={item.claim} item={item} />
        ))}
      </section>

      <section style={{ display: "grid", gap: 8 }}>
        <span className="dc-eyebrow">Circula y confunde</span>
        {rest.map((item) => (
          <HoaxCard key={item.claim} item={item} />
        ))}
      </section>

      <section className="dc-card">
        <span className="dc-eyebrow soft">Antes de reenviar</span>
        <ul style={{ display: "grid", gap: 7, listStyle: "none", margin: "6px 0 0", padding: 0 }}>
          {HOAX_TIPS.map((tip) => (
            <li key={tip} style={{ color: "#334155", fontSize: "12.5px", lineHeight: 1.45 }}>
              {tip}
            </li>
          ))}
        </ul>
      </section>

      <p className="dc-sub" style={{ textAlign: "center" }}>
        Verificado el {HOAXES_VERIFIED_AT}. Si algo no está desmentido por un verificador, no lo
        publicamos aquí.
      </p>
    </div>
  );
}

function HoaxCard({ item }: { item: Hoax }) {
  return (
    <article className="dc-card">
      <span className="dc-tag urgent">{HOAX_LABEL[item.kind]}</span>
      <p style={{ color: "#0f172a", fontSize: "13px", fontWeight: 600, lineHeight: 1.35, margin: "6px 0 0" }}>
        {item.claim}
      </p>
      <p style={{ color: "#334155", fontSize: "12.5px", lineHeight: 1.45, margin: "6px 0 0" }}>
        {item.truth}
      </p>
      <a
        className="dc-ghost"
        style={{ marginTop: 8, textDecoration: "none" }}
        href={item.url}
        target="_blank"
        rel="noreferrer"
      >
        Ver la verificación de {item.source}
        <UiIcon name="external" size={15} />
      </a>
    </article>
  );
}
