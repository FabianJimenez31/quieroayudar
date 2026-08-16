/**
 * Genera la imagen que un centro comparte en Instagram con lo que le hace
 * falta. Todo ocurre en el navegador (canvas 2D): el sitio corre en un
 * Cloudflare Worker, sin Node ni motor de render en el servidor.
 */

export type ShareNeed = { name: string; unit: string; remaining: number; urgent: boolean };
export type ShareCenter = { name: string; city: string; address: string };

const COLORS = {
  primary: "#114DBA",
  secondary: "#0A388C",
  accent: "#C7352D",
  background: "#F5F7FA",
  foreground: "#101923",
  muted: "#5B6B7A",
};

const WIDTH = 1080;
const MAX_ROWS = 8;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * next/font renombra la familia real de Montserrat (para aislarla en CSS), así
 * que "Montserrat" a secas no existe como @font-face: hay que leer el nombre
 * generado desde un elemento que ya use la variable, o el canvas cae a la
 * fuente del sistema.
 */
function brandFont() {
  return getComputedStyle(document.body).fontFamily || "sans-serif";
}

/** Dibuja la tarjeta de necesidades en un <canvas> ya creado (no necesita estar en el DOM). */
export function drawNeedsShareImage(canvas: HTMLCanvasElement, center: ShareCenter, needs: ShareNeed[]) {
  const font = brandFont();
  const shown = needs.slice(0, MAX_ROWS);
  const extra = needs.length - shown.length;
  const rowHeight = 96;
  const rowGap = 18;

  canvas.width = WIDTH;
  // Alto provisional solo para poder medir texto antes de fijar el alto real.
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Este navegador no soporta canvas.");

  const bandHeight = 210;
  const marginX = 60;
  const contentWidth = WIDTH - marginX * 2;

  ctx.font = `700 52px ${font}`;
  const nameLines = wrapLines(ctx, center.name, contentWidth).slice(0, 2);

  const footerHeight = 130;
  const listTop = bandHeight + 90 + nameLines.length * 62 + 60;
  const listHeight = shown.length * (rowHeight + rowGap) + (extra > 0 ? 56 : 0);
  const height = listTop + listHeight + footerHeight + 40;

  canvas.height = height;
  // Fijar canvas.height reinicia el contexto: hay que volver a tomarlo y a fijar fuentes.
  const draw = canvas.getContext("2d");
  if (!draw) throw new Error("Este navegador no soporta canvas.");

  draw.fillStyle = COLORS.background;
  draw.fillRect(0, 0, WIDTH, height);

  draw.fillStyle = COLORS.primary;
  draw.fillRect(0, 0, WIDTH, bandHeight);
  draw.fillStyle = "#FFFFFF";
  draw.font = `700 40px ${font}`;
  draw.fillText("QuieroAyudar.co", marginX, 92);
  draw.font = `500 30px ${font}`;
  draw.fillText("Necesitamos tu ayuda", marginX, 142);

  let y = bandHeight + 90;
  draw.fillStyle = COLORS.foreground;
  draw.font = `700 52px ${font}`;
  for (const line of nameLines) {
    draw.fillText(line, marginX, y);
    y += 62;
  }

  draw.fillStyle = COLORS.muted;
  draw.font = `500 30px ${font}`;
  draw.fillText(`${center.city} · ${center.address}`, marginX, y);
  y += 60;

  for (const need of shown) {
    roundRect(draw, marginX, y, contentWidth, rowHeight, 20);
    draw.fillStyle = "#FFFFFF";
    draw.fill();

    if (need.urgent) {
      roundRect(draw, marginX, y, 10, rowHeight, 5);
      draw.fillStyle = COLORS.accent;
      draw.fill();
    }

    const label = "URGENTE";
    draw.font = `700 24px ${font}`;
    const badgeWidth = need.urgent ? draw.measureText(label).width + 24 : 0;

    draw.fillStyle = COLORS.foreground;
    draw.font = `700 34px ${font}`;
    const nameMaxWidth = contentWidth - 36 - 24 - badgeWidth;
    draw.fillText(truncateToWidth(draw, need.name, nameMaxWidth), marginX + 36, y + 42);

    draw.fillStyle = need.urgent ? COLORS.accent : COLORS.secondary;
    draw.font = `600 28px ${font}`;
    const detailMaxWidth = contentWidth - 36 - 24;
    draw.fillText(truncateToWidth(draw, `Faltan ${need.remaining} ${need.unit}`, detailMaxWidth), marginX + 36, y + 78);

    if (need.urgent) {
      draw.fillStyle = COLORS.accent;
      draw.font = `700 24px ${font}`;
      draw.fillText(label, marginX + contentWidth - draw.measureText(label).width - 32, y + 42);
    }

    y += rowHeight + rowGap;
  }

  if (extra > 0) {
    draw.fillStyle = COLORS.muted;
    draw.font = `500 28px ${font}`;
    draw.fillText(`y ${extra} producto${extra === 1 ? "" : "s"} más`, marginX, y + 24);
  }

  draw.fillStyle = COLORS.secondary;
  draw.fillRect(0, height - footerHeight, WIDTH, footerHeight);
  draw.fillStyle = "#FFFFFF";
  draw.font = `700 34px ${font}`;
  draw.textAlign = "center";
  draw.fillText("Valida más productos en quieroayudar.co", WIDTH / 2, height - footerHeight / 2 + 12);
  draw.textAlign = "left";
}
