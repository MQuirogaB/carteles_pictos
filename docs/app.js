import JSZip from "jszip";
import opentype from "opentype.js";

import { DEFAULTS, construirCartel, envolverSVG, medir, hoja } from "./svg.js?v=3";
import { parsearLote, nombresArchivo, interpretarPicto, slug } from "./batch.js?v=3";
import { ARASAAC, ATRIBUCION, buscarPictos, resolverPicto, reliefDeArasaac, reliefDeArchivo } from "./picto.js?v=3";

// ---------------------------------------------------------------------
// Elementos y estado
// ---------------------------------------------------------------------

const el = (id) => document.getElementById(id);

// Si algo falla al arrancar (por ejemplo, archivos antiguos en la caché del navegador), que se vea.
window.addEventListener("error", (e) => {
  const s = document.getElementById("status");
  if (s) { s.textContent = "Error: " + (e.message || "no se pudo iniciar") + ". Prueba a recargar con Ctrl+Shift+R."; s.classList.add("error"); }
});
const statusEl = el("status");
const generateBtn = el("generate-btn");
const downloadBtn = el("download-btn");
const statsEl = el("stats");
const textoEl = el("texto");
const loteEl = el("lote");
const holder = el("svg-holder");

const NUM_FIELDS = ["pictoSize", "textSize", "margin", "gap", "cornerRadius", "holeDiameter"];
const FONTS = {
  atkinson: { nombre: "Atkinson Hyperlegible (muy legible)", archivo: "atkinson-hyperlegible" },
  lexend: { nombre: "Lexend (lectura fácil)", archivo: "lexend" },
  nunito: { nombre: "Nunito (redondeada)", archivo: "nunito" },
  comic: { nombre: "Comic Neue (informal)", archivo: "comic-neue" },
  dejavu: { nombre: "DejaVu Sans", archivo: "dejavu-sans", ext: "ttf" },
  serif: { nombre: "DejaVu Serif (con serifa)", archivo: "dejavu-serif", ext: "ttf" },
};
const FONT_DEFAULT = "atkinson";
const SHEET_WIDTH = 300;

let mode = "single";           // "single" | "batch"
const fonts = {};              // caché de letras (opentype Font), por clave
let lastSVG = null;            // SVG del cartel en la vista previa (modo simple)
let lastName = "cartel";
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

async function cargarFuente() {
  const id = el("fontFamily").value;
  const f = FONTS[id] || FONTS[FONT_DEFAULT];
  const clave = `${f.archivo}-${el("fontBold").checked ? 700 : 400}`;
  if (!fonts[clave]) {
    const res = await fetch(`./fonts/${clave}.${f.ext || "woff"}`);
    if (!res.ok) throw new Error("no se pudo cargar la letra");
    fonts[clave] = opentype.parse(await res.arrayBuffer());
  }
  return fonts[clave];
}

function rellenarFuentes() {
  const sel = el("fontFamily");
  for (const [id, f] of Object.entries(FONTS)) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = f.nombre;
    sel.append(o);
  }
}

// ---------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------

function applyDefaultsToUI() {
  for (const k of NUM_FIELDS) el(k).value = DEFAULTS[k];
  el("holes").checked = DEFAULTS.holes;
  el("mostrarTexto").checked = DEFAULTS.mostrarTexto;
  el("pictoStyle").value = DEFAULTS.pictoStyle;
  el("fontFamily").value = FONT_DEFAULT;
  el("fontBold").checked = true;
  el("color").value = DEFAULTS.color;
  el("colorCorte").value = "#ff0000";
  el("cutOther").checked = false;
  el("sheetWidth").value = SHEET_WIDTH;
  syncDisabled();
}

function syncDisabled() {
  el("holeDiameter").disabled = !el("holes").checked;
  el("textSize").disabled = !el("mostrarTexto").checked;
  el("fontFamily").disabled = !el("mostrarTexto").checked;
  el("fontBold").disabled = !el("mostrarTexto").checked;
  el("cutColorRow").hidden = !el("cutOther").checked;
}

function readParams() {
  const p = { ...DEFAULTS };
  for (const k of NUM_FIELDS) {
    const v = Number(el(k).value);
    p[k] = Number.isFinite(v) && el(k).value !== "" ? v : DEFAULTS[k];
  }
  p.holes = el("holes").checked;
  p.mostrarTexto = el("mostrarTexto").checked;
  p.pictoStyle = el("pictoStyle").value;
  p.color = el("color").value || DEFAULTS.color;
  p.colorCorte = el("cutOther").checked ? el("colorCorte").value : null;
  return p;
}

// ---------------------------------------------------------------------
// Pictogramas (ARASAAC o imagen propia)
// ---------------------------------------------------------------------

const pictoMsg = el("picto-msg");
const pictoResults = el("picto-results");

const firstLine = (t) => (t || "").split("\n")[0].trim();
const pictoSingleOn = () => mode === "single" && el("picto-on").checked;
const pictoBatchOn = () => mode === "batch" && el("batch-picto-on").checked;

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
  pictoMsg.textContent = "Preparando el dibujo…";
  try {
    const relief = await reliefDeArasaac(it.id);
    pictoSel = { id: it.id, nombre: it.palabra || `#${it.id}`, relief };
    pictoMsg.textContent = `Seleccionado: ${pictoSel.nombre} (#${it.id})`;
  } catch (err) {
    pictoSel = null;
    pictoMsg.textContent = err?.message || String(err);
  }
  scheduleGenerate();
}

async function subirImagen(file) {
  if (!file) return;
  pictoMsg.textContent = "Preparando el dibujo…";
  for (const b of pictoResults.children) b.classList.remove("sel");
  try {
    const relief = await reliefDeArchivo(file);
    pictoSel = { id: null, nombre: file.name, relief };
    pictoMsg.textContent = `Imagen propia: ${file.name}`;
  } catch (err) {
    pictoSel = null;
    pictoMsg.textContent = err?.message || String(err);
  }
  scheduleGenerate();
}

function syncPictoUI() {
  el("picto-panel").hidden = !el("picto-on").checked;
  el("batch-picto-help").hidden = !el("batch-picto-on").checked;
}

/** Resuelve (con caché) el pictograma de un cartel del lote. */
async function resolverDeItem(it) {
  const spec = interpretarPicto(it.picto, it.texto);
  let id = spec.id ?? null;
  if (id == null) {
    if (!resueltos.has(spec.consulta)) resueltos.set(spec.consulta, await resolverPicto(spec.consulta));
    id = resueltos.get(spec.consulta)?.id ?? null;
  }
  if (id == null) return { id: null, consulta: spec.consulta, relief: null };
  return { id, consulta: spec.consulta, relief: await reliefDeArasaac(id) };
}

// ---------------------------------------------------------------------
// Textos del modo actual y avisos
// ---------------------------------------------------------------------

const batchItems = () => parsearLote(loteEl.value, el("separator").value);

function previewIndex(items) {
  const n = Math.floor(Number(el("previewIndex").value)) || 1;
  return Math.min(Math.max(1, n), Math.max(1, items.length));
}

function refreshTexts() {
  if (mode === "single") return;

  const items = batchItems();
  const countEl = el("batch-count");
  countEl.textContent = items.length
    ? `Se generará${items.length === 1 ? "" : "n"} ${items.length} cartel${items.length === 1 ? "" : "es"}`
    : "Escribe al menos un texto";
  countEl.classList.toggle("on", items.length > 0);

  const large = items.length > 50;
  el("batch-large").hidden = !large;
  if (large) {
    el("batch-large-text").textContent =
      `Estás a punto de generar ${items.length} carteles. Si hay pictogramas, cada uno se descarga de ARASAAC: puede tardar un rato.`;
  }

  el("preview-row").hidden = items.length === 0;
  if (items.length) {
    const idx = previewIndex(items);
    el("previewIndex").max = String(items.length);
    el("preview-text").textContent = items[idx - 1].texto.split("\n").join(" ⏎ ");
  }
  generateBtn.textContent = `Generar todo (${items.length})`;
  generateBtn.disabled = items.length === 0 || batchRunning;
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
  generateBtn.hidden = batch && el("batch-setup").hidden;
  if (!batch) {
    generateBtn.textContent = "Actualizar vista previa";
    generateBtn.disabled = false;
  }
  refreshTexts();
  scheduleGenerate();
}

// ---------------------------------------------------------------------
// Vista previa
// ---------------------------------------------------------------------

function luminancia(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function mostrar(svgString, w, h, p) {
  holder.innerHTML = svgString;
  const claro = luminancia(p.color) > 0.8 && (!p.colorCorte || luminancia(p.colorCorte) > 0.8);
  holder.classList.toggle("oscuro", claro);
  statsEl.textContent = `${w.toFixed(1)} × ${h.toFixed(1)} mm`;
}

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
  if (lastSVG) saveBlob(new Blob([lastSVG], { type: "image/svg+xml" }), `${lastName}.svg`);
});

let previewBusy = false;
let previewPending = false;

async function generatePreview() {
  if (batchRunning) return;
  if (previewBusy) { previewPending = true; return; }
  previewBusy = true;

  try {
    const p = readParams();
    const font = await cargarFuente();
    let texto = "";
    let picto = null;
    let aviso = "";
    const thumb = el("preview-picto-img");

    if (mode === "single") {
      texto = textoEl.value;
      thumb.hidden = true;
      if (pictoSingleOn()) {
        picto = pictoSel?.relief ?? null;
        if (!picto) aviso = " Aún no hay pictograma elegido.";
      }
    } else {
      const items = batchItems();
      if (!items.length) { holder.replaceChildren(); statsEl.textContent = ""; setStatus("Escribe al menos un texto."); return; }
      const it = items[previewIndex(items) - 1];
      texto = it.texto;
      thumb.hidden = true;
      if (pictoBatchOn()) {
        setStatus("Buscando el pictograma…");
        try {
          const rp = await resolverDeItem(it);
          picto = rp.relief;
          if (rp.id != null) {
            thumb.src = ARASAAC.imagen(rp.id, 300);
            thumb.alt = `Pictograma ${rp.id}`;
            thumb.title = `#${rp.id} · ${rp.consulta}`;
            thumb.hidden = false;
          } else {
            aviso = ` Sin pictograma para «${rp.consulta}».`;
          }
        } catch (err) {
          aviso = ` Pictograma no disponible (${err?.message || err}).`;
        }
      }
    }

    const hayTexto = p.mostrarTexto && texto.trim().length > 0;
    if (!picto && !hayTexto) {
      holder.replaceChildren();
      statsEl.textContent = "";
      lastSVG = null;
      downloadBtn.disabled = true;
      setStatus("Elige un pictograma o escribe algún texto para ver el cartel." );
      return;
    }

    const c = construirCartel(font, texto, picto, p);
    const svg = envolverSVG(c.w, c.h, c.inner, firstLine(texto));
    mostrar(svg, c.w, c.h, p);
    lastSVG = svg;
    lastName = slug(firstLine(texto));
    downloadBtn.disabled = false;
    setStatus((mode === "batch"
      ? "Vista previa lista. Pulsa «Generar todo» para crear el ZIP."
      : "Listo. Puedes descargar el SVG.") + aviso);
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
  debounce = setTimeout(generatePreview, 300);
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

function listaAviso(kind, icon, titulo, lineas) {
  const strong = document.createElement("strong");
  strong.textContent = titulo;
  const ul = document.createElement("ul");
  for (const t of lineas.slice(0, 10)) {
    const li = document.createElement("li");
    li.textContent = t;
    ul.append(li);
  }
  if (lineas.length > 10) {
    const li = document.createElement("li");
    li.textContent = `… y ${lineas.length - 10} más`;
    ul.append(li);
  }
  return notice(kind, icon, [strong, ul]);
}

function renderBatchResults({ okCount, total, errors, aborted, avisos }) {
  const host = el("batch-results");
  host.replaceChildren();
  if (aborted) host.append(notice("warning", "⏹", [document.createTextNode(`Lote abortado: se generaron ${okCount} de ${total} carteles.`)]));
  if (okCount > 0) {
    host.append(notice("success", "✅", [document.createTextNode(
      `¡Se generaron ${okCount} cartel${okCount === 1 ? "" : "es"} correctamente! El ZIP incluye cada SVG por separado y «hoja.svg» con todos juntos.`)]));
  }
  if (avisos.length) host.append(listaAviso("warning", "⚠️", `Pictogramas: ${avisos.length} aviso${avisos.length === 1 ? "" : "s"}`, avisos));
  if (errors.length) {
    host.append(listaAviso("danger", "❌", `No se pudieron generar ${errors.length} cartel${errors.length === 1 ? "" : "es"}`,
      errors.map((e) => `Cartel ${e.numero} («${e.texto.split("\n")[0].slice(0, 40)}»): ${e.error}`)));
  }
  el("batch-zip").hidden = okCount === 0;
}

const csvEscape = (s) => `"${String(s).replace(/"/g, '""')}"`;

async function runBatch() {
  if (batchRunning) return;
  const items = batchItems();
  if (!items.length) return;

  const p = readParams();
  const conPicto = el("batch-picto-on").checked;
  const mismoTam = el("batch-same").checked;
  const anchoHoja = Math.max(50, Number(el("sheetWidth").value) || SHEET_WIDTH);
  const names = nombresArchivo(items);
  const errors = [];
  const avisos = [];

  batchRunning = true;
  batchAbort = false;
  batchZip = null;
  clearTimeout(debounce);
  showBatchView("progress");
  setProgress(0, items.length, "");
  setStatus("");

  let font;
  try { font = await cargarFuente(); }
  catch (err) {
    batchRunning = false;
    showBatchView("setup");
    setStatus("No se pudo cargar la letra: " + (err?.message || err), true);
    return;
  }

  // 1) pictogramas de todos los carteles
  const datos = [];
  for (let i = 0; i < items.length; i++) {
    if (batchAbort) break;
    const it = items[i];
    setProgress(i, items.length, `buscando: ${firstLine(it.texto)}`);
    await nextFrame();
    let relief = null, id = null;
    if (conPicto) {
      try {
        const rp = await resolverDeItem(it);
        relief = rp.relief; id = rp.id;
        if (rp.id == null) avisos.push(`Cartel ${it.numero}: no hay pictograma para «${rp.consulta}» (se genera sin él).`);
      } catch (err) {
        avisos.push(`Cartel ${it.numero}: pictograma no disponible (${err?.message || err}); se genera sin él.`);
      }
    }
    datos.push({ it, relief, id });
  }

  // 2) tamaño común (si se pide)
  let pp = p;
  if (mismoTam && datos.length) {
    let w = 0, h = 0;
    for (const d of datos) {
      const m = medir(font, d.it.texto, d.relief, p);
      w = Math.max(w, m.w); h = Math.max(h, m.h);
    }
    pp = { ...p, anchoMin: w, altoMin: h };
  }

  // 3) cartel a cartel
  const zip = new JSZip();
  const cartas = [];
  const filas = [["numero", "archivo", "texto", "pictograma"].map(csvEscape).join(";")];
  let okCount = 0;
  let usados = 0;
  for (let i = 0; i < datos.length; i++) {
    if (batchAbort) break;
    const { it, relief, id } = datos[i];
    setProgress(i, items.length, names[i]);
    await nextFrame();
    try {
      const c = construirCartel(font, it.texto, relief, pp);
      zip.file(names[i], envolverSVG(c.w, c.h, c.inner, firstLine(it.texto)));
      cartas.push(c);
      filas.push([it.numero, names[i], it.texto.replace(/\n/g, " / "), id != null ? `#${id}` : ""].map(csvEscape).join(";"));
      if (id != null) usados++;
      okCount++;
    } catch (err) {
      console.error(err);
      errors.push({ numero: it.numero, texto: it.texto, error: err?.message || String(err) });
    }
  }

  const aborted = batchAbort;
  if (okCount > 0) {
    const h = hoja(cartas, anchoHoja);
    zip.file("hoja.svg", envolverSVG(h.w, h.h, h.inner, "Hoja con todos los carteles"));
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
    saveBlob(blob, "carteles-pictos.zip");
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
for (const k of ["pictoStyle", "color", "colorCorte"]) el(k).addEventListener("input", onInput);
el("fontFamily").addEventListener("change", () => { syncDisabled(); onInput(); });
el("fontBold").addEventListener("change", onInput);
for (const k of ["holes", "mostrarTexto", "cutOther"]) el(k).addEventListener("change", () => { syncDisabled(); onInput(); });
el("reset-btn").addEventListener("click", () => { applyDefaultsToUI(); onInput(); });

el("picto-on").addEventListener("change", () => { syncPictoUI(); onInput(); });
el("batch-picto-on").addEventListener("change", () => { syncPictoUI(); onInput(); });
el("picto-search").addEventListener("click", buscarEnUI);
el("picto-q").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); buscarEnUI(); } });
el("picto-file").addEventListener("change", (e) => subirImagen(e.target.files?.[0]));

el("tab-single").addEventListener("click", () => setMode("single"));
el("tab-batch").addEventListener("click", () => setMode("batch"));

generateBtn.addEventListener("click", () => {
  if (mode === "batch") runBatch();
  else generatePreview();
});

rellenarFuentes();
applyDefaultsToUI();
syncPictoUI();
refreshTexts();

(async () => {
  try {
    await cargarFuente();
    setStatus("Listo.");
    // búsqueda inicial con la primera línea del texto
    el("picto-q").value = firstLine(textoEl.value);
    if (el("picto-q").value) buscarEnUI();
    generatePreview();
  } catch (err) {
    console.error(err);
    setStatus("No se pudo cargar la letra: " + (err?.message || err), true);
  }
})();
