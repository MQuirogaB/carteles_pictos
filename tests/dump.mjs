import { maquetar } from "../docs/braille.js";
import { DEFAULTS, layoutPlate } from "../docs/plate.js";
const txt = process.argv[2] ?? "Hola, mundo 2026";
const p = { ...DEFAULTS, holes: true };
const { lines } = maquetar(txt, { maxCells: p.maxCells });
console.log(JSON.stringify({ lay: layoutPlate(lines, p), p }));
