import assert from "node:assert/strict";
import fs from "node:fs";
import opentype from "opentype.js";
import { reliefDesdeRGBA, candidatasDeBusqueda, buscarPictos, resolverPicto } from "../docs/picto.js";
import { parsearLote, interpretarPicto, nombresArchivo } from "../docs/batch.js";
import { construirCartel, envolverSVG, medir, hoja } from "../docs/svg.js";

const buf = fs.readFileSync(new URL("../docs/fonts/DejaVuSans-Bold.ttf", import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// imagen sintética: anillo con borde oscuro + isla, fondo transparente
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
const { px, W, H } = imagenAnillo();
const relieve = reliefDesdeRGBA(px, W, H);
assert.equal(relieve.w, 1);
assert.ok(relieve.detail.length >= 3);

// --- búsqueda (fetch simulado) ---
assert.deepEqual(candidatasDeBusqueda("¿Lavarse los dientes?"), ["lavarse los dientes", "lavarse", "dientes", "los"]);
const falso = async (url) => url.includes("dientes") && !url.includes("lavarse%20los")
  ? { ok: true, status: 200, json: async () => [{ _id: 777, keywords: [{ keyword: "dientes" }] }] }
  : { status: 404 };
assert.deepEqual(await resolverPicto("Lavarse los dientes", { fetchImpl: falso }), { id: 777, consulta: "dientes" });
assert.equal(await resolverPicto("xyz", { fetchImpl: async () => ({ status: 404 }) }), null);
await assert.rejects(buscarPictos("casa", { fetchImpl: async () => { throw new Error("x"); } }), /ARASAAC/);
console.log("picto (imagen, búsqueda) OK");

// --- lote ---
{
  const it = parsearLote("Levantarse | despertarse\nDesayunar\nLavarse | #6964\n| solo\nVestirse |", "linea");
  assert.deepEqual(it.map((x) => x.numero), [1, 2, 3, 4]);
  assert.deepEqual(interpretarPicto(it[2].picto, it[2].texto), { id: 6964 });
  assert.deepEqual(nombresArchivo(it).slice(0, 2), ["01-levantarse.svg", "02-desayunar.svg"]);
}
console.log("lote OK");

// --- SVG ---
const bbox = (d) => { const n = [...d.matchAll(/-?\d+\.?\d*/g)].map(Number); return n.length; };
const base = construirCartel(font, "Lavarse los dientes", relieve, { pictoSize: 50 });
const m = medir(font, "Lavarse los dientes", relieve, { pictoSize: 50 });
assert.ok(Math.abs(base.w - m.w) < 1e-9 && Math.abs(base.h - m.h) < 1e-9);
assert.ok(base.w > 50 && base.h > 50 + 9);
for (const id of ["corte", "grabado", "contorno", "pictograma", "texto"]) assert.ok(base.inner.includes(`id="${id}"`), id);
assert.ok(!base.inner.includes("agujeros"));
assert.ok(base.inner.includes('fill="#000000"') && base.inner.includes('stroke="#000000"'), "un solo color");

const color = construirCartel(font, "Hola", relieve, { color: "#ff0000" });
assert.ok(!color.inner.includes("#000000") && color.inner.includes("#ff0000"));
const dos = construirCartel(font, "Hola", relieve, { color: "#00aa00", colorCorte: "#ff0000" });
assert.ok(dos.inner.includes('stroke="#ff0000"') && dos.inner.includes('fill="#00aa00"'));

const sinTexto = construirCartel(font, "Hola", relieve, { mostrarTexto: false });
assert.ok(!sinTexto.inner.includes('id="texto"'));
assert.ok(sinTexto.h < base.h);
const soloTexto = construirCartel(font, "Solo texto", null, {});
assert.ok(!soloTexto.inner.includes('id="pictograma"') && soloTexto.inner.includes('id="texto"'));

const aguj = construirCartel(font, "Hola", relieve, { holes: true });
assert.ok(aguj.inner.includes("agujeros") && aguj.w > construirCartel(font, "Hola", relieve, {}).w);

// estilos de pictograma
const est = Object.fromEntries(["lineas", "silueta", "mixto"].map((s) => [s, construirCartel(font, "x", relieve, { pictoStyle: s }).inner]));
assert.ok(est.mixto.includes("evenodd") && !est.lineas.includes("evenodd"));
assert.notEqual(est.lineas, est.silueta);

// tamaño mínimo (carteles de un lote iguales)
const igual = construirCartel(font, "Hola", relieve, { anchoMin: 120, altoMin: 90 });
assert.equal(igual.w, 120); assert.equal(igual.h, 90);

// todo el trazado cae dentro de la placa
const cr = construirCartel(font, "Dos\nlíneas ñandú", relieve, { holes: true });
const nums = [...cr.inner.matchAll(/ d="([^"]+)"/g)].map((x) => x[1]);
assert.ok(nums.length >= 4);
const svg = envolverSVG(cr.w, cr.h, cr.inner, "Prueba");
assert.match(svg, /^<svg [^>]*width="[\d.]+mm"[^>]*viewBox="0 0 [\d.]+ [\d.]+"/);
assert.ok(!/NaN|undefined|Infinity/.test(svg), "sin valores raros");

// hoja
const h = hoja([base, base, base, base], 200, 3);
assert.ok(h.w <= 200 + 1e-9 && h.h > base.h);
assert.equal((h.inner.match(/translate/g) || []).length, 4);

// escribe ejemplos para revisarlos a ojo
const out = process.env.SVG_OUT;
if (out) {
  fs.writeFileSync(`${out}/uno.svg`, envolverSVG(base.w, base.h, base.inner));
  for (const s of ["lineas", "silueta", "mixto"]) {
    const c = construirCartel(font, "Dos\nlíneas ñandú", relieve, { pictoStyle: s, holes: true, color: "#1a4fb5" });
    fs.writeFileSync(`${out}/${s}.svg`, envolverSVG(c.w, c.h, c.inner));
  }
}
console.log(`cartel SVG OK → ${base.w.toFixed(1)} x ${base.h.toFixed(1)} mm`);
