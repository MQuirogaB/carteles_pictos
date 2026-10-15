import assert from "node:assert/strict";
import Module from "manifold-3d";
import { palabraACeldas, maquetar, lineasAUnicode } from "../docs/braille.js";
import { DEFAULTS, layoutPlate, buildPlate } from "../docs/plate.js";

const uni = (w) => palabraACeldas(w).cells.map((c) => String.fromCodePoint(0x2800 + c.reduce((b, d) => b | 1 << (d - 1), 0))).join("");

// --- braille ---
assert.equal(uni("hola"), "⠓⠕⠇⠁");
assert.equal(uni("Hola"), "⠠⠓⠕⠇⠁");           // mayúscula inicial
assert.equal(uni("ONCE"), "⠠⠠⠕⠝⠉⠑");          // palabra en mayúsculas
assert.equal(uni("2026"), "⠼⠃⠚⠃⠋");           // número
assert.equal(uni("1.250,5"), "⠼⠁⠄⠃⠑⠚⠂⠑");    // miles y decimales dentro del número
assert.equal(uni("año"), "⠁⠻⠕");              // ñ
assert.equal(uni("¿Qué?"), "⠢⠠⠟⠥⠮⠢");          // ¿ ? y é
assert.equal(uni("pingüino"), "⠏⠊⠝⠛⠳⠊⠝⠕");    // ü
assert.deepEqual(palabraACeldas("a€b").unknown, ["€"]);

// --- maquetación ---
let m = maquetar("Hola mundo\nSegunda", { maxCells: 0 });
assert.equal(m.lines.length, 2);
assert.equal(m.lines[0].length, 4 + 1 + 6);
m = maquetar("uno dos tres cuatro", { maxCells: 8 });
assert.ok(m.lines.every((l) => l.length <= 8), "ninguna línea pasa de maxCells");
m = maquetar("supercalifragilistico", { maxCells: 6 });
assert.ok(m.lines.every((l) => l.length <= 6) && m.lines.length >= 4);
console.log("braille OK");
console.log(lineasAUnicode(maquetar("Hola, mundo 2026", { maxCells: 12 }).lines));

// --- geometría con manifold ---
const wasm = await Module(); wasm.setup();
for (const variante of [{}, { holes: true }, { cornerRadius: 0 }]) {
  const p = { ...DEFAULTS, ...variante };
  const { lines } = maquetar("Hola, mundo 2026", { maxCells: p.maxCells });
  const lay = layoutPlate(lines, p);
  const { solid, toDelete } = buildPlate(wasm.Manifold, lay, p);
  const vol = solid.volume();
  const genus = solid.genus();
  const mesh = solid.getMesh();
  const bb = solid.boundingBox();
  const plateVol = lay.width * lay.height * p.thickness;
  console.log(JSON.stringify(variante), "→ placa", lay.width.toFixed(1), "x", lay.height.toFixed(1),
    "mm | puntos", lay.dots.length, "| tris", mesh.triVerts.length / 3,
    "| genus", genus, "| zmax", bb.max[2].toFixed(2), "| vol extra", (vol - plateVol * (variante.cornerRadius === 0 ? 1 : 1)).toFixed(1));
  assert.ok(!solid.isEmpty());
  assert.ok(Math.abs(bb.max[2] - (p.thickness + p.dotHeight)) < 0.01, "altura total = grosor + punto");
  assert.equal(genus, p.holes ? 2 : 0, "sin asas inesperadas");
  assert.ok(Math.abs(bb.max[0] - lay.width) < 0.01 && Math.abs(bb.max[1] - lay.height) < 0.01);
  toDelete.forEach((t) => { try { t.delete(); } catch {} });
}
console.log("geometría OK");

// ---------------------------------------------------------------------
// Modo por lotes
// ---------------------------------------------------------------------
import JSZip from "jszip";
import { parsearLote, nombresArchivo, slug } from "../docs/batch.js";
import { generarCartel } from "../docs/generate.js";

// parseo
let it = parsearLote("Aula 1\n\n  Biblioteca  \r\nLab\n", "linea");
assert.deepEqual(it.map((x) => x.texto), ["Aula 1", "Biblioteca", "Lab"]);
assert.deepEqual(it.map((x) => x.numero), [1, 2, 3]);
it = parsearLote("Planta 1\nAula 1\n\nPlanta 2\nAula 2\n\n\nSótano", "bloque");
assert.deepEqual(it.map((x) => x.texto), ["Planta 1\nAula 1", "Planta 2\nAula 2", "Sótano"]);

// nombres de archivo
assert.equal(slug("¡Feliz cumpleaños, Ana!"), "feliz-cumpleanos-ana");
assert.equal(slug("€€€"), "cartel");
const nombres = nombresArchivo(parsearLote("Hola\nHola\nÁrbol", "linea"));
assert.deepEqual(nombres, ["01-hola.stl", "02-hola.stl", "03-arbol.stl"]);
assert.equal(new Set(nombres).size, nombres.length, "nombres únicos aunque el texto se repita");

// lote real con un elemento que no produce puntos
{
  const wasm2 = await Module(); wasm2.setup();
  const p = { ...DEFAULTS };
  const items = parsearLote("Aula 1\nBiblioteca\n€€€\nPlanta 2\nAula 2", "linea").map((x, i) =>
    i === 3 ? { ...x, texto: "Planta 2\nAula 2" } : x);
  const names = nombresArchivo(items);
  const zip = new JSZip();
  const errors = [];
  for (let i = 0; i < items.length; i++) {
    try {
      const r = generarCartel(wasm2.Manifold, items[i].texto, p);
      zip.file(names[i], r.stl);
    } catch (e) { errors.push({ numero: items[i].numero, error: e.message }); }
  }
  assert.equal(errors.length, 1);
  assert.equal(errors[0].numero, 3);
  assert.match(errors[0].error, /ningún punto/);

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const back = await JSZip.loadAsync(buf);
  const ficheros = Object.keys(back.files).sort();
  assert.deepEqual(ficheros, ["01-aula-1.stl", "02-biblioteca.stl", "04-planta-2.stl", "05-aula-2.stl"]);
  for (const f of ficheros) {
    const data = await back.files[f].async("nodebuffer");
    const tris = data.readUInt32LE(80);
    assert.equal(data.length, 84 + tris * 50, `STL ${f}: tamaño coherente con su cabecera`);
    assert.ok(tris > 1000, `STL ${f} tiene geometría`);
  }
  // el cartel de dos líneas es más alto que el de una
  const a = await back.files["01-aula-1.stl"].async("nodebuffer");
  const b = await back.files["04-planta-2.stl"].async("nodebuffer");
  assert.ok(b.length > a.length);
  console.log("lote OK →", ficheros.join(", "), "| error esperado en cartel 3:", errors[0].error);
}
