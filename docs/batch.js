// Modo por lotes: de un texto grande a una lista de carteles y sus nombres de archivo.

export const SEPARADORES = {
  linea: "linea",   // cada línea = un cartel
  bloque: "bloque", // los carteles se separan con una línea en blanco (cada cartel puede tener varias líneas)
};

/**
 * Parte el texto del lote en carteles.
 * Devuelve [{ numero, texto, picto? }] (numero empieza en 1).
 * Si un cartel lleva «|», lo que va detrás es el pictograma que se quiere:
 * una palabra a buscar («Levantarse | despertarse») o un número de pictograma
 * de ARASAAC con almohadilla («Levantarse | #6964»).
 */
export function parsearLote(texto, separador = SEPARADORES.linea) {
  const limpio = texto.replace(/\r\n?/g, "\n");
  let trozos;
  if (separador === SEPARADORES.bloque) {
    trozos = limpio.split(/\n[ \t]*\n+/);
  } else {
    trozos = limpio.split("\n");
  }
  return trozos
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => {
      const corte = t.lastIndexOf("|");
      if (corte < 0) return { texto: t };
      const texto = t.slice(0, corte).trim();
      const picto = t.slice(corte + 1).trim();
      return picto ? { texto, picto } : { texto };
    })
    .filter((it) => it.texto.length > 0)
    .map((it, i) => ({ numero: i + 1, ...it }));
}

/** Interpreta la parte de pictograma de un cartel: { id } o { consulta } (o null si no hay). */
export function interpretarPicto(picto, texto) {
  const p = (picto ?? "").trim();
  if (/^#\d+$/.test(p)) return { id: Number(p.slice(1)) };
  return { consulta: p || texto.split("\n")[0] };
}

/** "¡Feliz cumpleaños, Ana!" -> "feliz-cumpleanos-ana" (para nombres de archivo). */
export function slug(texto, max = 40) {
  const s = texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s || "cartel";
}

/**
 * Nombres de archivo únicos y ordenados: "01-hola.stl", "02-adios.stl"…
 * El prefijo numérico evita duplicados y mantiene el orden del lote.
 */
export function nombresArchivo(items) {
  const ancho = String(items.length).length;
  return items.map((it) => `${String(it.numero).padStart(Math.max(2, ancho), "0")}-${slug(it.texto.split("\n")[0])}.stl`);
}
