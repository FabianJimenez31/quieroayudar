import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function source() {
  return readFile(new URL("../app/RedApoyoApp.tsx", import.meta.url), "utf8");
}

test("opens on the role picker, not on a marketing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /Red de Apoyo Colombia/i);
  assert.match(html, /ayudando hoy/i);
  assert.match(html, /Estoy en una zona afectada/i);
  assert.match(html, /Atiendo un centro de acopio/i);
  assert.match(html, /Puedo ofrecer manos/i);
  assert.match(html, /Quiero donar/i);

  assert.match(html, /Línea 123/);
  assert.match(html, /Saltar al contenido/i);
  assert.match(html, /<svg/i);
  assert.match(html, /manifest\.webmanifest/i);

  assert.doesNotMatch(html, /[✋⌖⌂▣]/u);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
  assert.doesNotMatch(html, /Acceso de coordinación|Código de coordinación|Clave operativa/i);
});

test("ships the installable PWA assets", async () => {
  const root = new URL("../dist/client/", import.meta.url);
  await Promise.all([
    access(new URL("icon-192.png", root)),
    access(new URL("icon-512.png", root)),
  ]);
  const serviceWorker = await readFile(new URL("sw.js", root), "utf8");
  assert.match(serviceWorker, /red-apoyo-shell-v9/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
});

test("every screen is shareable and the system back button works", async () => {
  const code = await source();
  for (const route of ["afectado", "acopio", "voluntariado", "donar", "productos", "saturacion", "comprometer"]) {
    assert.match(code, new RegExp(`"${route}"`));
  }
  // Sin pushState y popstate, el atrás de Android cierra la PWA instalada.
  assert.match(code, /window\.history\.pushState/);
  assert.match(code, /addEventListener\("popstate"/);
  assert.match(code, /window\.history\.back\(\)/);
});

test("saturation can be undone from the field", async () => {
  const code = await source();
  // Marcar y desmarcar: si solo existiera "saturated" sería un camino sin retorno.
  assert.match(code, /status: next \? "saturated" : "active"/);
  assert.match(code, /onLiftSaturation/);
});

test("both frontends share one product catalog", async () => {
  const code = await source();
  const panel = await readFile(new URL("../app/coordinar/CoordinatorApp.tsx", import.meta.url), "utf8");
  assert.match(code, /from "\.\/catalog"/);
  assert.match(panel, /from "\.\.\/catalog"/);
  // El backend cruza necesidades por nombre exacto: dos catálogos crean duplicados.
  assert.doesNotMatch(panel, /DONATION_GROUPS/);
});

test("switching role does not carry the centre's product list", async () => {
  const code = await source();
  assert.match(code, /role === "acopio" \? myCenterId : ""/);
});

test("every report screen is tap-only and ends in a confirmation", async () => {
  const code = await source();
  // Tres estados por producto, sin campos de cantidad escritos a mano.
  assert.match(code, />Urgente</);
  assert.match(code, />Se necesita</);
  assert.match(code, />Ya hay</);
  assert.match(code, /¿Cuántas personas\?/);
  assert.match(code, /Solicitar manos|Falta apoyo/);
  assert.match(code, /DONE_TITLES/);
  // La meta se fija con stepper, nunca con teclado.
  assert.doesNotMatch(code, /type="number"/);
});

test("field actions change real records instead of only writing a note", async () => {
  const code = await source();
  assert.match(code, /action: "needs-batch"/);
  assert.match(code, /action: "volunteer-request"/);
  assert.match(code, /volunteersSaturated/);
  assert.match(code, /send\("\/api\/centers", "PATCH"/);
});

test("does not promise anything the app cannot do", async () => {
  const code = await source();
  assert.doesNotMatch(code, /se enviará sola|queda en cola/i);
  assert.doesNotMatch(code, /cifrad/i);
  // No existe endpoint de cancelación: el cupo solo se libera al vencer.
  assert.doesNotMatch(code, /cancela para liberar/i);
  assert.match(code, /se libera solo a las/);
  // El reporte de personas deriva a la línea oficial en vez de prometer rescate.
  assert.match(code, /tel:123/);
});

test("home shows the state of the network, not just four buttons", async () => {
  const response = await render();
  const html = await response.text();

  // Las cuatro preguntas que el tablero responde de un vistazo.
  assert.match(html, /Ahora mismo/);
  assert.match(html, /Qué falta/);
  assert.match(html, /Cuánto se entregó/);
  assert.match(html, /Quién trabaja/);
  assert.match(html, /Dónde faltan manos/);
  // Los roles siguen presentes: el tablero acompaña, no reemplaza.
  assert.match(html, /Estoy en una zona afectada/);
});

test("an empty dashboard says so instead of showing zeros as if they were data", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /Nada publicado/);
  assert.match(html, /Sin metas aún/);
});

test("the tutorial is reachable and covers every role", async () => {
  const code = await source();
  assert.match(code, /"como-funciona"/);
  assert.match(code, /Mira cómo funciona en un minuto/);
  for (const role of ["afectado", "acopio", "logistica", "donante"]) {
    assert.match(code, new RegExp(`role: "${role}",\\n\\s+title:`));
  }
});

test("a centre can record what actually arrived", async () => {
  const code = await source();
  // Sin esto se promete, la promesa vence, y nada consta como entregado.
  assert.match(code, /action: "needs-received"/);
  assert.match(code, /Registrar lo que llegó/);
  assert.match(code, /"recibido"/);
  // Lo entregado y lo prometido no se mezclan: una promesa no es una caja en el suelo.
  assert.match(code, /prometidos/);
});

test("opening the app at the root always lands on home", async () => {
  const code = await source();
  // El rol guardado ya no secuestra la entrada: sin `?vista` se abre el inicio.
  assert.doesNotMatch(code, /: known \?\? "roles"/);
  assert.match(code, /\? linked : "roles"/);
  // Pero quien ya tenía rol conserva el atajo para retomarlo.
  assert.match(code, /Seguir como/);
});

test("the fake-news section is reachable and every claim carries its debunk", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /Noticias falsas que están circulando/);

  const hoaxes = await readFile(new URL("../app/hoaxes.ts", import.meta.url), "utf8");
  const count = (pattern) => (hoaxes.match(pattern) ?? []).length;
  const claims = count(/^ {4}claim:/gm);
  assert.ok(claims > 0, "no hay bulos publicados");
  // Publicar un bulo sin decir quién lo desmintió es publicar el bulo.
  assert.equal(count(/^ {4}truth:/gm), claims);
  assert.equal(count(/^ {4}source:/gm), claims);
  assert.equal(count(/^ {4}url: "https:\/\//gm), claims);
});
