import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import ManifoldModule from "manifold-3d";
import JSZip from "jszip";

import { lineasAUnicode } from "./braille.js";
import { DEFAULTS } from "./plate.js";
import { prepararCartel, generarCartel } from "./generate.js";
import { parsearLote, nombresArchivo, interpretarPicto } from "./batch.js";
import { ARASAAC, ATRIBUCION, buscarPictos, resolverPicto, reliefDeArasaac, reliefDeArchivo } from "./picto.js";

// ---------------------------------------------------------------------
// Elementos y estado
// ---------------------------------------------------------------------

const el = (id) => document.getElementById(id);
const statusEl = el("status");
const generateBtn = el("generate-btn");
const downloadBtn = el("download-btn");
const statsEl = el("stats");
const textoEl = el("texto");
const loteEl = el("lote");
const previewEl = el("braille-preview");
const warnEl = el("warn");

const NUM_FIELDS = [
  "maxCells", "thickness", "margin", "cornerRadius", "holeDiameter",
  "dotDiameter", "dotHeight", "dotSpacing", "cellSpacing", "lineSpacing",
  "pictoSize", "pictoHeight", "pictoDetail",
];

let mode = "single";           // "single" | "batch"
let ManifoldCls = null;
let lastSTL = null;            // STL del cartel en la vista previa (modo simple)
let batchRunning = false;
let batchAbort = false;
let batchZip = null;           // { zip, okCount }
let pictoSel = null;           // modo simple: { id?, nombre, relief }
const resueltos = new Map();   // consulta -> { id, consulta } | null (caché del lote)

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------

function syncHoleField() { el("holeDiameter").disabled = !el("holes").checked; }

function applyDefaultsToUI() {
  for (const k of NUM_FIELDS) el(k).value = DEFAULTS[k];
  el("holes").checked = DEFAULTS.holes;
  el("pictoPos").value = DEFAULTS.pictoPos;
  syncHoleField();
}

function readParams() {
  const p = { ...DEFAULTS };
  for (const k of NUM_FIELDS) {
    const v = Number(el(k).value);
    p[k] = Number.isFinite(v) ? v : DEFAULTS[k];
  }
  p.holes = el("holes").checked;
  p.pictoPos = el("pictoPos").value === "left" ? "left" : "top";
  p.pictoSize = Math.max(10, p.pictoSize);
  p.pictoHeight = Math.max(0.4, p.pictoHeight);
  p.pictoDetail = Math.max(0, p.pictoDetail);
  // límites de seguridad para no generar mallas rotas
  p.dotDiameter = Math.max(0.5, p.dotDiameter);
  p.dotHeight = Math.max(0.2, Math.min(p.dotHeight, p.dotDiameter));
  p.thickness = Math.max(0.6, p.thickness);
  p.maxCells = Math.max(0, Math.floor(p.maxCells));
  return p;
}

// ---------------------------------------------------------------------
// Textos del modo actual
// ---------------------------------------------------------------------

function batchItems() {
  return parsearLote(loteEl.value, el("separator").value);
}

function previewIndex(items) {
  const n = Math.floor(Number(el("previewIndex").value)) || 1;
  return Math.min(Math.max(1, n), Math.max(1, items.length));
}

/** Texto que se muestra en la vista previa 3D según el modo. */
function currentPreviewText() {
  if (mode === "single") return textoEl.value;
  const items = batchItems();
  return items.length ? items[previewIndex(items) - 1].texto : "";
}

// ---------------------------------------------------------------------
// Interfaz: vista braille, avisos y contadores
// ---------------------------------------------------------------------

function refreshTexts() {
  const p = readParams();

  if (mode === "single") {
    const { lines, unknown } = prepararCartel(textoEl.value, p);
    const unicode = lineasAUnicode(lines);
    previewEl.textContent = unicode.trim() ? unicode : "—";
    warnEl.textContent = unknown.length ? `Sin equivalente braille (se omiten): ${unknown.join(" ")}` : "";
    return;
  }

  const items = batchItems();
  const countEl = el("batch-count");
  countEl.textContent = items.length
    ? `Se generará${items.length === 1 ? "" : "n"} ${items.length} cartel${items.length === 1 ? "" : "es"}`
    : "Escribe al menos un texto";
  countEl.classList.toggle("on", items.length > 0);

  const unknown = new Set();
  for (const it of items) prepararCartel(it.texto, p).unknown.forEach((c) => unknown.add(c));
  el("batch-warn").textContent = unknown.size
    ? `Sin equivalente braille (se omiten): ${[...unknown].join(" ")}`
    : "";

  const large = items.length > 50;
  el("batch-large").hidden = !large;
  if (large) {
    el("batch-large-text").textContent =
      `Estás a punto de generar ${items.length} carteles. Esto puede tardar un rato y usar bastante memoria. Considera dividirlo en lotes más pequeños si tienes problemas.`;
  }

  const previewRow = el("preview-row");
  previewRow.hidden = items.length === 0;
  if (items.length) {
    const idx = previewIndex(items);
    el("previewIndex").max = String(items.length);
    el("preview-text").textContent = items[idx - 1].texto.split("\n").join(" ⏎ ");
    el("preview-picto-img").hidden = true;
  }
  generateBtn.textContent = `Generar todo (${items.length})`;
  generateBtn.disabled = !ManifoldCls || items.length === 0 || batchRunning;
}

function setMode(next) {
  if (batchRunning) return;
  mode = next;
  const batch = mode === "batch";
  el("tab-single").classList.toggle("active", !batch);
  el("tab-batch").classList.toggle("active", batch);
  el("tab-single").setAttribute("aria-selected", String(!batch));
  el("tab-batch").setAttribute("aria-selected", String(batch));
  el("mode-single").hidden = batch;
  el("mode-batch").hidden = !batch;
  downloadBtn.hidden = batch;
  el("preview-row").hidden = !batch;
  generateBtn.hidden = batch && el("batch-setup").hidden; // en resultados/progreso no se ve
  if (!batch) {
    generateBtn.textContent = "Generar cartel";
    generateBtn.disabled = !ManifoldCls;
  }
  refreshTexts();
  scheduleGenerate();
}

// ---------------------------------------------------------------------
// Three.js
// ---------------------------------------------------------------------

const holder = el("canvas-holder");
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 4000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0); // el degradado lo pone el CSS
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
holder.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a96, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 1.7);
key.position.set(40, 120, 90);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.5);
fill.position.set(-80, 40, -30);
scene.add(fill);

// Placa en violeta y puntos en ámbar (solo en la vista previa; el STL es una sola pieza)
const plateMaterial = new THREE.MeshStandardMaterial({ color: 0x9a6bb4, roughness: 0.6, metalness: 0.03 });
const dotMaterial = new THREE.MeshStandardMaterial({ color: 0xe8a838, roughness: 0.45, metalness: 0.03 });

// El modelo está en XY (Z arriba); lo giramos para que Z quede arriba en pantalla.
const displayGroup = new THREE.Group();
displayGroup.rotation.x = -Math.PI / 2;
scene.add(displayGroup);

let currentMesh = null;

function resizeRenderer() {
  const w = holder.clientWidth, h = holder.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resizeRenderer);
resizeRenderer();

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();

function frameCamera(width, height, thickness) {
  displayGroup.position.set(-width / 2, 0, height / 2);
  controls.target.set(0, thickness / 2, 0);
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const dist = Math.max(height / 2 / Math.tan(vFov / 2), width / 2 / Math.tan(hFov / 2)) * 1.25 + 10;
  camera.position.set(0, dist * 0.82, dist * 0.57);
  camera.updateProjectionMatrix();
}

function showPreview(vertProperties, triVerts, thickness) {
  if (currentMesh) {
    displayGroup.remove(currentMesh);
    currentMesh.geometry.dispose();
  }

  // Un triángulo es "de punto" si alguno de sus vértices queda por encima de la placa
  const eps = 1e-3;
  const plateIdx = [];
  const dotIdx = [];
  for (let t = 0; t < triVerts.length; t += 3) {
    const a = triVerts[t], b = triVerts[t + 1], c = triVerts[t + 2];
    const esPunto =
      vertProperties[a * 3 + 2] > thickness + eps ||
      vertProperties[b * 3 + 2] > thickness + eps ||
      vertProperties[c * 3 + 2] > thickness + eps;
    (esPunto ? dotIdx : plateIdx).push(a, b, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertProperties, 3));
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from([...plateIdx, ...dotIdx]), 1));
  geometry.addGroup(0, plateIdx.length, 0);
  geometry.addGroup(plateIdx.length, dotIdx.length, 1);
  geometry.computeVertexNormals();
  currentMesh = new THREE.Mesh(geometry, [plateMaterial, dotMaterial]);
  displayGroup.add(currentMesh);
}

// ---------------------------------------------------------------------
// Descargas
// ---------------------------------------------------------------------

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

downloadBtn.addEventListener("click", () => {
  if (lastSTL) saveBlob(new Blob([lastSTL], { type: "model/stl" }), "cartel-pictos.stl");
});

// ---------------------------------------------------------------------
// Pictogramas (ARASAAC o imagen propia)
// ---------------------------------------------------------------------

const pictoMsg = el("picto-msg");
const pictoResults = el("picto-results");

function firstLine(t) { return (t || "").split("\n")[0].trim(); }

function pictoSingleOn() { return mode === "single" && el("picto-on").checked; }
function pictoBatchOn() { return mode === "batch" && el("batch-picto-on").checked; }

async function buscarEnUI() {
  const q = el("picto-q").value.trim();
  if (!q) { pictoMsg.textContent = "Escribe una palabra para buscar."; return; }
  pictoMsg.textContent = "Buscando…";
  pictoResults.replaceChildren();
  try {
    const lista = await buscarPictos(q);
    if (!lista.length) { pictoMsg.textContent = `No hay pictogramas para «${q}». Prueba con otra palabra (mejor en singular o infinitivo).`; return; }
    pictoMsg.textContent = "Elige uno:";
    for (const it of lista) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "picto-opt";
      b.dataset.id = String(it.id);
      b.title = it.palabra || "";
      const img = document.createElement("img");
      img.src = ARASAAC.imagen(it.id, 300);
      img.alt = "";
      img.loading = "lazy";
      const lab = document.createElement("span");
      lab.textContent = it.palabra || `#${it.id}`;
      b.append(img, lab);
      b.addEventListener("click", () => elegirPicto(it, b));
      pictoResults.append(b);
    }
  } catch (err) {
    pictoMsg.textContent = (err?.message || err) + ". Puedes usar tu propia imagen en su lugar.";
  }
}

async function elegirPicto(it, btn) {
  for (const b of pictoResults.children) b.classList.toggle("sel", b === btn);
  pictoMsg.textContent = "Preparando el relieve…";
  try {
    const relief = await reliefDeArasaac(it.id);
    pictoSel = { id: it.id, nombre: it.palabra || `#${it.id}`, relief };
    pictoMsg.textContent = `Seleccionado: ${pictoSel.nombre} (#${it.id})`;
  } catch (err) {
    pictoSel = null;
    pictoMsg.textContent = (err?.message || err);
  }
  scheduleGenerate();
}

async function subirImagen(file) {
  if (!file) return;
  pictoMsg.textContent = "Preparando el relieve…";
  for (const b of pictoResults.children) b.classList.remove("sel");
  try {
    const relief = await reliefDeArchivo(file);
    pictoSel = { id: null, nombre: file.name, relief };
    pictoMsg.textContent = `Imagen propia: ${file.name}`;
  } catch (err) {
    pictoSel = null;
    pictoMsg.textContent = (err?.message || err);
  }
  scheduleGenerate();
}

function syncPictoUI() {
  el("picto-panel").hidden = !el("picto-on").checked;
  el("batch-picto-help").hidden = !el("batch-picto-on").checked;
}

/** Resuelve (con caché) el pictograma de un cartel del lote. null si no hay. */
async function resolverDeItem(it) {
  const spec = interpretarPicto(it.picto, it.texto);
  const id = spec.id ?? (await (async () => {
    const clave = spec.consulta;
    if (!resueltos.has(clave)) resueltos.set(clave, await resolverPicto(clave));
    return resueltos.get(clave)?.id ?? null;
  })());
  if (id == null) return { id: null, consulta: spec.consulta, relief: null };
  return { id, consulta: spec.consulta, relief: await reliefDeArasaac(id) };
}

// ---------------------------------------------------------------------
// Vista previa (un cartel, o el cartel elegido del lote)
// ---------------------------------------------------------------------

let previewBusy = false;
let previewPending = false;

async function generatePreview() {
  if (!ManifoldCls || batchRunning) return;
  if (previewBusy) { previewPending = true; return; }
  previewBusy = true;

  try {
    const p = readParams();
    const texto = currentPreviewText();
    if (!prepararCartel(texto, p).hasDots) {
      setStatus(mode === "batch" ? "El cartel elegido no produce ningún punto braille." : "Escribe algún texto para generar el cartel.");
      downloadBtn.disabled = true;
      lastSTL = null;
      return;
    }
    setStatus("Construyendo la placa y los puntos…");
    await nextFrame();

    let picto = null;
    let aviso = "";
    const thumb = el("preview-picto-img");
    if (pictoSingleOn()) {
      picto = pictoSel?.relief ?? null;
      if (!picto) aviso = " (aún sin pictograma elegido)";
    } else if (pictoBatchOn()) {
      const items = batchItems();
      const it = items[previewIndex(items) - 1];
      try {
        const rp = await resolverDeItem(it);
        picto = rp.relief;
        thumb.hidden = rp.id == null;
        if (rp.id != null) {
          thumb.src = ARASAAC.imagen(rp.id, 300);
          thumb.alt = `Pictograma ${rp.id}`;
          thumb.title = `#${rp.id} · ${rp.consulta}`;
        } else {
          aviso = ` (sin pictograma para «${rp.consulta}»)`;
        }
      } catch (err) {
        thumb.hidden = true;
        aviso = ` (pictograma no disponible: ${err?.message || err})`;
      }
    } else {
      thumb.hidden = true;
    }

    const r = generarCartel(ManifoldCls, texto, p, picto);
    showPreview(r.vertProperties, r.triVerts, p.thickness);
    frameCamera(r.layout.width, r.layout.height, p.thickness);
    lastSTL = r.stl;
    downloadBtn.disabled = false;

    statsEl.innerHTML =
      `${r.layout.width.toFixed(1)} × ${r.layout.height.toFixed(1)} × ${(p.thickness + Math.max(p.dotHeight, picto ? p.pictoHeight + p.pictoDetail : 0)).toFixed(1)} mm<br>` +
      `${r.layout.dots.length} puntos · ${(r.triVerts.length / 3).toLocaleString("es-ES")} triángulos`;
    setStatus((mode === "batch"
      ? "Vista previa lista. Pulsa «Generar todo» para crear el ZIP."
      : "Listo. Puedes rotar la vista y descargar el STL.") + aviso);
  } catch (err) {
    console.error(err);
    setStatus("Error al generar: " + (err?.message || err), true);
  } finally {
    previewBusy = false;
    if (previewPending) { previewPending = false; generatePreview(); }
  }
}

let debounce = null;
function scheduleGenerate() {
  clearTimeout(debounce);
  debounce = setTimeout(generatePreview, 450);
}

// ---------------------------------------------------------------------
// Modo por lotes
// ---------------------------------------------------------------------

function showBatchView(view) { // "setup" | "progress" | "results"
  el("batch-setup").hidden = view !== "setup";
  el("batch-progress-card").hidden = view !== "progress";
  el("batch-results-card").hidden = view !== "results";
  generateBtn.hidden = view !== "setup";
}

function setProgress(done, total, currentLabel) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  el("bp-percent").textContent = `${pct} %`;
  el("bp-bar").style.width = `${pct}%`;
  el("bp-bar-wrap").setAttribute("aria-valuenow", String(pct));
  el("bp-count").textContent = `${done} de ${total} carteles`;
  el("bp-current").textContent = "";
  if (currentLabel) {
    el("bp-current").append("Ahora: ");
    const code = document.createElement("code");
    code.textContent = currentLabel;
    el("bp-current").append(code);
  }
}

function notice(kind, icon, children) {
  const box = document.createElement("div");
  box.className = `notice ${kind}`;
  const ic = document.createElement("span");
  ic.textContent = icon;
  const body = document.createElement("div");
  body.append(...children);
  box.append(ic, body);
  return box;
}

function renderBatchResults({ okCount, total, errors, aborted, avisos = [] }) {
  const host = el("batch-results");
  host.replaceChildren();

  if (aborted) {
    host.append(notice("warning", "⏹", [document.createTextNode(`Lote abortado: se generaron ${okCount} de ${total} carteles.`)]));
  }
  if (okCount > 0) {
    host.append(notice("success", "✅", [document.createTextNode(
      `¡Se generaron ${okCount} cartel${okCount === 1 ? "" : "es"} correctamente!`)]));
  }
  if (avisos.length) {
    const strong = document.createElement("strong");
    strong.textContent = `Pictogramas: ${avisos.length} aviso${avisos.length === 1 ? "" : "s"}`;
    const ul = document.createElement("ul");
    for (const a of avisos.slice(0, 10)) {
      const li = document.createElement("li");
      li.textContent = a;
      ul.append(li);
    }
    if (avisos.length > 10) {
      const li = document.createElement("li");
      li.textContent = `… y ${avisos.length - 10} más`;
      ul.append(li);
    }
    host.append(notice("warning", "⚠️", [strong, ul]));
  }
  if (errors.length) {
    const strong = document.createElement("strong");
    strong.textContent = `No se pudieron generar ${errors.length} cartel${errors.length === 1 ? "" : "es"}`;
    const ul = document.createElement("ul");
    for (const e of errors.slice(0, 10)) {
      const li = document.createElement("li");
      li.textContent = `Cartel ${e.numero} («${e.texto.split("\n")[0].slice(0, 40)}»): ${e.error}`;
      ul.append(li);
    }
    if (errors.length > 10) {
      const li = document.createElement("li");
      li.textContent = `… y ${errors.length - 10} más`;
      ul.append(li);
    }
    host.append(notice("danger", "❌", [strong, ul]));
  }
  el("batch-zip").hidden = okCount === 0;
}

function csvEscape(s) { return `"${String(s).replace(/"/g, '""')}"`; }

async function runBatch() {
  if (!ManifoldCls || batchRunning) return;
  const items = batchItems();
  if (!items.length) return;

  const p = readParams();
  const names = nombresArchivo(items);
  const zip = new JSZip();
  const errors = [];
  const conPicto = el("batch-picto-on").checked;
  const cols = ["numero", "archivo", "texto", "braille"];
  if (conPicto) cols.push("pictograma");
  const filas = [cols.map(csvEscape).join(";")];
  const avisos = [];
  let usados = 0;
  let okCount = 0;

  batchRunning = true;
  batchAbort = false;
  batchZip = null;
  clearTimeout(debounce);
  showBatchView("progress");
  setProgress(0, items.length, "");
  setStatus("");

  for (let i = 0; i < items.length; i++) {
    if (batchAbort) break;
    const it = items[i];
    setProgress(i, items.length, names[i]);
    await nextFrame();

    try {
      let relief = null;
      let pictoTxt = "";
      if (conPicto) {
        try {
          const rp = await resolverDeItem(it);
          relief = rp.relief;
          if (rp.id != null) { pictoTxt = `#${rp.id}`; usados++; }
          else avisos.push(`Cartel ${it.numero}: no hay pictograma para «${rp.consulta}» (se genera sin él).`);
        } catch (err) {
          avisos.push(`Cartel ${it.numero}: pictograma no disponible (${err?.message || err}); se genera sin él.`);
        }
      }
      const r = generarCartel(ManifoldCls, it.texto, p, relief);
      zip.file(names[i], r.stl);
      const fila = [it.numero, names[i], it.texto.replace(/\n/g, " / "), lineasAUnicode(r.lines).replace(/\n/g, " / ")];
      if (conPicto) fila.push(pictoTxt);
      filas.push(fila.map(csvEscape).join(";"));
      okCount++;
    } catch (err) {
      console.error(err);
      errors.push({ numero: it.numero, texto: it.texto, error: err?.message || String(err) });
    }
  }

  const aborted = batchAbort;
  if (okCount > 0) {
    // BOM para que Excel abra bien los acentos y los puntos braille
    zip.file("lista.csv", "﻿" + filas.join("\r\n") + "\r\n");
    if (usados > 0) zip.file("LICENCIA-ARASAAC.txt", ATRIBUCION + "\r\n");
    batchZip = { zip, okCount };
  }
  setProgress(aborted ? okCount + errors.length : items.length, items.length, "");
  batchRunning = false;

  renderBatchResults({ okCount, total: items.length, errors, aborted, avisos });
  showBatchView("results");
}

el("batch-abort").addEventListener("click", () => {
  batchAbort = true;
  el("bp-current").textContent = "Abortando…";
});

el("batch-zip").addEventListener("click", async () => {
  if (!batchZip) return;
  const btn = el("batch-zip");
  btn.disabled = true;
  try {
    const blob = await batchZip.zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    saveBlob(blob, "carteles-braille.zip");
  } catch (err) {
    console.error(err);
    setStatus("No se pudo crear el ZIP: " + (err?.message || err), true);
  } finally {
    btn.disabled = false;
  }
});

el("batch-new").addEventListener("click", () => {
  batchZip = null;
  showBatchView("setup");
  refreshTexts();
  scheduleGenerate();
});

// ---------------------------------------------------------------------
// Eventos y arranque
// ---------------------------------------------------------------------

function onInput() { refreshTexts(); scheduleGenerate(); }

textoEl.addEventListener("input", onInput);
loteEl.addEventListener("input", onInput);
el("separator").addEventListener("change", onInput);
el("previewIndex").addEventListener("input", onInput);
for (const k of NUM_FIELDS) el(k).addEventListener("input", onInput);
el("pictoPos").addEventListener("change", onInput);

el("picto-on").addEventListener("change", () => {
  syncPictoUI();
  if (el("picto-on").checked && !el("picto-q").value.trim()) {
    el("picto-q").value = firstLine(textoEl.value);
    if (el("picto-q").value) buscarEnUI();
  }
  onInput();
});
el("batch-picto-on").addEventListener("change", () => { syncPictoUI(); onInput(); });
el("picto-search").addEventListener("click", buscarEnUI);
el("picto-q").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); buscarEnUI(); } });
el("picto-file").addEventListener("change", (e) => subirImagen(e.target.files?.[0]));

el("holes").addEventListener("change", () => { syncHoleField(); onInput(); });
el("reset-btn").addEventListener("click", () => { applyDefaultsToUI(); onInput(); });

el("tab-single").addEventListener("click", () => setMode("single"));
el("tab-batch").addEventListener("click", () => setMode("batch"));

generateBtn.addEventListener("click", () => {
  if (mode === "batch") runBatch();
  else generatePreview();
});

applyDefaultsToUI();
refreshTexts();

(async () => {
  try {
    setStatus("Cargando el motor 3D (WASM)…");
    const wasm = await ManifoldModule();
    wasm.setup();
    ManifoldCls = wasm.Manifold;
    generateBtn.disabled = mode === "batch" ? batchItems().length === 0 : false;
    setStatus("Listo.");
    generatePreview();
  } catch (err) {
    console.error(err);
    setStatus("No se pudo cargar el motor 3D: " + (err?.message || err), true);
  }
})();
