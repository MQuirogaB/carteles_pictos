// Texto -> celdas braille (español, grado 1) y maquetación en líneas.
// Módulo puro, sin dependencias: se usa en el navegador y en los tests de Node.
//
// Una celda es un array de números de punto (1..6):
//   1 4
//   2 5
//   3 6

const SIGNO_MAYUSCULA = [6];
const SIGNO_NUMERO = [3, 4, 5, 6];

// Letras (minúsculas, con acentos, ñ y ü)
const LETRAS = {
  a: [1], b: [1, 2], c: [1, 4], d: [1, 4, 5], e: [1, 5],
  f: [1, 2, 4], g: [1, 2, 4, 5], h: [1, 2, 5], i: [2, 4], j: [2, 4, 5],
  k: [1, 3], l: [1, 2, 3], m: [1, 3, 4], n: [1, 3, 4, 5], o: [1, 3, 5],
  p: [1, 2, 3, 4], q: [1, 2, 3, 4, 5], r: [1, 2, 3, 5], s: [2, 3, 4], t: [2, 3, 4, 5],
  u: [1, 3, 6], v: [1, 2, 3, 6], w: [2, 4, 5, 6], x: [1, 3, 4, 6], y: [1, 3, 4, 5, 6], z: [1, 3, 5, 6],
  "ñ": [1, 2, 4, 5, 6],
  "á": [1, 2, 3, 5, 6], "é": [2, 3, 4, 6], "í": [3, 4], "ó": [3, 4, 6], "ú": [2, 3, 4, 5, 6],
  "ü": [1, 2, 5, 6],
};

// Los dígitos usan las celdas de a..j detrás del signo de número
const DIGITOS = {
  "1": LETRAS.a, "2": LETRAS.b, "3": LETRAS.c, "4": LETRAS.d, "5": LETRAS.e,
  "6": LETRAS.f, "7": LETRAS.g, "8": LETRAS.h, "9": LETRAS.i, "0": LETRAS.j,
};

// Puntuación habitual en braille español
const PUNTUACION = {
  ",": [2], ";": [2, 3], ":": [2, 5], ".": [3],
  "¿": [2, 6], "?": [2, 6], "¡": [2, 3, 5], "!": [2, 3, 5],
  "-": [3, 6], "(": [2, 3, 6], ")": [3, 5, 6],
  '"': [2, 3, 5, 6], "«": [2, 3, 5, 6], "»": [2, 3, 5, 6],
  "'": [3], "/": [3, 4], "+": [2, 3, 5], "=": [2, 3, 5, 6], "*": [3, 5],
};

const ES_DIGITO = (c) => c >= "0" && c <= "9";
const ES_MINUSCULA = (c) => c in LETRAS;
const ES_MAYUSCULA = (c) => {
  const l = c.toLowerCase();
  return l !== c && l in LETRAS;
};
const ES_LETRA = (c) => ES_MINUSCULA(c) || ES_MAYUSCULA(c);

/**
 * Convierte UNA palabra (sin espacios) en una lista de celdas.
 * Devuelve { cells, unknown } donde unknown son los caracteres sin equivalente.
 */
export function palabraACeldas(palabra) {
  const cells = [];
  const unknown = [];
  const chars = Array.from(palabra.normalize("NFC"));

  // Palabra entera en mayúsculas (2+ letras): signo doble una sola vez
  const letras = chars.filter(ES_LETRA);
  const todaMayus = letras.length >= 2 && letras.every(ES_MAYUSCULA);
  if (todaMayus) cells.push(SIGNO_MAYUSCULA, SIGNO_MAYUSCULA); // dos celdas ⠠⠠

  let enNumero = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (ES_DIGITO(c)) {
      if (!enNumero) { cells.push(SIGNO_NUMERO); enNumero = true; }
      cells.push(DIGITOS[c]);
      continue;
    }
    // Separador decimal/miles dentro de un número (seguido de dígito)
    if (enNumero && (c === "." || c === ",") && ES_DIGITO(chars[i + 1] ?? "")) {
      cells.push(PUNTUACION[c]);
      continue;
    }
    enNumero = false;

    if (ES_LETRA(c)) {
      if (ES_MAYUSCULA(c) && !todaMayus) cells.push(SIGNO_MAYUSCULA);
      cells.push(LETRAS[c.toLowerCase()]);
    } else if (c in PUNTUACION) {
      cells.push(PUNTUACION[c]);
    } else {
      unknown.push(c);
    }
  }
  return { cells, unknown };
}

/**
 * Maqueta el texto en líneas de celdas.
 * - Respeta los saltos de línea del usuario.
 * - Si maxCells > 0, parte las líneas por palabras sin pasar de maxCells
 *   (una palabra más larga que maxCells se corta).
 * - Un espacio = celda vacía ([]).
 *
 * Devuelve { lines: Array<Array<number[]>>, unknown: string[] }.
 */
export function maquetar(texto, { maxCells = 0 } = {}) {
  const lines = [];
  const unknown = new Set();

  for (const rawLine of texto.replace(/\r\n?/g, "\n").split("\n")) {
    const palabras = rawLine.split(/[ \t]+/).filter((w) => w.length > 0);
    if (palabras.length === 0) { lines.push([]); continue; }

    let actual = [];
    const volcar = () => { lines.push(actual); actual = []; };

    for (const palabra of palabras) {
      const { cells, unknown: u } = palabraACeldas(palabra);
      u.forEach((ch) => unknown.add(ch));
      if (cells.length === 0) continue;

      const sep = actual.length > 0 ? 1 : 0;
      if (maxCells > 0 && actual.length + sep + cells.length > maxCells) {
        if (actual.length > 0) volcar();
        // palabra más larga que la línea: se corta en trozos
        let resto = cells;
        while (maxCells > 0 && resto.length > maxCells) {
          actual = resto.slice(0, maxCells);
          volcar();
          resto = resto.slice(maxCells);
        }
        actual = resto.slice();
      } else {
        if (sep) actual.push([]);
        actual.push(...cells);
      }
    }
    if (actual.length > 0 || lines.length === 0) volcar();
  }

  // quita líneas vacías al final
  while (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
  return { lines, unknown: [...unknown] };
}

/** Representación Unicode (⠁⠃…) de una celda, útil para mostrar/depurar. */
export function celdaAUnicode(cell) {
  let bits = 0;
  for (const d of cell) bits |= 1 << (d - 1);
  return String.fromCodePoint(0x2800 + bits);
}

export function lineasAUnicode(lines) {
  return lines.map((l) => l.map(celdaAUnicode).join("")).join("\n");
}
