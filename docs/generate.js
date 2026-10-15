// Generación de UN cartel a partir de texto + parámetros, sin interfaz.
// La usan la página (modo simple y modo por lotes) y los tests de Node.

import { maquetar } from "./braille.js";
import { layoutPlate, buildPlate } from "./plate.js";
import { buildBinarySTL } from "./stl.js";

/** Maqueta el texto y dice si hay algún punto que imprimir. */
export function prepararCartel(texto, p) {
  const { lines, unknown } = maquetar(texto, { maxCells: p.maxCells });
  const hasDots = lines.some((l) => l.some((c) => c.length > 0));
  return { lines, unknown, hasDots };
}

/**
 * Genera la malla del cartel. `M` es la clase Manifold.
 * Devuelve copias independientes de la malla (se pueden usar después de liberar
 * la memoria de manifold) y el STL ya construido.
 * `picto` es opcional: el relieve de un pictograma (ver picto.js).
 * Lanza un Error si el texto no produce ningún punto.
 */
export function generarCartel(M, texto, p, picto = null) {
  const { lines, unknown, hasDots } = prepararCartel(texto, p);
  if (!hasDots) throw new Error("el texto no produce ningún punto braille");

  const layout = layoutPlate(lines, p, picto);
  const built = buildPlate(M, layout, p, picto);
  try {
    const mesh = built.solid.getMesh();
    const vertProperties = mesh.vertProperties.slice();
    const triVerts = mesh.triVerts.slice();
    return {
      layout, unknown, lines, vertProperties, triVerts,
      stl: buildBinarySTL(vertProperties, triVerts),
    };
  } finally {
    for (const m of built.toDelete) {
      try { m.delete(); } catch (_) { /* ya liberado */ }
    }
  }
}
