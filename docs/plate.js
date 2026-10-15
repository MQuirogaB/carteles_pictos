// Geometría de la placa braille: medidas, posiciones de los puntos y
// construcción del sólido con manifold-3d.
//
// Sistema de coordenadas (mm): X a la derecha, Y hacia arriba, Z hacia arriba.
// La placa ocupa X 0..ancho, Y 0..alto, Z 0..grosor. Los puntos sobresalen
// por la cara superior (Z = grosor).

// Valores por defecto: braille "Marburg Medium", el estándar habitual para
// impresión 3D y rotulación (punto 1,5 mm, separación 2,5 mm, celda 6 mm,
// línea 10 mm).
export const DEFAULTS = {
  dotDiameter: 1.5,   // diámetro de la base del punto
  dotHeight: 0.6,     // altura del punto sobre la placa
  dotSpacing: 2.5,    // separación entre puntos de una misma celda
  cellSpacing: 6.0,   // distancia entre el inicio de una celda y la siguiente
  lineSpacing: 10.0,  // distancia entre líneas
  margin: 6.0,        // margen alrededor del texto
  thickness: 2.0,     // grosor de la placa
  cornerRadius: 2.0,  // radio de las esquinas (0 = esquinas vivas)
  holes: false,       // dos agujeros de fijación en los lados
  holeDiameter: 3.5,
  maxCells: 12,       // celdas máximas por línea (0 = sin límite)

  // Pictograma opcional (se ignora si el cartel no lleva ninguno)
  pictoSize: 25,      // lado del recuadro del pictograma (mm)
  pictoPos: "top",    // "top" = encima del texto, "left" = a la izquierda
  pictoHeight: 0.8,   // altura del relieve sobre la placa
  pictoDetail: 0.4,   // altura extra de las líneas oscuras (0 = sin detalle)
  pictoGap: 4,        // separación entre el pictograma y el texto
};

const DOT_COL = { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1 };
const DOT_ROW = { 1: 0, 2: 1, 3: 2, 4: 0, 5: 1, 6: 2 };

/**
 * Calcula el tamaño de la placa y la posición (x, y) de cada punto a partir
 * de las líneas de celdas. Si hay `picto` (relieve con { w, h }), reserva un
 * recuadro de pictoSize × pictoSize encima o a la izquierda del texto; el
 * recuadro es fijo para que los carteles de una serie salgan del mismo tamaño.
 */
export function layoutPlate(lines, p, picto = null) {
  const cols = Math.max(1, ...lines.map((l) => l.length));
  const rows = Math.max(1, lines.length);

  const blockW = (cols - 1) * p.cellSpacing + p.dotSpacing;
  const blockH = (rows - 1) * p.lineSpacing + 2 * p.dotSpacing;

  const S = picto ? p.pictoSize : 0;
  const gap = picto ? p.pictoGap : 0;
  const top = p.pictoPos !== "left";

  // contenido = pictograma + texto, colocados según pictoPos
  const innerW = !picto ? blockW : top ? Math.max(blockW, S) : S + gap + blockW;
  const contentH = !picto ? blockH : top ? S + gap + blockH : Math.max(S, blockH);

  const holeSide = p.holes ? p.holeDiameter + 4 : 0; // espacio extra a cada lado
  const marginX = p.margin + holeSide;
  const width = innerW + 2 * marginX;
  let height = contentH + 2 * p.margin;
  if (p.holes) height = Math.max(height, p.holeDiameter + 6);

  // El contenido se centra verticalmente si la placa creció por los agujeros
  const offsetY = (height - (contentH + 2 * p.margin)) / 2;
  const contentTop = height - p.margin - offsetY;

  // origen (esquina superior izquierda) del bloque de texto y del recuadro del picto
  let textX = marginX, textTop = contentTop;
  let slotX = 0, slotTop = 0;
  if (picto && top) {
    slotX = marginX + (innerW - S) / 2;
    slotTop = contentTop;
    textX = marginX + (innerW - blockW) / 2;
    textTop = contentTop - S - gap;
  } else if (picto) {
    slotX = marginX;
    slotTop = contentTop - (contentH - S) / 2;
    textX = marginX + S + gap;
    textTop = contentTop - (contentH - blockH) / 2;
  }

  const dots = [];
  lines.forEach((cells, r) => {
    cells.forEach((cell, c) => {
      for (const d of cell) {
        dots.push([
          textX + c * p.cellSpacing + DOT_COL[d] * p.dotSpacing,
          textTop - r * p.lineSpacing - DOT_ROW[d] * p.dotSpacing,
        ]);
      }
    });
  });

  const holes = p.holes
    ? [2, width - 2].map((edge, i) => [i === 0 ? edge + p.holeDiameter / 2 : edge - p.holeDiameter / 2, height / 2])
    : [];

  // caja del pictograma (esquina inferior izquierda y lado), centrado en su recuadro
  let pictoBox = null;
  if (picto) {
    const pw = S * picto.w, ph = S * picto.h;
    pictoBox = {
      x0: slotX + (S - pw) / 2,
      y0: slotTop - S + (S - ph) / 2,
      size: S,
    };
  }

  return { width, height, dots, holes, cols, rows, pictoBox };
}

/**
 * Construye el sólido (Manifold) de la placa con sus puntos en relieve.
 * `M` es la clase Manifold de manifold-3d. Devuelve { solid, toDelete }.
 */
export function buildPlate(M, layout, p, picto = null) {
  const toDelete = [];
  const track = (m) => { toDelete.push(m); return m; };

  // --- placa (rectángulo con esquinas redondeadas) ---
  const cr = Math.min(p.cornerRadius, layout.width / 2 - 0.01, layout.height / 2 - 0.01);
  let plate;
  if (cr > 0.05) {
    const seg = 32;
    const corners = [
      [cr, cr], [layout.width - cr, cr],
      [cr, layout.height - cr], [layout.width - cr, layout.height - cr],
    ].map(([x, y]) => track(M.cylinder(p.thickness, cr, cr, seg, false).translate([x, y, 0])));
    plate = track(M.hull(corners));
  } else {
    plate = track(M.cube([layout.width, layout.height, p.thickness], false));
  }

  // --- agujeros de fijación ---
  for (const [x, y] of layout.holes) {
    const hole = track(M.cylinder(p.thickness + 2, p.holeDiameter / 2, p.holeDiameter / 2, 40, false).translate([x, y, -1]));
    plate = track(plate.subtract(hole));
  }

  // --- punto: casquete esférico de base `dotDiameter` y altura `dotHeight` ---
  const r = p.dotDiameter / 2;
  const h = p.dotHeight;
  const R = (r * r + h * h) / (2 * h);
  const sphere = track(M.sphere(R, 28));
  const sink = 0.3; // el punto se hunde un poco en la placa para unirse bien
  const dome = track(sphere
    .translate([0, 0, p.thickness + h - R])
    .intersect(track(M.cube([2 * R + 1, 2 * R + 1, h + sink], true).translate([0, 0, p.thickness - sink + (h + sink) / 2]))));

  const parts = [plate];
  for (const [x, y] of layout.dots) parts.push(track(dome.translate([x, y, 0])));

  // --- pictograma en relieve: silueta + líneas oscuras algo más altas ---
  if (picto && layout.pictoBox) {
    const box = layout.pictoBox;
    const aPlaca = (polys) => polys.map((poly) => poly.map(([x, y]) => [box.x0 + x * box.size, box.y0 + y * box.size]));
    const z0 = p.thickness - sink;
    if (picto.outer.length && p.pictoHeight > 0) {
      parts.push(track(M.extrude(aPlaca(picto.outer), p.pictoHeight + sink).translate([0, 0, z0])));
    }
    if (picto.detail.length && p.pictoDetail > 0) {
      parts.push(track(M.extrude(aPlaca(picto.detail), p.pictoHeight + p.pictoDetail + sink).translate([0, 0, z0])));
    }
  }

  const solid = track(M.union(parts));
  return { solid, toDelete };
}
