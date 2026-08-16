"use client";

import { useState } from "react";
import UiIcon from "./UiIcon";
import {
  ALSO_JOINED,
  BUSINESS_TOTAL,
  INITIATIVES,
  INITIATIVES_VERIFIED_AT,
  KIND_LABEL,
  type Initiative,
} from "./initiatives";

/**
 * Iniciativas de empresas. La app no recauda un peso: cada tarjeta termina en el
 * canal oficial de quien recibe. Se separan las campañas donde el usuario puede
 * aportar de las donaciones que la empresa ya hizo, porque mezclarlas hace que
 * alguien intente donar donde no hay dónde.
 */

const OPEN_TO_PUBLIC = new Set(["kit", "caja", "cuenta", "cajero", "acopio"]);

export default function InitiativesScreen({ onFlash }: { onFlash: (message: string) => void }) {
  const open = INITIATIVES.filter((item) => OPEN_TO_PUBLIC.has(item.kind));
  const corporate = INITIATIVES.filter((item) => !OPEN_TO_PUBLIC.has(item.kind));

  return (
    <div className="dc-body wide-gap" style={{ padding: "16px 0" }}>
      <p className="dc-note danger">
        Esta app no recauda un peso. Verifica siempre el número de cuenta en el canal oficial de la
        empresa antes de transferir.
      </p>

      <section style={{ display: "grid", gap: 8 }}>
        <span className="dc-eyebrow">Puedes aportar tú</span>
        {open.map((item) => (
          <InitiativeCard key={item.id} item={item} onFlash={onFlash} />
        ))}
      </section>

      {/* Sin recaudo abierto: se listan compactas para no invitar a transferir donde no hay dónde. */}
      <section style={{ display: "grid", gap: 8 }}>
        <span className="dc-eyebrow">Ya entregado por su cuenta</span>
        {corporate.map((item) => (
          <article className="dc-card sm" key={item.id} style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
            <span className="dc-sigla sm">{sigla(item.company)}</span>
            <span style={{ display: "grid", flex: 1, gap: 2, minWidth: 0 }}>
              <strong style={{ fontSize: "12.5px", fontWeight: 700, lineHeight: 1.2 }}>{item.company}</strong>
              <span className="dc-sub" style={{ fontSize: "11px" }}>{item.headline}</span>
            </span>
            <span className="dc-pill-kind">{KIND_LABEL[item.kind]}</span>
          </article>
        ))}
      </section>

      <section style={{ display: "grid", gap: 8 }}>
        <span className="dc-eyebrow">También se vincularon</span>
        <div className="dc-chips" style={{ flexWrap: "wrap", overflow: "visible" }}>
          {ALSO_JOINED.map((name) => <span className="dc-tag soft" key={name}>{name}</span>)}
        </div>
      </section>

      <p className="fineprint">
        Total reportado {BUSINESS_TOTAL.amount} · {BUSINESS_TOTAL.note}{" "}
        <a href={BUSINESS_TOTAL.source.url} target="_blank" rel="noreferrer">
          Fuente: {BUSINESS_TOTAL.source.name}
        </a>
      </p>
      <p className="fineprint">
        Lista verificada el {INITIATIVES_VERIFIED_AT} contra las fuentes citadas en cada tarjeta.
      </p>
    </div>
  );
}

/** Dos letras de la empresa para la ficha, como en el diseño. */
function sigla(name: string): string {
  const words = name.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}

function InitiativeCard({ item, onFlash }: { item: Initiative; onFlash: (message: string) => void }) {
  const [copied, setCopied] = useState("");

  async function copy(label: string, value: string) {
    const plain = value.replace(/\s+/g, "");
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(label);
      onFlash(`${label} copiado: ${plain}`);
    } catch {
      onFlash(`Copia a mano: ${plain}`);
    }
  }

  return (
    <article className="dc-card">
      <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
        <span className="dc-sigla">{sigla(item.company)}</span>
        <span style={{ display: "grid", flex: 1, gap: 2, minWidth: 0 }}>
          <strong style={{ fontSize: "13.5px", fontWeight: 700, lineHeight: 1.2 }}>{item.company}</strong>
          <span className="dc-sub">{item.headline}</span>
        </span>
        <span className="dc-pill-kind">{KIND_LABEL[item.kind]}</span>
      </div>

      {item.data?.map((row) => (
        <div className="dc-account" key={row.label}>
          <span>{row.value}</span>
          <button type="button" onClick={() => void copy(row.label, row.value)}>
            {copied === row.label ? "Copiado" : "Copiar"}
          </button>
        </div>
      ))}

      {item.until && <p className="dc-note warn" style={{ margin: 0 }}>{item.until}</p>}

      <div className="initiative-actions">
        {item.link && (
          <a className="route" href={item.link.url} target="_blank" rel="noreferrer">
            {item.link.label} <UiIcon name="external" size={14} />
          </a>
        )}
        <a className="initiative-source" href={item.source.url} target="_blank" rel="noreferrer">
          Fuente: {item.source.name}
        </a>
      </div>
    </article>
  );
}
