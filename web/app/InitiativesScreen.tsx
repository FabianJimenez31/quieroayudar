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
    <>
      <p className="lead-text">
        Empresas que abrieron un canal para que cualquiera done, y lo que ya entregaron por su
        cuenta. Aquí no se recauda nada: cada botón te lleva al canal oficial de quien recibe.
      </p>

      <section className="place-card">
        <span className="eyebrow">Aporte empresarial reportado</span>
        <strong>{BUSINESS_TOTAL.amount}</strong>
        <small>{BUSINESS_TOTAL.note}</small>
        <small>
          <a href={BUSINESS_TOTAL.source.url} target="_blank" rel="noreferrer">
            Fuente: {BUSINESS_TOTAL.source.name}
          </a>
        </small>
      </section>

      <section className="banner warn" role="note">
        <span>
          Verifica la cuenta en la página o la línea oficial de la empresa antes de transferir.
          Nadie de esta plataforma te va a pedir plata ni datos por chat.
        </span>
      </section>

      <section className="group">
        <h2>
          Puedes aportar tú<span>{open.length}</span>
        </h2>
        <div className="stack">
          {open.map((item) => (
            <InitiativeCard key={item.id} item={item} onFlash={onFlash} />
          ))}
        </div>
      </section>

      <section className="group">
        <h2>
          Ya lo donó la empresa<span>{corporate.length}</span>
        </h2>
        <p className="lead-text">
          No tienen recaudo abierto al público. Si quieres aportar en especie, usa los centros de
          acopio de la app.
        </p>
        <div className="stack">
          {corporate.map((item) => (
            <InitiativeCard key={item.id} item={item} onFlash={onFlash} />
          ))}
        </div>
      </section>

      <section className="group">
        <h2>También se vincularon</h2>
        <div className="chips">
          {ALSO_JOINED.map((name) => (
            <span className="pill soft" key={name}>
              {name}
            </span>
          ))}
        </div>
        <p className="fineprint">
          Reportadas dentro de la estrategia oficial «Colombia Un Solo Corazón», sin canal propio de
          donación al público.
        </p>
      </section>

      <p className="fineprint">
        Lista verificada el {INITIATIVES_VERIFIED_AT} contra las fuentes citadas en cada tarjeta. Las
        campañas cambian: si encuentras una cerrada o una cuenta distinta, avísanos desde
        coordinación.
      </p>
    </>
  );
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
    <article className="initiative">
      <div className="initiative-top">
        <strong>{item.company}</strong>
        <span className={`pill kind kind--${item.kind}`}>{KIND_LABEL[item.kind]}</span>
      </div>
      <p className="initiative-lead">{item.headline}</p>

      <ol>
        {item.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      {item.data && (
        <dl className="initiative-data">
          {item.data.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>
                <span>{row.value}</span>
                <button type="button" onClick={() => void copy(row.label, row.value)}>
                  <UiIcon name={copied === row.label ? "check" : "download"} size={14} />
                  {copied === row.label ? "Copiado" : "Copiar"}
                </button>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {item.until && <p className="note">{item.until}</p>}

      <div className="initiative-actions">
        {item.link && (
          <a className="route" href={item.link.url} target="_blank" rel="noreferrer">
            {item.link.label} <UiIcon name="external" size={15} />
          </a>
        )}
        <a className="initiative-source" href={item.source.url} target="_blank" rel="noreferrer">
          Fuente: {item.source.name}
        </a>
      </div>
    </article>
  );
}
