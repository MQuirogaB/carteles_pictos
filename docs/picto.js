// Pictogramas para los carteles: búsqueda en ARASAAC y conversión de una imagen
// (PNG con fondo transparente, o dibujo sobre fondo blanco) en polígonos de
// relieve listos para extruir.
//
// Pictogramas: ARASAAC (https://arasaac.org). Propiedad del Gobierno de Aragón,
// autoría de Sergio Palao. Licencia CC BY-NC-SA 4.0: uso no comercial, citando
// la fuente y compartiendo las adaptaciones con la misma licencia.

export const ARASAAC = {
  api: "https://api.arasaac.org/v1/pictograms",
  lang: "es",
  imagen: (id, size = 500) => `https://static.arasaac.org/pictograms/${id}/${id}_${size}.png`,
};

export const ATRIBUCION =
  "Pictogramas: ARASAAC (https://arasaac.org), propiedad del Gobierno de Aragón y autoría de " +
  "Sergio Palao, bajo licencia CC BY-NC-SA 4.0 (uso no comercial, citando la fuente y " +
  "compartiendo las adaptaciones con la misma licencia).";

// ---------------------------------------------------------------------
// Búsqueda en ARASAAC
// ---------------------------------------------------------------------

/** Busca pictogramas por palabra. Devuelve [{ id, palabra }] (vacío si no hay). */
export async function buscarPictos(consulta, { fetchImpl = globalThis.fetch, max = 24 } = {}) {
  const q = String(consulta ?? "").trim();
  if (!q) return [];
  let res;
  try {
    res = await fetchImpl(`${ARASAAC.api}/${ARASAAC.lang}/bestsearch/${encodeURIComponent(q)}`);
  } catch (err) {
    throw new Error("no se pudo contactar con ARASAAC (¿sin conexión?)");
  }
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`ARASAAC respondió con error ${res.status}`);
  const datos = await res.json();
  if (!Array.isArray(datos)) return [];
  return datos.slice(0, max).map((d) => ({
    id: d._id,
    palabra: d.keywords?.[0]?.keyword ?? String(d._id),
  }));
}

/** Palabras candidatas para buscar un pictograma a partir de un texto. */
export function candidatasDeBusqueda(texto) {
  const limpio = String(texto ?? "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:()"“”«»0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpio) return [];
  const palabras = [...new Set(limpio.split(" ").filter((w) => w.length > 2))]
    .sort((a, b) => b.length - a.length);
  return [...new Set([limpio, ...palabras])];
}

/**
 * Elige un pictograma para un texto: prueba la frase entera y, si no hay
 * resultados, cada palabra (de la más larga a la más corta).
 * Devuelve { id, consulta } o null.
 */
export async function resolverPicto(texto, opciones = {}) {
  for (const consulta of candidatasDeBusqueda(texto)) {
    const res = await buscarPictos(consulta, { ...opciones, max: 1 });
    if (res.length) return { id: res[0].id, consulta };
  }
  return null;
}

// ---------------------------------------------------------------------
// Imagen → relieve (sin dependencias del navegador: se prueba en Node)
// ---------------------------------------------------------------------

/**
 * Convierte píxeles RGBA en polígonos de relieve.
 *  - silueta: píxeles opacos (o, si la imagen no tiene transparencia, todo lo
 *    que no sea casi blanco).
 *  - detalle: líneas oscuras dentro de la silueta, engrosadas un poco para que
 *    la boquilla las pueda imprimir.
 * Devuelve { w, h, outer, detail }: la figura cabe en un cuadrado de lado 1
 * (w y h ≤ 1, el mayor vale 1) y los polígonos están en esas unidades,
 * con el origen abajo a la izquierda y Y hacia arriba. Los contornos exteriores
 * van en sentido antihorario y los huecos en horario.
 */
export function reliefDesdeRGBA(rgba, w, h, o = {}) {
  const N = o.resolucion ?? 256;      // celdas en la dimensión mayor
  const blanco = o.blanco ?? 235;     // por encima = fondo (imágenes sin transparencia)
  const oscuro = o.oscuro ?? 90;      // por debajo = línea oscura
  const engrosar = o.engrosar ?? 0.008; // radio de engrosado, fracción del tamaño

  let hayAlfa = false;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) { hayAlfa = true; break; }

  const fg = new Uint8Array(w * h);
  const dk = new Uint8Array(w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = rgba[i + 3];
      const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      const esFigura = a >= 128 && (hayAlfa || lum < blanco);
      if (!esFigura) continue;
      fg[y * w + x] = 1;
      if (lum < oscuro) dk[y * w + x] = 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error("la imagen no tiene ninguna forma visible");

  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const escala = N / Math.max(bw, bh);
  const gw = Math.max(1, Math.round(bw * escala));
  const gh = Math.max(1, Math.round(bh * escala));
  const G = Math.max(gw, gh);
  const r = Math.max(1, Math.round(engrosar * N));
  const pad = r + 2;              // borde vacío: el engrosado no debe tocar el límite
  const PW = gw + 2 * pad, PH = gh + 2 * pad;

  // cobertura (0..1) de cada celda de la rejilla, con Y hacia arriba
  const cobertura = (mask) => {
    const f = new Float32Array(PW * PH);
    for (let gy = 0; gy < gh; gy++) {
      const ys = y0 + gy / escala, ye = y0 + (gy + 1) / escala;
      const pyA = Math.floor(ys), pyB = Math.max(pyA + 1, Math.ceil(ye));
      for (let gx = 0; gx < gw; gx++) {
        const xs = x0 + gx / escala, xe = x0 + (gx + 1) / escala;
        const pxA = Math.floor(xs), pxB = Math.max(pxA + 1, Math.ceil(xe));
        let suma = 0, cuenta = 0;
        for (let py = pyA; py < pyB && py < h; py++) {
          for (let px = pxA; px < pxB && px < w; px++) { suma += mask[py * w + px]; cuenta++; }
        }
        f[(gh - 1 - gy + pad) * PW + (gx + pad)] = cuenta ? suma / cuenta : 0;
      }
    }
    return f;
  };

  const silueta = dilatar(cobertura(fg), PW, PH, r);
  const detalleBruto = dilatar(cobertura(dk), PW, PH, r);
  const detalle = detalleBruto.map((v, i) => Math.min(v, silueta[i]));

  const aUnidades = (loops) => loops.map((loop) => loop.map(([x, y]) => [(x - pad) / G, (y - pad) / G]));
  const eps = 0.35;
  return {
    w: gw / G,
    h: gh / G,
    outer: aUnidades(contornos(silueta, PW, PH, 0.5, eps)),
    detail: aUnidades(contornos(detalle, PW, PH, 0.5, eps)),
  };
}

/** Dilatación (máximo en un disco de radio r celdas). */
export function dilatar(f, W, H, r) {
  const offs = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) offs.push([dx, dy]);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (const [dx, dy] of offs) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const v = f[yy * W + xx];
        if (v > m) { m = v; if (m >= 1) break; }
      }
      out[y * W + x] = m;
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Marching squares → contornos cerrados
// ---------------------------------------------------------------------

/**
 * Contornos del campo `f` (W×H, Y hacia arriba) al nivel `nivel`.
 * Con "dentro" a la izquierda de cada segmento: los exteriores salen
 * antihorarios y los huecos horarios. Se simplifican con tolerancia `eps`
 * (en celdas).
 */
export function contornos(f, W, H, nivel = 0.5, eps = 0.35) {
  const dentro = (x, y) => f[y * W + x] >= nivel;
  const val = (x, y) => f[y * W + x];

  // punto de cruce en la arista horizontal (x,y)-(x+1,y) o vertical (x,y)-(x,y+1)
  const ptoH = (x, y) => {
    const a = val(x, y), b = val(x + 1, y);
    return [x + (nivel - a) / (b - a), y];
  };
  const ptoV = (x, y) => {
    const a = val(x, y), b = val(x, y + 1);
    return [x, y + (nivel - a) / (b - a)];
  };
  const kH = (x, y) => `h${x},${y}`;
  const kV = (x, y) => `v${x},${y}`;

  const sig = new Map();   // clave de arista de salida -> clave de arista de llegada
  const pos = new Map();   // clave -> punto
  const seg = (ka, pa, kb, pb) => { sig.set(ka, kb); pos.set(ka, pa); pos.set(kb, pb); };

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const bl = dentro(x, y), br = dentro(x + 1, y), tr = dentro(x + 1, y + 1), tl = dentro(x, y + 1);
      const caso = (bl ? 1 : 0) | (br ? 2 : 0) | (tr ? 4 : 0) | (tl ? 8 : 0);
      if (caso === 0 || caso === 15) continue;

      const Bt = [kH(x, y), () => ptoH(x, y)];
      const Tp = [kH(x, y + 1), () => ptoH(x, y + 1)];
      const L = [kV(x, y), () => ptoV(x, y)];
      const R = [kV(x + 1, y), () => ptoV(x + 1, y)];
      const link = (a, b) => seg(a[0], a[1](), b[0], b[1]());

      switch (caso) {
        case 1: link(Bt, L); break;
        case 2: link(R, Bt); break;
        case 3: link(R, L); break;
        case 4: link(Tp, R); break;
        case 5: {
          const centroDentro = (val(x, y) + val(x + 1, y) + val(x + 1, y + 1) + val(x, y + 1)) / 4 >= nivel;
          if (centroDentro) { link(Bt, R); link(Tp, L); } else { link(Bt, L); link(Tp, R); }
          break;
        }
        case 6: link(Tp, Bt); break;
        case 7: link(Tp, L); break;
        case 8: link(L, Tp); break;
        case 9: link(Bt, Tp); break;
        case 10: {
          const centroDentro = (val(x, y) + val(x + 1, y) + val(x + 1, y + 1) + val(x, y + 1)) / 4 >= nivel;
          if (centroDentro) { link(L, Bt); link(R, Tp); } else { link(R, Bt); link(L, Tp); }
          break;
        }
        case 11: link(R, Tp); break;
        case 12: link(L, R); break;
        case 13: link(Bt, R); break;
        case 14: link(L, Bt); break;
        default: break;
      }
    }
  }

  const visto = new Set();
  const lazos = [];
  for (const inicio of sig.keys()) {
    if (visto.has(inicio)) continue;
    const lazo = [];
    let k = inicio;
    while (!visto.has(k) && sig.has(k)) {
      visto.add(k);
      lazo.push(pos.get(k));
      k = sig.get(k);
    }
    if (k !== inicio || lazo.length < 3) continue; // lazo no cerrado: se descarta
    const simple = simplificarCerrado(lazo, eps);
    if (simple.length >= 3 && Math.abs(area(simple)) > 2) lazos.push(simple);
  }
  return lazos;
}

function area(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distSeg(pts[i], pts[0], pts[pts.length - 1]);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [pts[0], pts[pts.length - 1]];
  const a = rdp(pts.slice(0, idx + 1), eps);
  const b = rdp(pts.slice(idx), eps);
  return a.slice(0, -1).concat(b);
}

function simplificarCerrado(lazo, eps) {
  if (eps <= 0) return lazo;
  let lejos = 0, dmax = -1;
  for (let i = 1; i < lazo.length; i++) {
    const d = Math.hypot(lazo[i][0] - lazo[0][0], lazo[i][1] - lazo[0][1]);
    if (d > dmax) { dmax = d; lejos = i; }
  }
  const a = rdp(lazo.slice(0, lejos + 1), eps);
  const b = rdp(lazo.slice(lejos).concat([lazo[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

// ---------------------------------------------------------------------
// Carga de imágenes (solo navegador)
// ---------------------------------------------------------------------

const cacheRelieves = new Map();

function cargarImagen(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("no se pudo cargar la imagen del pictograma"));
    img.src = src;
  });
}

function reliefDeImagen(img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  let datos;
  try {
    datos = ctx.getImageData(0, 0, w, h);
  } catch (err) {
    throw new Error("el navegador no deja leer el pictograma de ARASAAC desde esta página; usa «tu propia imagen»");
  }
  return reliefDesdeRGBA(datos.data, w, h);
}

/** Relieve de un pictograma de ARASAAC por su id (con caché). */
export async function reliefDeArasaac(id) {
  const clave = `arasaac:${id}`;
  if (!cacheRelieves.has(clave)) {
    const img = await cargarImagen(ARASAAC.imagen(id, 500));
    cacheRelieves.set(clave, reliefDeImagen(img));
  }
  return cacheRelieves.get(clave);
}

/** Relieve de un archivo de imagen subido por la persona usuaria. */
export async function reliefDeArchivo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await cargarImagen(url);
    return reliefDeImagen(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}
