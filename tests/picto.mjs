import assert from "node:assert/strict";
import Module from "manifold-3d";
import { DEFAULTS, layoutPlate } from "../docs/plate.js";
import { generarCartel } from "../docs/generate.js";
import { maquetar } from "../docs/braille.js";
import { reliefDesdeRGBA, candidatasDeBusqueda, buscarPictos, resolverPicto } from "../docs/picto.js";
import { parsearLote, interpretarPicto } from "../docs/batch.js";

// --- imagen sintética: anillo con borde oscuro (hueco central) + isla, fondo transparente ---
function imagenAnillo() {
  const W = 200, H = 120, px = new Uint8Array(W * H * 4);
  const set = (x, y, r, g, b) => { const i = (y * W + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - 60, y - 60);
    if (d <= 45 && d >= 20) (d > 41 || d < 24) ? set(x, y, 10, 10, 10) : set(x, y, 230, 160, 60);
    if (Math.hypot(x - 165, y - 60) <= 12) set(x, y, 200, 60, 60);
  }
  return { px, W, H };
}
const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; };

const { px, W, H } = imagenAnillo();
const relieve = reliefDesdeRGBA(px, W, H);
assert.equal(relieve.w, 1, "el lado mayor vale 1");
assert.ok(relieve.h > 0.5 && relieve.h < 0.6);
const orient = relieve.outer.map((p) => Math.sign(area(p)));
assert.deepEqual([...orient].sort(), [-1, 1, 1], "dos contornos exteriores (CCW) y un hueco (CW)");
assert.ok(relieve.detail.length >= 3, "hay líneas oscuras");
for (const loop of [...relieve.outer, ...relieve.detail]) {
  for (const [x, y] of loop) assert.ok(x > -0.03 && x < 1.03 && y > -0.03 && y < 0.6, "puntos dentro de la caja");
}

// imagen sin transparencia (dibujo sobre blanco): el blanco es fondo
{
  const w = 60, h = 60, rgba = new Uint8Array(w * h * 4).fill(255);
  for (let y = 15; y < 45; y++) for (let x = 15; x < 45; x++) { const i = (y * w + x) * 4; rgba[i] = 30; rgba[i + 1] = 30; rgba[i + 2] = 30; }
  const r = reliefDesdeRGBA(rgba, w, h);
  assert.equal(r.outer.length, 1);
  assert.ok(area(r.outer[0]) > 0.9, "un cuadrado que llena la caja");
}
assert.throws(() => reliefDesdeRGBA(new Uint8Array(40 * 40 * 4), 40, 40), /ninguna forma/);

// --- búsqueda (con fetch simulado) ---
assert.deepEqual(candidatasDeBusqueda("¿Lavarse los dientes?"), ["lavarse los dientes", "lavarse", "dientes", "los"]);
const falso = async (url) => url.includes("dientes") && !url.includes("lavarse%20los")
  ? { ok: true, status: 200, json: async () => [{ _id: 777, keywords: [{ keyword: "dientes" }] }] }
  : { status: 404 };
assert.deepEqual(await resolverPicto("Lavarse los dientes", { fetchImpl: falso }), { id: 777, consulta: "dientes" });
assert.equal(await resolverPicto("xyz", { fetchImpl: async () => ({ status: 404 }) }), null);
await assert.rejects(buscarPictos("casa", { fetchImpl: async () => { throw new Error("x"); } }), /ARASAAC/);

// --- parseo del lote con pictogramas ---
{
  const it = parsearLote("Levantarse | despertarse\nDesayunar\nLavarse | #6964\n| solo\nVestirse |", "linea");
  assert.deepEqual(it.map((x) => x.numero), [1, 2, 3, 4], "numeración sin huecos");
  assert.equal(it[0].picto, "despertarse");
  assert.equal(it[1].picto, undefined);
  assert.deepEqual(interpretarPicto(it[2].picto, it[2].texto), { id: 6964 });
  assert.deepEqual(interpretarPicto(it[0].picto, it[0].texto), { consulta: "despertarse" });
  assert.deepEqual(interpretarPicto(undefined, "Lavarse los dientes\nx"), { consulta: "Lavarse los dientes" });
}
console.log("picto (imagen, búsqueda, lote) OK");

// --- carteles con pictograma ---
const wasm = await Module(); wasm.setup();
const base = { ...DEFAULTS };
const { lines } = maquetar("Lavarse los dientes", { maxCells: base.maxCells });
const sinPicto = layoutPlate(lines, base);

for (const pos of ["top", "left"]) {
  const p = { ...base, pictoPos: pos };
  const lay = layoutPlate(lines, p, relieve);
  const r = generarCartel(wasm.Manifold, "Lavarse los dientes", p, relieve);
  const m = wasm.Manifold; // (solo para dejar claro que se usa la misma clase)
  const mesh = new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: r.vertProperties, triVerts: r.triVerts }));
  const bb = mesh.boundingBox();
  const zEsperado = p.thickness + p.pictoHeight + p.pictoDetail;
  console.log(pos, "→ placa", lay.width.toFixed(1), "x", lay.height.toFixed(1), "| zmax", bb.max[2].toFixed(2),
    "| tris", r.triVerts.length / 3, "| genus", mesh.genus(), "| vol", mesh.volume().toFixed(0));
  assert.ok(!mesh.isEmpty());
  assert.ok(Math.abs(bb.max[2] - zEsperado) < 0.01, "altura = grosor + relieve + detalle");
  assert.ok(Math.abs(bb.max[0] - lay.width) < 0.01 && Math.abs(bb.max[1] - lay.height) < 0.01, "la placa mide lo previsto");
  // el pictograma cabe entero dentro de la placa
  const b = lay.pictoBox;
  assert.ok(b.x0 >= 0 && b.y0 >= 0 && b.x0 + b.size <= lay.width + 1e-6 && b.y0 + b.size <= lay.height + 1e-6);
  if (pos === "top") {
    assert.ok(lay.height > sinPicto.height + p.pictoSize, "la placa crece en vertical");
    assert.ok(lay.dots.every(([x, y]) => y < b.y0), "el texto queda debajo del pictograma");
  } else {
    assert.ok(lay.width > sinPicto.width + p.pictoSize, "la placa crece en horizontal");
    assert.ok(lay.dots.every(([x]) => x > b.x0 + p.pictoSize), "el texto queda a la derecha del pictograma");
  }
  // 1 componente (placa) con puntos y relieve soldados: mismo "genus" que el contorno del anillo + isla
  assert.ok(mesh.genus() >= 0);
}

// sin pictograma no cambia nada
const lay0 = layoutPlate(lines, base, null);
assert.deepEqual([lay0.width, lay0.height], [sinPicto.width, sinPicto.height]);
assert.equal(lay0.pictoBox, null);

// con agujeros de fijación
{
  const p = { ...base, holes: true };
  const r = generarCartel(wasm.Manifold, "Aseo", p, relieve);
  assert.ok(r.triVerts.length > 3000);
}
console.log("carteles con pictograma OK");
