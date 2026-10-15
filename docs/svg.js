// Cartel en SVG para cortar y grabar con láser. Todo en milímetros.
//
//  - "corte": contorno de la placa (esquinas redondeadas) y agujeros opcionales, como líneas finas.
//  - "grabado": pictograma y texto como formas rellenas (el texto va convertido a trazados,
//    así no depende de que la fuente esté instalada en el programa del láser).
//
// Por defecto todo usa un único color, elegido por la persona usuaria.

export const DEFAULTS = {
  color: "#000000",
  colorCorte: null,        // null = el mismo color que el grabado
  pictoSize: 50,           // lado del recuadro del pictograma
  pictoStyle: "lineas",    // "lineas" | "silueta" | "mixto"
  mostrarTexto: true,
  textSize: 9,             // tamaño de letra (mm)
  margin: 6,
  gap: 4,                  // separación pictograma-texto
  cornerRadius: 5,
  holes: false,
  holeDiameter: 4,
  strokeWidth: 0.1,        // grosor de la línea de corte (mm)
  anchoMin: 0,             // para dar el mismo tamaño a varios carteles
  altoMin: 0,
};

const r3 = (n) => Math.round(n * 1000) / 1000;

export function sanear(p) {
  const q = { ...DEFAULTS, ...p };
  q.pictoSize = Math.max(10, q.pictoSize);
  q.textSize = Math.max(2, q.textSize);
  q.margin = Math.max(1, q.margin);
  q.gap = Math.max(0, q.gap);
  q.holeDiameter = Math.max(1, q.holeDiameter);
  q.cornerRadius = Math.max(0, q.cornerRadius);
  return q;
}

/** Medidas de un cartel sin construir el SVG (sirve para igualar el tamaño de un lote). */
export function medir(font, texto, picto, p) {
  const q = sanear(p);
  const lineas = q.mostrarTexto ? texto.split("\n").map((l) => l.trim()).filter(Boolean) : [];
  const anchoLinea = lineas.map((l) => font.getAdvanceWidth(l, q.textSize));
  const anchoTexto = anchoLinea.length ? Math.max(...anchoLinea) : 0;
  const hayPicto = !!picto;
  const altoTexto = lineas.length ? 0.73 * q.textSize + (lineas.length - 1) * 1.25 * q.textSize + 0.22 * q.textSize : 0;
  const contenidoW = Math.max(hayPicto ? q.pictoSize : 0, anchoTexto);
  const contenidoH = (hayPicto ? q.pictoSize : 0) + (hayPicto && lineas.length ? q.gap : 0) + altoTexto;
  const extra = q.holes ? 2 * (q.holeDiameter + q.margin * 0.5) : 0; // sitio para los agujeros laterales
  return {
    q, lineas, anchoLinea, altoTexto, hayPicto,
    w: contenidoW + 2 * q.margin + extra,
    h: contenidoH + 2 * q.margin,
  };
}

function rectRedondeado(w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  if (r <= 0) return `M0 0H${r3(w)}V${r3(h)}H0Z`;
  return (
    `M${r3(r)} 0H${r3(w - r)}A${r3(r)} ${r3(r)} 0 0 1 ${r3(w)} ${r3(r)}` +
    `V${r3(h - r)}A${r3(r)} ${r3(r)} 0 0 1 ${r3(w - r)} ${r3(h)}` +
    `H${r3(r)}A${r3(r)} ${r3(r)} 0 0 1 0 ${r3(h - r)}` +
    `V${r3(r)}A${r3(r)} ${r3(r)} 0 0 1 ${r3(r)} 0Z`
  );
}

function circulo(cx, cy, r) {
  return `M${r3(cx - r)} ${r3(cy)}A${r3(r)} ${r3(r)} 0 1 0 ${r3(cx + r)} ${r3(cy)}A${r3(r)} ${r3(r)} 0 1 0 ${r3(cx - r)} ${r3(cy)}Z`;
}

function pictoAPath(loops, map) {
  return loops.map((loop) => "M" + loop.map(([x, y]) => { const [a, b] = map(x, y); return `${r3(a)} ${r3(b)}`; }).join("L") + "Z").join("");
}

/**
 * Construye un cartel. Devuelve { w, h, inner } donde `inner` es el contenido SVG
 * (grupos "corte" y "grabado") en coordenadas del cartel, con el origen arriba a la izquierda.
 */
export function construirCartel(font, texto, picto, p) {
  const m = medir(font, texto, picto, p);
  const q = m.q;
  const W = Math.max(m.w, q.anchoMin);
  const H = Math.max(m.h, q.altoMin);
  const cut = q.colorCorte || q.color;

  // centra el contenido dentro de la placa
  const contenidoH = H - 2 * q.margin;
  const bloqueH = (m.hayPicto ? q.pictoSize : 0) + (m.hayPicto && m.lineas.length ? q.gap : 0) + m.altoTexto;
  let y = q.margin + (contenidoH - bloqueH) / 2;
  const cx = W / 2;

  const grabado = [];
  if (m.hayPicto) {
    const S = q.pictoSize;
    const x0 = cx - S / 2;
    const map = (x, yy) => [x0 + (S - picto.w * S) / 2 + x * S, y + (S - picto.h * S) / 2 + (picto.h - yy) * S];
    let d;
    let regla = "nonzero";
    if (q.pictoStyle === "silueta") d = pictoAPath(picto.outer, map);
    else if (q.pictoStyle === "mixto") { d = pictoAPath(picto.outer, map) + pictoAPath(picto.detail, map); regla = "evenodd"; }
    else d = pictoAPath(picto.detail.length ? picto.detail : picto.outer, map);
    grabado.push(`<path id="pictograma" fill-rule="${regla}" d="${d}"/>`);
    y += S + (m.lineas.length ? q.gap : 0);
  }
  if (m.lineas.length) {
    const trozos = [];
    m.lineas.forEach((linea, i) => {
      const base = y + 0.73 * q.textSize + i * 1.25 * q.textSize;
      const ancho = m.anchoLinea[i];
      trozos.push(font.getPath(linea, cx - ancho / 2, base, q.textSize).toPathData(3));
    });
    grabado.push(`<path id="texto" d="${trozos.join("")}"/>`);
  }

  let corte = `<path id="contorno" d="${rectRedondeado(W, H, q.cornerRadius)}"/>`;
  if (q.holes) {
    const rr = q.holeDiameter / 2;
    const xAg = q.margin * 0.5 + rr;
    corte += `<path id="agujeros" d="${circulo(xAg, H / 2, rr)}${circulo(W - xAg, H / 2, rr)}"/>`;
  }

  const inner =
    `<g id="corte" fill="none" stroke="${cut}" stroke-width="${q.strokeWidth}">${corte}</g>` +
    `<g id="grabado" fill="${q.color}" stroke="none">${grabado.join("")}</g>`;
  return { w: W, h: H, inner };
}

export function envolverSVG(w, h, inner, titulo = "") {
  const t = titulo ? `<title>${titulo.replace(/[<&>]/g, "")}</title>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(w)}mm" height="${r3(h)}mm" viewBox="0 0 ${r3(w)} ${r3(h)}">` +
    t + inner + `</svg>\n`
  );
}

/** Coloca varios carteles en una hoja, en filas, sin pasar del ancho dado. */
export function hoja(cartas, anchoHoja = 300, separacion = 3) {
  let x = 0, y = 0, filaH = 0, maxX = 0;
  const trozos = [];
  for (const c of cartas) {
    if (x > 0 && x + c.w > anchoHoja) { x = 0; y += filaH + separacion; filaH = 0; }
    trozos.push(`<g transform="translate(${r3(x)} ${r3(y)})">${c.inner}</g>`);
    x += c.w + separacion;
    maxX = Math.max(maxX, x - separacion);
    filaH = Math.max(filaH, c.h);
  }
  return { w: maxX, h: y + filaH, inner: trozos.join("") };
}
