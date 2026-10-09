// Energiemanagement – Oberfläche (Baukasten-Fläche, Bibliothek, Eigenschaften, Analyse)
'use strict';

const C = window.EM_CATALOG;
const E = window.EM_ENGINE;
const fmt = C.fmt;
const $ = (s, r = document) => r.querySelector(s);
const SVGNS = 'http://www.w3.org/2000/svg';
const ZOOM_BASE = 3; // px pro cm bei 100 %

const state = {
  lib: [], libById: {},
  project: null,
  sel: null, // { kind: 'inst'|'wire', id }
  multiSel: new Set(), // mehrfach ausgewählte Instanz-IDs (im Mehrfachauswahl-Modus), zum gemeinsamen Löschen
  marqueeMode: false, // Umschalter "Mehrfachauswahl" in der Werkzeugleiste
  zoom: ZOOM_BASE, panX: 80, panY: 80,
  analysis: null,
  dirty: false,
  past: [], future: [],
  filter: 'all',
  tab: 'props',
  collapsed: {},
};

// ---------- Hilfen ----------
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
function svg(tag, attrs, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs || {}) if (attrs[k] !== undefined && attrs[k] !== null) {
    if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]);
  }
  for (const c of kids.flat()) if (c) e.append(c);
  return e;
}
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Fehler ' + r.status);
  return d;
}
let toastT;
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('error', Boolean(isErr)); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, isErr ? 5000 : 2200);
}
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = (x) => JSON.parse(JSON.stringify(x));
const productOf = (inst) => state.libById[inst.productId] || inst.product || null;
const cableOf = (w) => state.libById[w.cableId] || w.cable || null;
const typeOf = (inst) => { const p = productOf(inst); return p ? C.types[p.type] : null; };
const instById = (id) => state.project.instances.find((i) => i.id === id);
const wireById = (id) => state.project.wires.find((w) => w.id === id);
const isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;

// ---------- Projekt & Verlauf ----------
function emptyProject() {
  return { id: null, name: '', instances: [], wires: [], settings: { plz: '', coords: '', yieldOverride: '', tMin: -10, autonomy: 2, battPrefStart: 0, battPrefEnd: 24 }, view: {}, notes: '' };
}
function snapshot() { return JSON.stringify({ i: state.project.instances, w: state.project.wires }); }
function commit() {
  state.past.push(state.lastSnap);
  if (state.past.length > 150) state.past.shift();
  state.future = [];
  state.lastSnap = snapshot();
  setDirty(true);
  renderCanvas();
  scheduleAnalysis();
}
function restore(snap) {
  const s = JSON.parse(snap);
  state.project.instances = s.i; state.project.wires = s.w;
  state.lastSnap = snap;
  if (state.sel && !(state.sel.kind === 'inst' ? instById(state.sel.id) : wireById(state.sel.id))) state.sel = null;
  for (const id of state.multiSel) if (!instById(id)) state.multiSel.delete(id);
  setDirty(true); renderCanvas(); renderProps(); scheduleAnalysis();
}
function undo() { if (!state.past.length) return; state.future.push(state.lastSnap); restore(state.past.pop()); }
function redo() { if (!state.future.length) return; state.past.push(state.lastSnap); restore(state.future.pop()); }
function setDirty(d) { state.dirty = d; $('#dirty').hidden = !d; }

function loadProject(p) {
  state.project = Object.assign(emptyProject(), p);
  state.project.settings = Object.assign(emptyProject().settings, p.settings || {});
  state.sel = null; state.multiSel = new Set(); state.past = []; state.future = [];
  state.lastSnap = snapshot();
  const v = p.view || {};
  if (v.zoom) { state.zoom = v.zoom; state.panX = v.panX; state.panY = v.panY; }
  if (v.gridCm) $('#gridCm').value = v.gridCm;
  if (v.snap !== undefined) $('#snapOn').checked = v.snap;
  if (v.gridShow !== undefined) $('#gridShow').checked = v.gridShow;
  $('#projName').value = state.project.name || '';
  setDirty(false);
  renderProjectTab(); renderCanvas(); renderProps(); applyView(); runAnalysis();
  if (!v.zoom && state.project.instances.length) fitView();
}

// Für die Engine/Speicherung: Produktdaten als Kopie mitgeben (falls Bauteil später gelöscht wird)
function projectForSave() {
  const p = clone(state.project);
  p.name = $('#projName').value.trim();
  for (const i of p.instances) { const pr = productOf(i); if (pr) i.product = pr; }
  for (const w of p.wires) { const c = cableOf(w); if (c) w.cable = c; }
  p.view = { zoom: state.zoom, panX: state.panX, panY: state.panY, gridCm: gridCm(), snap: $('#snapOn').checked, gridShow: $('#gridShow').checked };
  return p;
}

async function save(asCopy) {
  const body = projectForSave();
  if (!body.name) { body.name = prompt('Name des Systems:', 'Mein Energiesystem') || ''; if (!body.name) return; $('#projName').value = body.name; }
  if (asCopy) { const n = prompt('Name der Kopie:', body.name + ' (Kopie)'); if (!n) return; body.name = n; $('#projName').value = n; }
  try {
    const saved = state.project.id && !asCopy ? await api('PUT', '/api/projects/' + state.project.id, body) : await api('POST', '/api/projects', body);
    state.project.id = saved.id; state.project.name = saved.name;
    setDirty(false);
    toast(asCopy ? 'Kopie gespeichert' : 'Gespeichert');
  } catch (e) { toast(e.message, true); }
}

function confirmDiscard() { return !state.dirty || confirm('Ungespeicherte Änderungen verwerfen?'); }

// ---------- Bibliothek ----------
async function loadLibrary() {
  state.lib = await api('GET', '/api/library');
  state.libById = {};
  for (const p of state.lib) state.libById[p.id] = p;
  renderLibrary();
}

let libOpen = {};
try { libOpen = JSON.parse(localStorage.getItem('em-lib-open') || '{}') || {}; } catch (e) { libOpen = {}; }
function renderLibrary() {
  const q = $('#libSearch').value.trim().toLowerCase();
  const list = $('#libList');
  const out = [];
  for (const cat of C.CATEGORIES) {
    const items = state.lib.filter((p) => C.types[p.type] && C.types[p.type].cat === cat && (!q || (p.name + ' ' + (p.maker || '') + ' ' + C.types[p.type].label).toLowerCase().includes(q)));
    if (!items.length) continue;
    // Standardmäßig zugeklappt; aufgeklappte Kategorien merkt sich der Browser. Bei einer Suche ist alles offen.
    const open = Boolean(q) || Boolean(libOpen[cat]);
    const types = [...new Set(items.map((p) => p.type))];
    const t0 = C.types[types[0]];
    const box = el('div', { class: 'lib-cat' + (open ? ' open' : '') },
      el('button', { type: 'button', class: 'lib-cat-head', 'aria-expanded': String(open),
        onclick: () => { libOpen[cat] = !libOpen[cat]; try { localStorage.setItem('em-lib-open', JSON.stringify(libOpen)); } catch (e) { /* ohne Speicher */ } renderLibrary(); } },
        el('span', { class: 'cat-ico', text: t0.icon }), el('span', { class: 'cat-name', text: cat }),
        el('span', { class: 'cat-count', text: String(items.length) }), el('span', { class: 'cat-chev', 'aria-hidden': 'true', text: '▸' })));
    box.firstChild.style.setProperty('--cat', t0.color); // per CSSOM, inline-style-Attribute blockiert die CSP
    const body = el('div', { class: 'lib-cat-body' });
    box.append(body);
    if (open) for (const p of items.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }))) {
      const t = C.types[p.type];
      const isCable = Boolean(t.cable);
      const item = el('div', { class: 'lib-item' + (isCable ? ' static' : ''), draggable: isCable ? null : 'true', title: isCable ? 'Kabel werden beim Verbinden gewählt' : 'Auf die Fläche ziehen', 'data-id': p.id },
        el('span', { class: 'ico', text: t.icon }),
        el('div', {}, el('div', { class: 'nm', text: p.name }), el('div', { class: 'sp', text: t.spec(p) })),
        el('div', { class: 'acts' },
          p.url ? el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', title: 'Zum Produkt', text: '↗' }) : null,
          el('button', { type: 'button', title: 'Bearbeiten', text: '✎', onclick: (e) => { e.stopPropagation(); openProductModal(p); } })));
      if (!isCable) {
        item.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', 'product:' + p.id); e.dataTransfer.effectAllowed = 'copy'; });
        item.addEventListener('dblclick', () => {
          const r = $('#canvas').getBoundingClientRect();
          const w = toWorld(r.left + r.width / 2, r.top + r.height / 2);
          addInstance(p, w.x + (state.project.instances.length % 5) * 10, w.y + (state.project.instances.length % 5) * 10);
        });
      }
      body.append(item);
    }
    out.push(box);
  }
  list.replaceChildren(...out);
  if (!out.length) list.append(el('p', { class: 'muted small', text: 'Nichts gefunden.' }));
}

// Bauteil-Editor (Modal)
let pmProduct = null;
function openProductModal(product, presetType) {
  pmProduct = product ? clone(product) : { type: presetType || 'pv' };
  const isNew = !product;
  $('#pmTitle').textContent = isNew ? 'Eigenes Bauteil anlegen' : 'Bauteil bearbeiten';
  $('#pmDelete').hidden = isNew;
  renderProductForm(isNew);
  $('#productModal').hidden = false;
  setTimeout(() => { const f = $('#pmForm input[name=name]'); if (f) f.focus(); }, 30);
}
function renderProductForm(isNew) {
  const p = pmProduct;
  const t = C.types[p.type];
  const form = $('#pmForm');
  const kids = [];
  if (isNew) {
    const sel = el('select', { name: '__type' }, Object.entries(C.types).map(([k, x]) => el('option', { value: k, text: `${x.icon} ${x.label} (${x.cat})`, selected: k === p.type })));
    sel.addEventListener('change', () => { readProductForm(); pmProduct = { ...pmProduct, type: sel.value }; renderProductForm(true); });
    kids.push(el('label', { class: 'full' }, 'Bauteiltyp', sel));
  } else kids.push(el('p', { class: 'full muted', text: `${t.icon} ${t.label}` }));
  const fields = C.common.concat(t.fields, C.tail);
  for (const f of fields) {
    let input;
    const val = p[f.id] !== undefined ? p[f.id] : (isNew && f.def !== undefined ? f.def : '');
    if (f.type === 'select') input = el('select', { name: f.id }, f.options.map((o) => el('option', { value: o.v, text: o.l, selected: String(val) === o.v })));
    else if (f.type === 'textarea') { input = el('textarea', { name: f.id, rows: 3 }); input.value = val; }
    else input = el('input', { name: f.id, type: f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text', step: f.step || 'any', value: val, placeholder: f.type === 'url' ? 'https://…' : null });
    const wrap = f.unit ? el('div', { class: 'unit-wrap' }, input, el('span', { text: f.unit })) : input;
    const full = f.type === 'textarea' || f.type === 'url' || f.id === 'name' || f.id === 'cores';
    kids.push(el('label', { class: full ? 'full' : null }, f.label + (f.required ? ' *' : ''), wrap, f.hint ? el('span', { class: 'hint', text: f.hint }) : null));
  }
  form.replaceChildren(...kids);
}
function readProductForm() {
  for (const inp of $('#pmForm').querySelectorAll('[name]')) if (inp.name !== '__type') pmProduct[inp.name] = inp.value;
}
$('#pmSave').addEventListener('click', async () => {
  readProductForm();
  const t = C.types[pmProduct.type];
  for (const f of C.common.concat(t.fields)) if (f.required && (pmProduct[f.id] === '' || pmProduct[f.id] === undefined)) return toast(`Bitte „${f.label}" ausfüllen`, true);
  if (pmProduct.url && !/^https?:\/\//i.test(pmProduct.url)) return toast('Der Link muss mit http:// oder https:// beginnen', true);
  try {
    const saved = pmProduct.id ? await api('PUT', '/api/library/' + pmProduct.id, pmProduct) : await api('POST', '/api/library', pmProduct);
    $('#productModal').hidden = true;
    await loadLibrary();
    renderCanvas(); renderProps(); runAnalysis();
    toast('Bauteil gespeichert');
    return saved;
  } catch (e) { toast(e.message, true); }
});
$('#pmDelete').addEventListener('click', async () => {
  const used = state.project.instances.some((i) => i.productId === pmProduct.id) || state.project.wires.some((w) => w.cableId === pmProduct.id);
  if (!confirm(`„${pmProduct.name}" aus der Bibliothek löschen?${used ? '\n\nEs wird im aktuellen System verwendet – dort bleibt eine Kopie der Daten erhalten.' : ''}`)) return;
  try {
    // Kopie in der Planung behalten
    const prod = state.libById[pmProduct.id];
    for (const i of state.project.instances) if (i.productId === pmProduct.id) i.product = prod;
    for (const w of state.project.wires) if (w.cableId === pmProduct.id) w.cable = prod;
    await api('DELETE', '/api/library/' + pmProduct.id);
    $('#productModal').hidden = true;
    await loadLibrary(); renderCanvas(); renderProps(); runAnalysis();
    toast('Bauteil gelöscht');
  } catch (e) { toast(e.message, true); }
});
$('#btnNewProduct').addEventListener('click', () => openProductModal(null));
$('#libSearch').addEventListener('input', renderLibrary);
$('#btnRestore').addEventListener('click', async () => {
  try { const r = await api('POST', '/api/library/restore'); await loadLibrary(); toast(r.added ? `${r.added} Standard-Bauteile wiederhergestellt` : 'Alle Standard-Bauteile sind vorhanden'); } catch (e) { toast(e.message, true); }
});
for (const m of document.querySelectorAll('.modal')) {
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.hidden = true; });
}

// ---------- Ansicht / Raster ----------
const gridCm = () => Math.max(1, Math.min(500, Number($('#gridCm').value) || 10));
function applyView() {
  $('#world').setAttribute('transform', `translate(${state.panX} ${state.panY}) scale(${state.zoom})`);
  $('#zoomVal').textContent = Math.round(state.zoom / ZOOM_BASE * 100) + ' %';
  let step = gridCm();
  while (step * state.zoom < 7) step *= 2;
  const pat = $('#dots');
  pat.setAttribute('width', step); pat.setAttribute('height', step);
  $('#dot').setAttribute('r', Math.max(0.4, 1.3 / state.zoom));
  $('#gridRect').style.display = $('#gridShow').checked ? '' : 'none';
}
function toWorld(cx, cy) {
  const r = $('#canvas').getBoundingClientRect();
  return { x: (cx - r.left - state.panX) / state.zoom, y: (cy - r.top - state.panY) / state.zoom };
}
function zoomAt(factor, cx, cy) {
  const r = $('#canvas').getBoundingClientRect();
  if (cx === undefined) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
  const nz = Math.max(0.3, Math.min(25, state.zoom * factor));
  const wx = (cx - r.left - state.panX) / state.zoom, wy = (cy - r.top - state.panY) / state.zoom;
  state.zoom = nz;
  state.panX = cx - r.left - wx * nz; state.panY = cy - r.top - wy * nz;
  applyView();
}
function fitView() {
  const insts = state.project.instances;
  const r = $('#canvas').getBoundingClientRect();
  const pl = state.project.plan && !state.project.plan.hidden ? state.project.plan : null;
  if (!insts.length && !pl) { state.zoom = ZOOM_BASE; state.panX = 80; state.panY = 80; return applyView(); }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  if (pl) { x0 = pl.x; y0 = pl.y; x1 = pl.x + pl.w; y1 = pl.y + pl.h; }
  for (const i of insts) { const t = typeOf(i); if (!t) continue; const s = E.instSize(i, t); x0 = Math.min(x0, i.x - s.w / 2); y0 = Math.min(y0, i.y - s.h / 2); x1 = Math.max(x1, i.x + s.w / 2); y1 = Math.max(y1, i.y + s.h / 2); }
  const pad = 40;
  state.zoom = Math.max(0.3, Math.min(10, Math.min((r.width - pad * 2) / (x1 - x0 || 1), (r.height - pad * 2) / (y1 - y0 || 1))));
  state.panX = (r.width - (x1 - x0) * state.zoom) / 2 - x0 * state.zoom;
  state.panY = (r.height - (y1 - y0) * state.zoom) / 2 - y0 * state.zoom;
  applyView();
}
function snapPos(inst, x, y) {
  if (!$('#snapOn').checked) return { x, y };
  const t = typeOf(inst); const s = E.instSize(inst, t); const g = gridCm();
  return { x: Math.round((x - s.w / 2) / g) * g + s.w / 2, y: Math.round((y - s.h / 2) / g) * g + s.h / 2 };
}
$('#zoomIn').addEventListener('click', () => zoomAt(1.25));
$('#zoomOut').addEventListener('click', () => zoomAt(0.8));
$('#zoomFit').addEventListener('click', fitView);
$('#gridCm').addEventListener('input', () => { applyView(); setDirty(true); });
$('#gridShow').addEventListener('change', () => { applyView(); setDirty(true); });
$('#snapOn').addEventListener('change', () => setDirty(true));

// ---------- Zeichnen ----------
function portClass(port) {
  if (port.kind === 'ac') return 'ac';
  if (port.pol === '+') return 'plus';
  if (port.pol === '-') return 'minus';
  return 'pass';
}
function fitText(text, widthCm, fs) {
  const max = Math.max(3, Math.floor(widthCm / (fs * 0.56)));
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
function instSeverity() {
  const sev = {};
  if (!state.analysis) return sev;
  for (const f of state.analysis.findings) {
    if (f.sev !== 'error' && f.sev !== 'warn') continue;
    for (const r of f.refs) if (sev[r] !== 'error') sev[r] = f.sev;
  }
  return sev;
}

function renderCanvas() {
  const P = state.project;
  renderPlan();
  const sev = instSeverity();
  const instLayer = $('#instLayer');
  const nodes = [];
  for (const inst of P.instances) {
    const prod = productOf(inst);
    if (!prod) continue;
    const t = C.types[prod.type];
    const s = E.instSize(inst, t);
    const x0 = inst.x - s.w / 2, y0 = inst.y - s.h / 2;
    const g = svg('g', { class: 'inst' + (inst.bestand ? ' bestand' : '') + (state.sel && state.sel.kind === 'inst' && state.sel.id === inst.id ? ' sel' : '') + (state.multiSel.has(inst.id) ? ' multi-sel' : ''), 'data-inst': inst.id });
    g.append(svg('rect', { class: 'body', x: x0, y: y0, width: s.w, height: s.h, rx: 3 }));
    const compact = s.h < 22 || s.w < 40;
    if (!compact) {
      g.append(svg('rect', { class: 'stripe', x: x0, y: y0, width: s.w, height: 7, rx: 3, fill: t.color }));
      g.append(svg('rect', { class: 'stripe', x: x0, y: y0 + 4, width: s.w, height: 3, fill: t.color }));
      g.append(svg('text', { class: 't-type', x: x0 + 3, y: y0 + 5.2, 'font-size': 4, text: fitText(t.icon + ' ' + t.label, s.w - 6, 4) }));
      const name = inst.label || prod.name.replace(/ \(Beispiel\)$/, '');
      g.append(svg('text', { class: 't-name', x: x0 + 4, y: y0 + 14, 'font-size': 4.6, text: fitText(name, s.w - 14, 4.6) }));
      g.append(svg('text', { class: 't-spec', x: x0 + 4, y: y0 + 20, 'font-size': 3.6, text: fitText(t.spec(prod), s.w - 14, 3.6) }));
      const ex = extraLine(inst, prod);
      if (ex && s.h >= 34) g.append(svg('text', { class: 't-spec', x: x0 + 4, y: y0 + 25.5, 'font-size': 3.4, text: fitText(ex, s.w - 14, 3.4) }));
    } else {
      g.append(svg('rect', { x: x0, y: y0, width: 3, height: s.h, fill: t.color }));
      g.append(svg('text', { class: 't-name', x: inst.x, y: inst.y + 1.6, 'font-size': 4, 'text-anchor': 'middle', text: fitText(t.icon + ' ' + t.spec(prod), s.w - 6, 4) }));
    }
    // Istbestand: Schloss unten rechts
    if (inst.bestand) g.append(svg('text', { class: 't-bestand', x: x0 + s.w - 2, y: y0 + s.h - 2, 'font-size': compact ? 3.4 : 4.2, 'text-anchor': 'end', text: '🔒' }, ), svg('title', { text: 'Istbestand – wird von der Automatik nicht verändert' }));
    if (sev[inst.id]) g.append(svg('circle', { class: 'badge-' + sev[inst.id], cx: x0 + s.w - 3.5, cy: y0 + (compact ? 3.5 : 11), r: 2.4 }));
    for (const port of t.ports(prod)) {
      const pg = E.portGeom(inst, t, port);
      const r = t.passive ? 2.4 : 3;
      g.append(svg('circle', { class: 'port ' + portClass(port), cx: pg.x, cy: pg.y, r, 'data-port': port.id, 'data-inst': inst.id }));
      if (port.label && !compact) {
        const lx = pg.x - pg.nx * 5.5, ly = pg.y - pg.ny * 5.5 + 1.2;
        g.append(svg('text', { class: 't-port', x: lx, y: ly, 'font-size': 3, 'text-anchor': pg.nx > 0 ? 'end' : pg.nx < 0 ? 'start' : 'middle', text: port.label }));
      }
    }
    nodes.push(g);
  }
  instLayer.replaceChildren(...nodes);
  renderWires();
  $('#boardEmpty').hidden = P.instances.length > 0 || Boolean(P.plan && !P.plan.hidden);
}

function extraLine(inst, prod) {
  if (prod.type === 'pv') return `${inst.props.dir || 'S'} · ${fmt(inst.props.tilt)}°`;
  if (prod.type === 'load_ac' || prod.type === 'load_dc') return `${fmt(inst.props.hours)} h/Tag`;
  if (prod.type === 'grid') return `${fmt(inst.props.yearKwh)} kWh/Jahr`;
  return '';
}

function wireGeom(w) {
  const a = instById(w.a.inst), b = instById(w.b.inst);
  if (!a || !b) return null;
  const ta = typeOf(a), tb = typeOf(b);
  if (!ta || !tb) return null;
  const pa = ta.ports(productOf(a)).find((p) => p.id === w.a.port), pb = tb.ports(productOf(b)).find((p) => p.id === w.b.port);
  if (!pa || !pb) return null;
  return { A: E.portGeom(a, ta, pa), B: E.portGeom(b, tb, pb), pa, pb };
}
function bezier(A, B) {
  const d = Math.max(12, Math.hypot(B.x - A.x, B.y - A.y) / 3);
  const c1 = { x: A.x + A.nx * d, y: A.y + A.ny * d }, c2 = { x: B.x + (B.nx || 0) * d, y: B.y + (B.ny || 0) * d };
  const mid = { x: 0.125 * A.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * B.x, y: 0.125 * A.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * B.y };
  return { d: `M${A.x} ${A.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${B.x} ${B.y}`, mid };
}
function renderWires() {
  const layer = $('#wireLayer');
  const out = [];
  const res = state.analysis ? state.analysis.wires : {};
  for (const w of state.project.wires) {
    const g = wireGeom(w);
    if (!g) continue;
    const { d, mid } = bezier(g.A, g.B);
    const cls = [g.pa, g.pb].some((p) => p.pol === '+') ? 'plus' : [g.pa, g.pb].some((p) => p.pol === '-') ? 'minus' : [g.pa, g.pb].some((p) => p.kind === 'ac') ? 'ac' : 'pass';
    const r = res[w.id];
    const st = r ? r.status : 'good';
    const selected = state.sel && state.sel.kind === 'wire' && state.sel.id === w.id;
    const cab = cableOf(w);
    const width = cab ? Math.min(3.2, 0.9 + Math.sqrt(Number(cab.area) || 1.5) * 0.25) : 1.2;
    const grp = svg('g', { 'data-wire': w.id });
    if (selected) grp.append(svg('path', { class: 'wire-sel', d, 'stroke-width': width + 3 }));
    grp.append(svg('path', { class: 'wire ' + cls + (st === 'bad' ? ' bad' : ''), d, 'stroke-width': width, 'data-wire': w.id }));
    grp.append(svg('path', { class: 'wire-hit', d, 'stroke-width': 7, 'data-wire': w.id }));
    if (cab && state.zoom > 1.2) {
      const txt = `${fmt(cab.area)} mm² · ${fmt(r ? r.len : 0, 1)} m${r && r.pct > r.lim[0] ? ' · ' + fmt(r.pct, 1) + ' %' : ''}`;
      const fw = txt.length * 3 * 0.55 + 3;
      grp.append(svg('g', { class: 'wire-label ' + (st === 'bad' ? 'bad' : st === 'warn' ? 'warn' : ''), 'data-wire': w.id },
        svg('rect', { x: mid.x - fw / 2, y: mid.y - 2.6, width: fw, height: 4.4, rx: 1 }),
        svg('text', { x: mid.x, y: mid.y + 0.8, 'font-size': 3, 'text-anchor': 'middle', text: txt })));
    }
    out.push(grp);
  }
  layer.replaceChildren(...out);
}

// ---------- Interaktion auf der Fläche ----------
const canvas = $('#canvas');
let drag = null;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  canvas.focus();
  const portEl = e.target.closest('.port');
  const instEl = e.target.closest('[data-inst]');
  const wireEl = e.target.closest('[data-wire]');
  const w = toWorld(e.clientX, e.clientY);
  if (e.button === 0 && state.marqueeMode && !portEl && !instEl && !wireEl) {
    drag = { mode: 'marquee', sx: w.x, sy: w.y, ex: w.x, ey: w.y };
  } else if (e.button === 1 || (!portEl && !instEl && !wireEl)) {
    drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: state.panX, py: state.panY, moved: false };
    canvas.classList.add('panning');
  } else if (portEl) {
    const inst = instById(portEl.dataset.inst);
    const t = typeOf(inst);
    const port = t.ports(productOf(inst)).find((p) => p.id === portEl.dataset.port);
    drag = { mode: 'wire', inst, port, from: E.portGeom(inst, t, port) };
    markTargets(inst, port);
  } else if (instEl) {
    const inst = instById(instEl.dataset.inst);
    if (state.multiSel.size > 1 && state.multiSel.has(inst.id)) {
      // Klick+Ziehen auf ein Bauteil der aktuellen Mehrfachauswahl verschiebt die ganze Gruppe gemeinsam.
      const starts = new Map();
      for (const id of state.multiSel) { const i = instById(id); if (i) starts.set(id, { x: i.x, y: i.y }); }
      drag = { mode: 'move-group', anchor: inst, ax: inst.x, ay: inst.y, ox: w.x - inst.x, oy: w.y - inst.y, starts, moved: false };
    } else {
      // Klick auf ein Bauteil außerhalb der Mehrfachauswahl: normale Einzelauswahl, hebt die Gruppe auf.
      select({ kind: 'inst', id: inst.id });
      drag = { mode: 'move', inst, ox: w.x - inst.x, oy: w.y - inst.y, moved: false };
    }
  } else if (wireEl) {
    select({ kind: 'wire', id: wireEl.dataset.wire });
    drag = null;
    return;
  }
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const w = toWorld(e.clientX, e.clientY);
  if (drag.mode === 'pan') {
    state.panX = drag.px + e.clientX - drag.sx; state.panY = drag.py + e.clientY - drag.sy;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
    applyView();
  } else if (drag.mode === 'move') {
    const p = snapPos(drag.inst, w.x - drag.ox, w.y - drag.oy);
    if (p.x !== drag.inst.x || p.y !== drag.inst.y) { drag.inst.x = p.x; drag.inst.y = p.y; drag.moved = true; renderCanvas(); }
  } else if (drag.mode === 'move-group') {
    const p = snapPos(drag.anchor, w.x - drag.ox, w.y - drag.oy);
    const dx = p.x - drag.ax, dy = p.y - drag.ay;
    if (dx || dy) {
      for (const [id, s0] of drag.starts) { const i = instById(id); if (i) { i.x = s0.x + dx; i.y = s0.y + dy; } }
      drag.moved = true; renderCanvas();
    }
  } else if (drag.mode === 'wire') {
    const { d } = bezier(drag.from, { x: w.x, y: w.y, nx: 0, ny: 0 });
    $('#tempLayer').replaceChildren(svg('path', { class: 'temp-wire', d, 'stroke-width': 1, 'pointer-events': 'none' }));
  } else if (drag.mode === 'marquee') {
    drag.ex = w.x; drag.ey = w.y;
    const x = Math.min(drag.sx, drag.ex), y = Math.min(drag.sy, drag.ey);
    const mw = Math.abs(drag.ex - drag.sx), mh = Math.abs(drag.ey - drag.sy);
    $('#tempLayer').replaceChildren(svg('rect', { class: 'marquee', x, y, width: mw, height: mh, 'pointer-events': 'none' }));
  }
});

canvas.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  canvas.classList.remove('panning');
  if (d.mode === 'pan' && !d.moved) select(null);
  if ((d.mode === 'move' || d.mode === 'move-group') && d.moved) commit();
  if (d.mode === 'wire') {
    $('#tempLayer').replaceChildren();
    clearTargets();
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const portEl = target && target.closest('.port');
    if (portEl) connect(d.inst, d.port, instById(portEl.dataset.inst), portEl.dataset.port);
  }
  if (d.mode === 'marquee') {
    $('#tempLayer').replaceChildren();
    const x0 = Math.min(d.sx, d.ex), x1 = Math.max(d.sx, d.ex);
    const y0 = Math.min(d.sy, d.ey), y1 = Math.max(d.sy, d.ey);
    if (x1 - x0 > 1 || y1 - y0 > 1) {
      state.sel = null;
      state.multiSel.clear();
      for (const inst of state.project.instances) {
        const t = typeOf(inst); if (!t) continue;
        const s = E.instSize(inst, t);
        const ix0 = inst.x - s.w / 2, ix1 = inst.x + s.w / 2, iy0 = inst.y - s.h / 2, iy1 = inst.y + s.h / 2;
        if (ix1 >= x0 && ix0 <= x1 && iy1 >= y0 && iy0 <= y1) state.multiSel.add(inst.id);
      }
      renderCanvas(); renderProps();
      if (state.multiSel.size) {
        toast(`${state.multiSel.size} Element(e) ausgewählt – Entf zum Löschen`);
        if (state.tab !== 'props') showTab('props');
      }
    } else if (state.multiSel.size) {
      state.multiSel.clear();
      renderCanvas(); renderProps();
    }
  }
});

canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(Math.pow(1.0015, -e.deltaY), e.clientX, e.clientY); }, { passive: false });
canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const data = e.dataTransfer.getData('text/plain');
  if (!data.startsWith('product:')) return;
  const p = state.libById[data.slice(8)];
  if (!p) return;
  const w = toWorld(e.clientX, e.clientY);
  addInstance(p, w.x, w.y);
});

function kindOf(inst, port) { return port.kind; }
function compatible(instA, portA, instB, portB) {
  if (instA.id === instB.id) return false;
  if (kindOf(instA, portA) !== kindOf(instB, portB)) return false;
  return !state.project.wires.some((w) => (w.a.inst === instA.id && w.a.port === portA.id && w.b.inst === instB.id && w.b.port === portB.id) || (w.b.inst === instA.id && w.b.port === portA.id && w.a.inst === instB.id && w.a.port === portB.id));
}
function markTargets(inst, port) {
  for (const c of document.querySelectorAll('#instLayer .port')) {
    const oi = instById(c.dataset.inst);
    const op = typeOf(oi).ports(productOf(oi)).find((p) => p.id === c.dataset.port);
    c.classList.add(compatible(inst, port, oi, op) ? 'ok-target' : 'dim');
  }
}
function clearTargets() { for (const c of document.querySelectorAll('#instLayer .port')) c.classList.remove('ok-target', 'dim'); }

function defaultCable(pa, pb) {
  const cables = state.lib.filter((p) => p.type === 'cable');
  const pick = (fn) => cables.filter(fn).sort((a, b) => a.area - b.area)[0];
  if (pa.kind === 'ac') return pick((c) => c.cores !== '1' && c.area >= 1.5) || cables[0];
  if (pa.role === 'pv' || pb.role === 'pv' || pa.role === 'pvin' || pb.role === 'pvin') return pick((c) => c.ctype === 'solar' && c.area >= 6) || pick((c) => c.ctype === 'solar') || cables[0];
  return pick((c) => c.ctype === 'batt' && c.area >= 16) || pick((c) => c.cores === '1') || cables[0];
}
function connect(instA, portA, instB, portBId) {
  const tb = typeOf(instB);
  const portB = tb.ports(productOf(instB)).find((p) => p.id === portBId);
  if (!portB) return;
  if (instA.id === instB.id) return;
  if (portA.kind !== portB.kind) return toast('Gleichstrom (DC) und Wechselstrom (AC) lassen sich nicht direkt verbinden', true);
  if (!compatible(instA, portA, instB, portB)) return toast('Diese Verbindung gibt es schon', true);
  const cab = defaultCable(portA, portB);
  const w = { id: uid(), a: { inst: instA.id, port: portA.id }, b: { inst: instB.id, port: portB.id }, cableId: cab ? cab.id : null, lengthMode: 'auto', length: null };
  state.project.wires.push(w);
  state.sel = { kind: 'wire', id: w.id };
  commit(); renderProps();
}

function addInstance(p, x, y) {
  const inst = { id: uid(), productId: p.id, x, y, rot: 0, label: '', props: C.instDefaults(p.type, p) };
  const pos = snapPos(inst, x, y);
  inst.x = pos.x; inst.y = pos.y;
  state.project.instances.push(inst);
  state.sel = { kind: 'inst', id: inst.id };
  commit(); renderProps();
}
function removeSelected() {
  if (state.multiSel.size) {
    const ids = state.multiSel;
    state.project.instances = state.project.instances.filter((i) => !ids.has(i.id));
    state.project.wires = state.project.wires.filter((w) => !ids.has(w.a.inst) && !ids.has(w.b.inst));
    state.multiSel = new Set();
    commit(); renderProps();
    return;
  }
  const s = state.sel;
  if (!s) return;
  if (s.kind === 'inst') {
    state.project.instances = state.project.instances.filter((i) => i.id !== s.id);
    state.project.wires = state.project.wires.filter((w) => w.a.inst !== s.id && w.b.inst !== s.id);
  } else state.project.wires = state.project.wires.filter((w) => w.id !== s.id);
  state.sel = null;
  commit(); renderProps();
}
function rotateSelected() {
  if (!state.sel || state.sel.kind !== 'inst') return;
  const i = instById(state.sel.id);
  i.rot = ((i.rot || 0) + 90) % 360;
  const p = snapPos(i, i.x, i.y); i.x = p.x; i.y = p.y;
  commit();
}
function duplicateSelected() {
  if (!state.sel || state.sel.kind !== 'inst') return;
  const src = instById(state.sel.id);
  const c = clone(src); c.id = uid(); c.x += gridCm() * 2; c.y += gridCm() * 2;
  const p = snapPos(c, c.x, c.y); c.x = p.x; c.y = p.y;
  state.project.instances.push(c);
  state.sel = { kind: 'inst', id: c.id };
  commit(); renderProps();
}
function select(sel) {
  state.sel = sel;
  state.multiSel.clear();
  renderCanvas(); renderProps();
  if (sel && state.tab !== 'props') showTab('props');
}

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); return; }
  if (isTyping(e)) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); }
  else if (e.key.toLowerCase() === 'r' && !mod) rotateSelected();
  else if (e.key === 'Escape') { select(null); if (state.marqueeMode) setMarqueeMode(false); $('#productModal').hidden = true; $('#openModal').hidden = true; $('#buildModal').hidden = true; }
});

// ---------- Rechte Spalte ----------
function showTab(t) {
  state.tab = t;
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.tab === t);
  for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== 'tab-' + t;
  if (t === 'analysis') renderAnalysis();
}
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
$('#statusPill').addEventListener('click', () => showTab('analysis'));

function fieldInput(f, value, onChange) {
  let input;
  if (f.type === 'select') {
    input = el('select', {}, f.options.map((o) => el('option', { value: o.v, text: o.l, selected: String(value) === o.v })));
    input.addEventListener('change', () => onChange(input.value));
  } else {
    input = el('input', { type: f.type === 'number' ? 'number' : 'text', value: value === undefined || value === null ? '' : value, min: f.min, max: f.max, step: f.step || 'any' });
    input.addEventListener('change', () => onChange(f.type === 'number' ? (input.value === '' ? f.def : Number(input.value)) : input.value));
  }
  return el('label', {}, f.label, f.unit ? el('div', { class: 'unit-wrap' }, input, el('span', { text: f.unit })) : input);
}

function renderProps() {
  const box = $('#tab-props');
  const s = state.sel;
  if (state.multiSel.size) {
    const btn = el('button', { class: 'btn danger', text: `${state.multiSel.size} Element(e) löschen` });
    btn.addEventListener('click', removeSelected);
    return box.replaceChildren(el('div', { class: 'p-head' }, el('div', {}, el('div', { class: 'ty', text: 'Mehrfachauswahl' }),
      el('div', { class: 'nm', text: `${state.multiSel.size} Elemente ausgewählt` }))), btn);
  }
  if (!s) return box.replaceChildren(helpPanel());
  if (s.kind === 'inst') {
    const inst = instById(s.id);
    if (!inst) return box.replaceChildren(helpPanel());
    const prod = productOf(inst);
    const t = C.types[prod.type];
    const kids = [];
    kids.push(el('div', { class: 'p-head' }, el('span', { class: 'ico', text: t.icon }), el('div', {}, el('div', { class: 'ty', text: t.label }), el('div', { class: 'nm', text: inst.label || prod.name }))));
    const lbl = el('input', { type: 'text', value: inst.label || '', placeholder: prod.name, maxlength: 80 });
    lbl.addEventListener('input', () => { inst.label = lbl.value; renderCanvas(); });
    lbl.addEventListener('change', commit);
    kids.push(el('label', {}, 'Eigene Bezeichnung (optional)', lbl));
    // Istbestand: Teil ist schon vorhanden und bleibt, wie es ist. Die Automatik baut drumherum, tauscht oder ergänzt es nie.
    const best = el('input', { type: 'checkbox', checked: Boolean(inst.bestand) });
    best.addEventListener('change', () => {
      if (best.checked) { inst.bestand = true; delete inst.auto; } else delete inst.bestand;
      commit(); renderCanvas(); renderProps();
    });
    kids.push(el('label', { class: 'check', title: 'Vorhandenes Teil: „Autom. Fertigstellen" und Auto-Korrektur tauschen es nicht aus und ergänzen keine weiteren davon – alles andere wird passend dazu ausgelegt.' },
      best, ' Istbestand (vorhanden, nicht ändern)'));
    const sameType = state.lib.filter((p) => p.type === prod.type);
    const sel = el('select', {}, sameType.map((p) => el('option', { value: p.id, text: p.name, selected: p.id === inst.productId })),
      !state.libById[inst.productId] ? el('option', { value: inst.productId, text: prod.name + ' (nicht mehr in der Bibliothek)', selected: true }) : null);
    sel.addEventListener('change', () => {
      inst.productId = sel.value; delete inst.product;
      const ids = new Set(C.types[prod.type].ports(productOf(inst)).map((p) => p.id));
      state.project.wires = state.project.wires.filter((w) => !((w.a.inst === inst.id && !ids.has(w.a.port)) || (w.b.inst === inst.id && !ids.has(w.b.port))));
      commit(); renderProps();
    });
    kids.push(el('label', {}, 'Produkt', sel));
    kids.push(el('div', { class: 'row' },
      el('button', { class: 'btn small', type: 'button', text: '✎ Produkt bearbeiten', onclick: () => openProductModal(prod) }),
      el('button', { class: 'btn small', type: 'button', text: '+ Als neues Produkt', onclick: () => { const c = clone(prod); delete c.id; c.name = prod.name + ' (eigene)'; openProductModal(null); pmProduct = c; renderProductForm(true); } }),
      prod.url ? el('a', { class: 'btn small', href: prod.url, target: '_blank', rel: 'noopener noreferrer', text: '↗ Zum Produkt' }) : null));
    if (t.inst.length) {
      kids.push(el('div', { class: 'p-sec', text: 'Einsatz' }));
      const g = el('div', { class: 'fields2' });
      for (const f of t.inst) g.append(fieldInput(f, inst.props[f.id], (v) => { inst.props[f.id] = v; commit(); }));
      kids.push(g);
      if (prod.type === 'pv') kids.push(el('p', { class: 'muted small', text: 'Tipp: Neigung/Ausrichtung gilt für das ganze Solarfeld – maßgeblich ist das erste Modul des Felds.' }));
    }
    kids.push(el('div', { class: 'p-sec', text: 'Technische Daten' }));
    const kv = el('dl', { class: 'kv' });
    for (const f of t.fields) {
      const v = prod[f.id];
      if (v === undefined || v === '') continue;
      const shown = f.type === 'select' ? ((f.options.find((o) => o.v === String(v)) || {}).l || v) : (typeof v === 'number' ? fmt(v) : v);
      kv.append(el('dt', { text: f.label }), el('dd', { text: shown + (f.unit && f.type === 'number' ? ' ' + f.unit : '') }));
    }
    if (prod.price) kv.append(el('dt', { text: 'Preis' }), el('dd', { text: fmt(prod.price, 2) + ' €' }));
    kids.push(kv);
    kids.push(el('div', { id: 'propsCalc' }));
    kids.push(el('div', { class: 'row' },
      el('button', { class: 'btn small', type: 'button', text: '⟳ Drehen (R)', onclick: rotateSelected }),
      el('button', { class: 'btn small', type: 'button', text: 'Duplizieren', onclick: duplicateSelected }),
      el('button', { class: 'btn small danger', type: 'button', text: 'Löschen', onclick: removeSelected })));
    box.replaceChildren(...kids);
    renderPropsCalc();
    return;
  }
  // Kabel
  const w = wireById(s.id);
  if (!w) return box.replaceChildren(helpPanel());
  const a = instById(w.a.inst), b = instById(w.b.inst);
  const kids = [el('div', { class: 'p-head' }, el('span', { class: 'ico', text: '〽️' }), el('div', {}, el('div', { class: 'ty', text: 'Kabel' }), el('div', { class: 'nm', text: `${a.label || productOf(a).name} → ${b.label || productOf(b).name}` })))];
  const cables = state.lib.filter((p) => p.type === 'cable');
  const sel = el('select', {}, cables.map((c) => el('option', { value: c.id, text: c.name, selected: c.id === w.cableId })),
    w.cableId && !state.libById[w.cableId] ? el('option', { value: w.cableId, text: (w.cable || {}).name + ' (nicht mehr in der Bibliothek)', selected: true }) : null);
  sel.addEventListener('change', () => { w.cableId = sel.value; delete w.cable; commit(); });
  kids.push(el('label', {}, 'Kabeltyp', sel));
  const mode = el('select', {}, el('option', { value: 'auto', text: 'aus der Zeichnung (Abstand im Raster)', selected: w.lengthMode !== 'manual' }), el('option', { value: 'manual', text: 'eigene Angabe', selected: w.lengthMode === 'manual' }));
  const autoLen = state.analysis && state.analysis.wires[w.id] ? fmt(state.analysis.wires[w.id].len, 2) : '';
  const len = el('input', { type: 'number', min: 0.1, step: 0.1, value: w.lengthMode === 'manual' ? (w.length || '') : '', placeholder: autoLen, disabled: w.lengthMode !== 'manual' ? true : null });
  mode.addEventListener('change', () => {
    w.lengthMode = mode.value;
    if (mode.value === 'manual' && !w.length) w.length = state.analysis && state.analysis.wires[w.id] ? Number(state.analysis.wires[w.id].len.toFixed(1)) : 1;
    commit(); renderProps();
  });
  len.addEventListener('change', () => { w.length = Math.max(0.1, Number(len.value) || 1); commit(); });
  kids.push(el('div', { class: 'fields2' }, el('label', {}, 'Länge', mode), el('label', {}, 'Länge (einfach)', el('div', { class: 'unit-wrap' }, len, el('span', { text: 'm' })))));
  kids.push(el('p', { class: 'muted small', text: 'Einzeladern: Plus- und Minusleitung werden getrennt gezeichnet, jede mit ihrer eigenen Länge. Mehradrige Leitungen (z. B. NYM) enthalten Hin- und Rückleiter.' }));
  kids.push(el('div', { id: 'propsCalc' }));
  kids.push(el('div', { class: 'row' }, el('button', { class: 'btn small danger', type: 'button', text: 'Kabel löschen', onclick: removeSelected })));
  box.replaceChildren(...kids);
  renderPropsCalc();
}

function renderPropsCalc() {
  const box = $('#propsCalc');
  if (!box || !state.analysis || !state.sel) return;
  const A = state.analysis;
  const kids = [];
  if (state.sel.kind === 'wire') {
    const r = A.wires[state.sel.id];
    const w = wireById(state.sel.id);
    if (!r) return box.replaceChildren();
    kids.push(el('div', { class: 'p-sec', text: 'Berechnung' }));
    const st = { good: 'gut', ok: 'in Ordnung', warn: 'zu hoch', bad: 'kritisch' }[r.status];
    kids.push(el('dl', { class: 'kv' },
      el('dt', { text: 'Länge' }), el('dd', { text: fmt(r.len, 2) + ' m' }),
      el('dt', { text: 'Bemessungsstrom' }), el('dd', { text: fmt(r.I, 1) + ' A' }),
      el('dt', { text: 'Belastbarkeit' }), el('dd', { class: r.I > r.amp ? 'st-bad' : '', text: fmt(r.amp) + ' A' }),
      el('dt', { text: 'Bezugsspannung' }), el('dd', { text: fmt(r.V, 1) + ' V' }),
      el('dt', { text: 'Widerstand' }), el('dd', { text: fmt(r.R * 1000, 1) + ' mΩ' }),
      el('dt', { text: 'Spannungsfall' }), el('dd', { class: 'st-' + r.status, text: `${fmt(r.dU, 2)} V = ${fmt(r.pct, 2)} % (${st})` }),
      el('dt', { text: 'Verlust bei Volllast' }), el('dd', { text: fmt(r.lossW, 1) + ' W' })));
    kids.push(el('p', { class: 'muted small', text: `Grenzwerte je ${r.loop === 2 ? 'Leitung (Hin + Rück)' : 'Einzelleiter'}: gut ≤ ${fmt(r.lim[0], 2)} %, Warnung > ${fmt(r.lim[1], 2)} %, kritisch > ${fmt(r.lim[2], 2)} %.` }));
    if (r.suggest && r.suggest !== r.area) {
      const cab = cableOf(w);
      const cand = state.lib.filter((c) => c.type === 'cable' && Number(c.area) === r.suggest && c.material === cab.material && c.cores === cab.cores).sort((a, b) => (a.ctype === cab.ctype ? -1 : 1))[0];
      kids.push(el('p', { class: 'small', text: `Empfohlen für ≤ ${fmt(r.lim[0], 2)} % Spannungsfall: ${fmt(r.suggest)} mm².` }));
      if (cand) kids.push(el('button', { class: 'btn small', type: 'button', text: `„${cand.name}" übernehmen`, onclick: () => { w.cableId = cand.id; delete w.cable; commit(); renderProps(); } }));
    }
  } else {
    const inst = instById(state.sel.id);
    const g = A.groups.find((x) => x.insts.some((i) => i.id === inst.id));
    if (g) {
      const v = g.val;
      kids.push(el('div', { class: 'p-sec', text: g.kind === 'pv' ? 'Solarfeld (berechnet)' : 'Batteriebank (berechnet)' }));
      const lay = v.par > 1 ? `${v.s} in Reihe × ${v.par} parallel` : `${v.s} in Reihe`;
      const rows = g.kind === 'pv'
        ? [['Module', `${v.n} (${lay})`], ['Leistung', fmt(v.P) + ' Wp'], ['Vmp / Imp', `${fmt(v.vmp)} V / ${fmt(v.imp)} A`], ['Voc / Isc', `${fmt(v.voc)} V / ${fmt(v.isc)} A`], [`Voc bei ${state.project.settings.tMin} °C`, fmt(v.vocCold) + ' V'], ['Vmp bei 70 °C Zelle', fmt(v.vmpHot) + ' V']]
        : [['Batterien', `${v.n} (${lay})`], ['Spannung', fmt(v.v) + ' V'], ['Kapazität', fmt(v.ah) + ' Ah'], ['Energie', fmt(v.v * v.ah / 1000, 2) + ' kWh'], ['nutzbar', `${fmt(v.v * v.ah * v.dod / 100000, 2)} kWh (${fmt(v.dod)} %)`], ['max. Laden / Entladen', `${fmt(v.maxChg)} A / ${fmt(v.maxDis)} A`]];
      kids.push(el('dl', { class: 'kv' }, rows.flatMap(([k, x]) => [el('dt', { text: k }), el('dd', { text: x })])));
    }
    const c = A.instCalc[inst.id];
    if (c && c.ratio) {
      kids.push(el('div', { class: 'p-sec', text: 'Auslastung' }));
      kids.push(el('dl', { class: 'kv' },
        el('dt', { text: 'Angeschlossene PV' }), el('dd', { text: fmt(c.pvP) + ' Wp' }),
        c.pOut ? [el('dt', { text: 'Reglerleistung' }), el('dd', { text: fmt(c.pOut) + ' W' })] : null,
        el('dt', { text: inst && productOf(inst).type === 'mppt' ? 'PV/Regler-Verhältnis' : 'DC/AC-Verhältnis' }), el('dd', { text: fmt(c.ratio, 2) })));
    }
  }
  const mine = A.findings.filter((f) => f.refs.includes(state.sel.id) && f.sev !== 'info');
  if (mine.length) {
    kids.push(el('div', { class: 'p-sec', text: 'Hinweise zu diesem Teil' }));
    for (const f of mine) kids.push(findingEl(f, false));
  }
  box.replaceChildren(...kids);
}

function helpPanel() {
  return el('div', { class: 'help' },
    el('h3', { text: 'So funktioniert der Baukasten' }),
    el('ul', {},
      el('li', { text: 'Bauteile aus der Bibliothek links auf die Fläche ziehen (oder doppelklicken).' }),
      el('li', { text: 'Verbinden: Auf einen farbigen Anschluss drücken, ziehen und auf dem Ziel-Anschluss loslassen. Rot = Plus, Blau = Minus, Gelb = 230 V.' }),
      el('li', { text: 'Reihenschaltung: Plus des einen an Minus des nächsten. Parallel: Plus an Plus, Minus an Minus.' }),
      el('li', { text: 'Auf ein Bauteil oder Kabel klicken zeigt hier seine Eigenschaften und Berechnungen.' }),
      el('li', { text: 'Rechts oben im Reiter „Analyse": was funktioniert, was nicht, und warum.' })),
    el('h3', { text: 'Tastatur' }),
    el('ul', {},
      el('li', {}, el('kbd', { text: 'Entf' }), ' löschen · ', el('kbd', { text: 'R' }), ' drehen · ', el('kbd', { text: 'Strg+D' }), ' duplizieren'),
      el('li', {}, el('kbd', { text: 'Strg+Z' }), ' / ', el('kbd', { text: 'Strg+Y' }), ' rückgängig / wiederholen · ', el('kbd', { text: 'Strg+S' }), ' speichern'),
      el('li', { text: 'Mausrad = zoomen, leere Fläche ziehen = verschieben.' })),
    el('h3', { text: 'Raster' }),
    el('p', { text: 'Das Rastermaß ist in Zentimetern. Mit „Einrasten" springen Bauteile auf das Raster. Kabellängen werden aus dem Abstand auf der Fläche berechnet – oder beim Kabel selbst eingetragen (z. B. 30 m).' }));
}

// ---------- Analyse ----------
let anaTimer;
function scheduleAnalysis() { clearTimeout(anaTimer); anaTimer = setTimeout(runAnalysis, 200); }
function runAnalysis() {
  const P = state.project;
  try {
    state.analysis = E.analyze({ instances: P.instances, wires: P.wires, settings: P.settings }, state.lib);
  } catch (e) {
    console.error(e);
    state.analysis = { findings: [{ sev: 'error', title: 'Berechnungsfehler', text: e.message, why: [], fix: [], refs: [] }], groups: [], systems: [], wires: {}, ilr: [], bom: [], totalCost: 0, instCalc: {} };
  }
  const f = state.analysis.findings;
  const ne = f.filter((x) => x.sev === 'error').length, nw = f.filter((x) => x.sev === 'warn').length;
  const pill = $('#statusPill');
  pill.className = 'status-pill ' + (ne ? 'error' : nw ? 'warn' : P.instances.length ? 'ok' : '');
  pill.textContent = !P.instances.length ? 'Analyse' : ne ? `${ne} Fehler · ${nw} Warnungen` : nw ? `${nw} Warnungen` : '✓ keine Probleme';
  const badge = $('#tabBadge');
  badge.hidden = !(ne || nw); badge.textContent = ne || nw; badge.className = 'tab-badge' + (ne ? '' : ' warn');
  renderCanvas();
  renderPropsCalc();
  if (state.tab === 'analysis') renderAnalysis();
}

const SEV_LABEL = { error: 'Fehler', warn: 'Warnung', tip: 'Tipp', ok: 'OK', info: 'Info' };
function findingEl(f, open) {
  f.auto = f.auto || null; f.choices = f.choices || [];
  const body = el('div', { class: 'fbody' },
    f.why.length ? [el('h4', { text: 'Warum' }), el('ul', {}, f.why.map((x) => el('li', { text: x })))] : null,
    f.fix.length ? [el('h4', { text: f.sev === 'tip' && f.title.includes('Verschaltungen') ? 'Möglichkeiten' : 'Was tun' }), el('ul', {}, f.fix.map((x) => el('li', { text: x })))] : null,
    (f.refs.length || f.auto || f.choices.length) ? el('div', { class: 'row' },
      f.refs.length ? el('button', { class: 'btn small', type: 'button', text: 'Im Plan zeigen', onclick: () => focusRef(f.refs[0]) }) : null,
      f.auto ? el('button', { class: 'btn small primary', type: 'button', text: '✨ Auto-Korrektur', title: f.auto.label, onclick: () => applyAuto(f.auto, true) }) : null,
      f.auto ? el('span', { class: 'muted small auto-label', text: f.auto.label }) : null,
      f.choices.length ? el('button', { class: 'btn small primary', type: 'button', text: '✨ Lösung wählen', onclick: () => openChoiceModal(f) }) : null) : null);
  // Aufklappbar kenntlich machen: Pfeil rechts und eine Zeile, was sich darunter verbirgt
  const more = [f.why.length ? 'Warum' : null, f.fix.length ? 'Was tun' : null].filter(Boolean).join(' · ');
  const hasBody = Boolean(more || f.auto || f.choices.length || f.refs.length);
  return el('details', { class: 'finding ' + f.sev + (hasBody ? '' : ' leer'), open: open || null },
    el('summary', { title: hasBody ? 'Klicken zum Auf-/Zuklappen' : null },
      el('span', { class: 'sev', text: SEV_LABEL[f.sev] }), el('span', { class: 'ft', text: f.title }),
      hasBody ? el('span', { class: 'chev', 'aria-hidden': 'true', text: '▾' }) : null,
      f.text ? el('span', { class: 'fx', text: f.text }) : null,
      hasBody ? el('span', { class: 'more' }, more ? el('span', { text: '▸ ' + more }) : null,
        f.auto ? el('span', { class: 'more-auto', text: '✨ Auto-Korrektur möglich' }) : null,
        f.choices.length ? el('span', { class: 'more-auto', text: '✨ Mehrere Lösungswege wählbar' }) : null) : null),
    body);
}

// Hinweise mit mehreren gleichwertigen Lösungswegen: zeigt jede Option mit Auswirkung-falls-nicht-umgesetzt
// und ob der Betrieb auch unverändert gefahrlos möglich ist, bevor etwas angewendet wird.
function openChoiceModal(f) {
  const allSafe = f.choices.every((c) => c.safe !== false);
  const safeNote = el('p', { class: 'choice-safe' + (allSafe ? '' : ' unsafe') },
    allSafe
      ? '✓ Auch ohne Änderung läuft die Anlage weiter gefahrlos – es geht hier nur um Wirtschaftlichkeit/Komfort, nicht um Sicherheit.'
      : '⚠ Mindestens eine Option betrifft die Sicherheit – bitte die Hinweise unten genau lesen.');
  const items = f.choices.map((c) => {
    const btn = el('button', {
      class: 'btn primary', type: 'button',
      text: c.auto ? c.label : c.label + ' (von Hand)',
      title: c.auto ? c.auto.label : 'Keine automatische Korrektur möglich – von Hand umsetzen.',
      onclick: async () => {
        $('#choiceModal').hidden = true;
        if (c.auto) { if (await applyAuto(c.auto, true)) return; }
        toast(c.auto ? 'Automatische Korrektur fehlgeschlagen' : 'Bitte von Hand umsetzen: ' + c.label, !c.auto);
      },
    });
    return el('div', { class: 'choice-item' }, btn,
      el('p', {}, el('strong', { text: 'Falls nicht umgesetzt: ' }), c.consequence));
  });
  $('#choiceTitle').textContent = f.title;
  $('#choiceBody').replaceChildren(
    f.text ? el('p', { class: 'muted', text: f.text }) : null,
    safeNote, ...items);
  $('#choiceModal').hidden = false;
}
// ---------- Auto-Korrektur ----------
async function ensureProduct(spec) {
  if (spec.productId && state.libById[spec.productId]) return spec.productId;
  const same = state.lib.find((p) => p.type === spec.create.type && p.name === spec.create.name);
  if (same) return same.id;
  const saved = await api('POST', '/api/library', spec.create);
  await loadLibrary();
  return saved.id;
}
function dropDanglingWires(inst) {
  const ids = new Set(typeOf(inst).ports(productOf(inst)).map((p) => p.id));
  state.project.wires = state.project.wires.filter((w) => !((w.a.inst === inst.id && !ids.has(w.a.port)) || (w.b.inst === inst.id && !ids.has(w.b.port))));
}
async function applyAuto(a, single) {
  try {
    // Neu planen (Batteriebank vergrößern, Strangsicherungen): läuft über „Autom. Fertigstellen"
    if (a.op === 'rebuild') { await autoComplete(); return true; }
    if (a.op === 'setSetting') {
      state.project.settings = Object.assign({}, state.project.settings, { [a.key]: a.value });
      commit();
      await autoComplete(true);
      return true;
    }
    if (a.op === 'splitMicro') {
      const old = instById(a.inst);
      if (!old) return false;
      const pid = await ensureProduct(a.spec);
      const prod = state.libById[pid];
      const nIn = Math.max(1, Number(prod.inputs || 1));
      const oldPorts = typeOf(old).ports(productOf(old)).filter((p) => /^pv\d+\+$/.test(p.id));
      // je Eingang des alten Geräts: angeschlossenes Modul (über den Plus-Pol) finden
      const modIds = [];
      for (const pPlus of oldPorts) {
        const k = pPlus.id.slice(2, -1);
        const wPlus = state.project.wires.find((w) => (w.a.inst === old.id && w.a.port === `pv${k}+`) || (w.b.inst === old.id && w.b.port === `pv${k}+`));
        if (wPlus) modIds.push(wPlus.a.inst === old.id ? wPlus.b.inst : wPlus.a.inst);
      }
      if (!modIds.length) return false;
      const acWire = state.project.wires.find((w) => (w.a.inst === old.id && w.a.port === 'ac') || (w.b.inst === old.id && w.b.port === 'ac'));
      const acOther = acWire ? (acWire.a.inst === old.id ? acWire.b : acWire.a) : null;
      state.project.wires = state.project.wires.filter((w) => w.a.inst !== old.id && w.b.inst !== old.id);
      state.project.instances = state.project.instances.filter((i) => i.id !== old.id);
      const acPort = acOther && typeOf(instById(acOther.inst)).ports(productOf(instById(acOther.inst))).find((p) => p.id === acOther.port);
      for (let g = 0; g * nIn < modIds.length; g++) {
        const grp = modIds.slice(g * nIn, g * nIn + nIn);
        const mi = { id: uid(), productId: pid, x: old.x, y: old.y + g * 130, rot: 0, label: '', props: C.instDefaults('micro', prod), auto: old.auto || false };
        state.project.instances.push(mi);
        const miPorts = typeOf(mi).ports(prod);
        grp.forEach((modId, idx) => {
          const mod = instById(modId);
          const modPlus = typeOf(mod).ports(productOf(mod)).find((p) => p.id === '+');
          const modMinus = typeOf(mod).ports(productOf(mod)).find((p) => p.id === '-');
          const inPlus = miPorts.find((p) => p.id === `pv${idx + 1}+`);
          const inMinus = miPorts.find((p) => p.id === `pv${idx + 1}-`);
          state.project.wires.push({ id: uid(), a: { inst: modId, port: '+' }, b: { inst: mi.id, port: inPlus.id }, cableId: (defaultCable(modPlus, inPlus) || {}).id || null, lengthMode: 'auto', length: null });
          state.project.wires.push({ id: uid(), a: { inst: modId, port: '-' }, b: { inst: mi.id, port: inMinus.id }, cableId: (defaultCable(modMinus, inMinus) || {}).id || null, lengthMode: 'auto', length: null });
        });
        if (acOther) {
          const miAc = miPorts.find((p) => p.id === 'ac');
          state.project.wires.push({ id: uid(), a: { inst: mi.id, port: 'ac' }, b: { inst: acOther.inst, port: acOther.port }, cableId: (defaultCable(miAc, acPort) || {}).id || null, lengthMode: 'auto', length: null });
        }
      }
      commit(); renderProps(); runAnalysis(); toast('✓ ' + a.label);
      return true;
    }
    if (a.op === 'addModules') {
      const mods = state.project.instances.filter((i) => i.productId === a.productId);
      const maxY = Math.max(0, ...mods.map((i) => i.y));
      for (let k = 0; k < a.count; k++) state.project.instances.push({ id: uid(), productId: a.productId, x: (k % 8) * 115, y: maxY + 90 + Math.floor(k / 8) * 80, rot: 0, label: '', props: clone((mods[0] || {}).props || C.instDefaults('pv', state.libById[a.productId])) });
      commit();
      await autoComplete(true);
      return true;
    }
    if (a.op === 'setProp') {
      const list = (a.insts || [a.inst]).map(instById).filter(Boolean);
      if (!list.length) return false;
      for (const inst of list) inst.props = Object.assign({}, inst.props, { [a.key]: a.value });
      if (single) { commit(); renderProps(); toast('✓ ' + a.label); }
      return true;
    }
    const pid = await ensureProduct(a.spec);
    if (a.op === 'cable') {
      for (const id of a.wires) { const w = wireById(id); if (w) { w.cableId = pid; delete w.cable; } }
    } else if (a.op === 'swap') {
      const inst = instById(a.inst);
      if (!inst) return false;
      inst.productId = pid; delete inst.product;
      dropDanglingWires(inst);
    } else if (a.op === 'insertFuse') {
      const w = wireById(a.wire);
      const g = w && wireGeom(w);
      if (!g) return false;
      if (a.cable) {
        const cid = await ensureProduct(a.cable.spec);
        for (const id of a.cable.wires) { const x = wireById(id); if (x) { x.cableId = cid; delete x.cable; } }
      }
      const batFirst = `${w.a.inst}|${w.a.port}` === a.batKey;
      const batEnd = batFirst ? w.a : w.b, devEnd = batFirst ? w.b : w.a;
      const bp = batFirst ? g.A : g.B, dp = batFirst ? g.B : g.A;
      // neben den Batterie-Pol setzen (in Richtung des Anschlusses) und Überlappungen vermeiden
      // auto: beim nächsten Fertigstellen wird die Sicherung neu geplant statt liegen zu bleiben
      const fuse = { id: uid(), productId: pid, x: bp.x + (bp.nx || Math.sign(dp.x - bp.x) || 1) * 32, y: bp.y + (bp.ny || 0) * 20, rot: 0, label: '', props: {}, auto: true };
      const fs = E.instSize(fuse, C.types.fuse);
      const hits = () => state.project.instances.some((o) => {
        const t = typeOf(o); if (!t) return false;
        const s = E.instSize(o, t);
        return Math.abs(o.x - fuse.x) < (s.w + fs.w) / 2 + 4 && Math.abs(o.y - fuse.y) < (s.h + fs.h) / 2 + 4;
      });
      for (let k = 0; k < 12 && hits(); k++) fuse.y += fs.h + 8;
      const pos = snapPos(fuse, fuse.x, fuse.y); fuse.x = pos.x; fuse.y = pos.y;
      state.project.instances.push(fuse);
      state.project.wires = state.project.wires.filter((x) => x.id !== w.id);
      const manual = w.lengthMode === 'manual' && w.length;
      const part = (f) => ({ cableId: w.cableId, cable: w.cable, lengthMode: manual ? 'manual' : 'auto', length: manual ? Math.max(0.2, Math.round(w.length * f * 10) / 10) : null });
      state.project.wires.push({ id: uid(), a: batEnd, b: { inst: fuse.id, port: 'a' }, ...part(0.3) }, { id: uid(), a: { inst: fuse.id, port: 'b' }, b: devEnd, ...part(0.7) });
    } else return false;
    if (single) { commit(); renderProps(); toast('✓ ' + a.label); }
    return true;
  } catch (e) { toast(e.message, true); return false; }
}
async function applyAll(silent) {
  const done = [];
  const tried = new Set();
  for (let n = 0; n < 30; n++) {
    runAnalysis();
    const f = state.analysis.findings.find((x) => x.auto && !x.auto.manual && !['rebuild', 'addModules'].includes(x.auto.op) && !tried.has(x.auto.label + JSON.stringify(x.auto.wires || x.auto.inst || x.auto.wire)));
    if (!f) break;
    tried.add(f.auto.label + JSON.stringify(f.auto.wires || f.auto.inst || f.auto.wire));
    if (await applyAuto(f.auto, false)) done.push(f.auto.label);
  }
  if (silent) return done;
  if (!done.length) return toast('Nichts automatisch korrigierbar');
  commit(); renderProps();
  toast(`✓ ${done.length} Korrektur${done.length > 1 ? 'en' : ''} angewendet – mit Strg+Z rückgängig`);
  return done;
}

// ---------- Automatisch fertigstellen ----------
async function autoComplete(noAsk) {
  if (!state.project.instances.length) return toast('Erst Bauteile auf die Fläche ziehen (z. B. Module, Batterien, Verbraucher)', true);
  if (noAsk !== true && state.project.wires.length && !confirm('Alle vorhandenen Verbindungen werden neu gezogen, automatisch ergänzte Teile und Sicherungen neu geplant. Eigene Bauteile bleiben erhalten, Teile mit „Istbestand" werden nie verändert.\n\nFortfahren? (Rückgängig mit Strg+Z)')) return;
  const res = EM_AUTOBUILD.autoBuild(state.project, state.lib);
  let fixes = [];
  if (res.ok) {
    // Neue Teile (z. B. PV-Strangsicherungen) in der Bibliothek anlegen
    for (const i of res.instances) if (String(i.productId).startsWith('pending:')) { i.productId = await ensureProduct({ create: i.product }); delete i.product; }
    state.project.instances = res.instances;
    state.project.wires = res.wires;
    state.sel = null;
    fixes = await applyAll(true); // Kabelquerschnitte, Sicherungen
    commit();                     // ein Undo-Schritt für alles
    renderProps(); runAnalysis(); fitView();
  }
  showBuildReport(res, fixes);
}
function showBuildReport(res, fixes) {
  const box = $('#buildBody');
  const kids = [];
  if (res.ok) {
    kids.push(el('div', { class: 'p-sec', text: 'Ergänzt' }));
    kids.push(res.added.length || res.changed.length
      ? el('ul', { class: 'build-list' }, res.added.map((a) => el('li', {}, el('strong', { text: a.name.replace(/ \(Beispiel\)$/, '') }), ' – ' + a.why)), res.changed.map((c) => el('li', { text: 'Getauscht: ' + c })))
      : el('p', { class: 'muted', text: 'Keine zusätzlichen Geräte nötig – vorhandene Bauteile wurden verwendet.' }));
    kids.push(el('p', { class: 'muted small', text: `${state.project.wires.length} Verbindungen gezogen.` }));
    if (fixes.length) {
      kids.push(el('div', { class: 'p-sec', text: 'Kabel & Sicherungen (Auto-Korrektur)' }));
      kids.push(el('ul', { class: 'build-list' }, fixes.map((f) => el('li', { text: f }))));
    }
    const infos = res.notes.filter((n) => n.sev === 'info');
    if (infos.length) {
      kids.push(el('div', { class: 'p-sec', text: 'So wurde aufgebaut' }));
      for (const n of infos) kids.push(findingEl(n, false));
    }
  }
  const probs = res.notes.filter((n) => n.sev !== 'info');
  const remaining = res.ok && state.analysis ? state.analysis.findings.filter((f) => f.sev === 'error' || f.sev === 'warn') : [];
  kids.push(el('div', { class: 'p-sec', text: probs.length || remaining.length ? 'Betrifft deine Grundelemente – Empfehlungen' : 'Ergebnis' }));
  if (!probs.length && !remaining.length) kids.push(el('p', { class: 'build-ok', text: '✓ Die Grundelemente passen zusammen, es gibt keine Fehler oder Warnungen.' }));
  else kids.push(el('p', { class: 'muted small', text: 'Regler, Wechselrichter, Kabel und Sicherungen hat die Automatik passend gewählt. Die folgenden Punkte liegen an den Teilen, die du selbst ausgewählt hast (Module, Batterien, Verbraucher) – die tauscht die Automatik bewusst nicht aus. Was du ändern könntest, steht jeweils unter „Was tun".' }));
  for (const n of probs) kids.push(findingEl(n, n.sev === 'error'));
  for (const f of remaining) kids.push(findingEl(f, false));
  box.replaceChildren(...kids);
  $('#buildModal').hidden = false;
}
$('#btnAutoBuild').addEventListener('click', autoComplete);
$('#buildToAnalysis').addEventListener('click', () => { $('#buildModal').hidden = true; showTab('analysis'); });

function focusRef(id) {
  const inst = instById(id);
  const wire = wireById(id);
  const r = $('#canvas').getBoundingClientRect();
  let x, y;
  if (inst) { x = inst.x; y = inst.y; state.sel = { kind: 'inst', id }; }
  else if (wire) { const g = wireGeom(wire); if (!g) return; x = (g.A.x + g.B.x) / 2; y = (g.A.y + g.B.y) / 2; state.sel = { kind: 'wire', id }; }
  else return;
  state.panX = r.width / 2 - x * state.zoom; state.panY = r.height / 2 - y * state.zoom;
  applyView(); renderCanvas(); renderProps(); showTab('props');
}

function monthChart(sys) {
  const W = 340, H = 120, pad = 18, bw = (W - pad) / 12;
  const vals = sys.months.map((d) => ({ pv: d.pvGen / 1000, load: (d.acDemand + d.dcDemand) / 1000, miss: (sys.island ? d.unmet : d.gridImport) / 1000 }));
  const max = Math.max(0.1, ...vals.map((v) => Math.max(v.pv, v.load)));
  const s = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H + 14}` });
  s.append(svg('line', { class: 'axis', x1: pad, y1: H, x2: W, y2: H }));
  for (let t = 0; t <= 2; t++) {
    const val = max * t / 2;
    s.append(svg('text', { x: 0, y: H - (H - 8) * t / 2 + 3, text: fmt(val, 1) }));
  }
  vals.forEach((v, m) => {
    const x = pad + m * bw + 2;
    const h1 = (H - 8) * v.pv / max, h2 = (H - 8) * v.load / max, h3 = (H - 8) * v.miss / max;
    s.append(svg('rect', { class: 'bar-pv', x, y: H - h1, width: bw / 2 - 2, height: h1 }, svg('title', { text: `${E.MONTHS[m]}: Ertrag ${fmt(v.pv, 2)} kWh/Tag` })));
    s.append(svg('rect', { class: 'bar-load', x: x + bw / 2 - 2, y: H - h2, width: bw / 2 - 2, height: h2 }, svg('title', { text: `${E.MONTHS[m]}: Bedarf ${fmt(v.load, 2)} kWh/Tag` })));
    if (h3 > 0.5) s.append(svg('rect', { class: 'bar-miss', x: x + bw / 2 - 2, y: H - h3, width: bw / 2 - 2, height: h3 }, svg('title', { text: `${E.MONTHS[m]}: ${sys.island ? 'fehlt' : 'Netzbezug'} ${fmt(v.miss, 2)} kWh/Tag` })));
    s.append(svg('text', { x: x + bw / 2 - 2, y: H + 11, 'text-anchor': 'middle', text: E.MONTHS[m].slice(0, 1) }));
  });
  return s;
}

function renderAnalysis() {
  const box = $('#tab-analysis');
  const A = state.analysis;
  if (!A || !state.project.instances.length) return box.replaceChildren(el('p', { class: 'muted', text: 'Noch keine Bauteile. Sobald du etwas auf die Fläche ziehst, wird hier laufend gerechnet.' }));
  const kids = [];
  const MODE = { island: 'Inselanlage', grid: 'Netzgekoppelt', 'grid-storage': 'Netz + Speicher', none: 'nicht vollständig' };
  const COUP = { dc: 'DC-gekoppelt', ac: 'AC-gekoppelt', mixed: 'DC + AC gekoppelt' };
  A.systems.forEach((s, idx) => {
    if (s.mode === 'none' && !s.kwp) return;
    kids.push(el('div', { class: 'sys-title' }, el('span', { text: A.systems.length > 1 ? `Anlage ${idx + 1}` : 'Anlage' }),
      el('span', {}, el('span', { class: 'mode-chip', text: MODE[s.mode] }), s.coupling ? ' ' : null, s.coupling ? el('span', { class: 'mode-chip', text: COUP[s.coupling] }) : null)));
    const k = [];
    const kpi = (v, l) => k.push(el('div', { class: 'kpi' }, el('div', { class: 'v', text: v }), el('div', { class: 'l', text: l })));
    kpi(fmt(s.kwp, 2) + ' kWp', 'Solarleistung');
    kpi(fmt(s.year.pvGen, 0) + ' kWh', 'Solarertrag pro Jahr');
    if (s.bank) kpi(`${fmt(s.usableWh / 1000, 1)} kWh`, `Speicher nutzbar (${fmt(s.capWh / 1000, 1)} kWh Nenn)`);
    kpi(fmt(s.avgDailyDemand / 1000, 2) + ' kWh', 'Verbrauch pro Tag (Ø)');
    if (s.island) {
      if (s.coverage !== null) kpi(fmt(s.coverage * 100, 0) + ' %', 'Bedarf gedeckt (Jahr)');
      if (s.autonomyDays !== null && s.bank) kpi(fmt(s.autonomyDays, 1) + ' Tage', 'Autonomie ohne Sonne');
    } else {
      if (s.selfConsumption !== null) kpi(fmt(s.selfConsumption * 100, 0) + ' %', 'Eigenverbrauch');
      if (s.autarky !== null) kpi(fmt(s.autarky * 100, 0) + ' %', 'Autarkie');
      kpi(fmt(s.savings, 0) + ' €', 'Ersparnis pro Jahr');
      if (s.savings > 0 && A.totalCost > 0) kpi(fmt(A.totalCost / s.savings, 1) + ' Jahre', 'Amortisation (Material)');
    }
    kids.push(el('div', { class: 'kpis' }, k));
    if (s.kwp || s.year.demand) {
      kids.push(monthChart(s));
      kids.push(el('div', { class: 'chart-legend' }, el('span', {}, el('i', { class: 'lg-pv' }), 'Solarertrag'), el('span', {}, el('i', { class: 'lg-load' }), 'Bedarf'), el('span', {}, el('i', { class: 'lg-miss' }), s.island ? 'fehlt' : 'Netzbezug'), el('span', { text: 'je Tag (kWh), typischer Tag je Monat' })));
    }
  });
  kids.push(el('p', { class: 'muted small', text: `Standort: ${A.location.name} – ${fmt(A.location.annual)} kWh/kWp bei optimaler Ausrichtung${A.location.override ? ' (eigene Angabe)' : ''}.` }));

  const counts = {};
  for (const f of A.findings) counts[f.sev] = (counts[f.sev] || 0) + 1;
  const filters = [['all', 'Alle'], ['error', 'Fehler'], ['warn', 'Warnungen'], ['tip', 'Tipps'], ['ok', 'OK'], ['info', 'Info']];
  kids.push(el('div', { class: 'p-sec', text: 'Prüfung & Empfehlungen' }));
  const autoCount = A.findings.filter((f) => f.auto && !f.auto.manual && !['rebuild', 'addModules'].includes(f.auto.op)).length;
  if (autoCount) kids.push(el('button', { class: 'btn primary auto-all', type: 'button', text: `✨ Alles automatisch korrigieren (${autoCount})`,
    title: 'Wendet nacheinander alle Auto-Korrekturen an. Mit Strg+Z lässt sich alles in einem Schritt zurücknehmen.', onclick: applyAll }));
  kids.push(el('div', { class: 'filters' }, filters.filter(([k]) => k === 'all' || counts[k]).map(([k, l]) => el('button', { class: 'chip' + (state.filter === k ? ' on' : ''), type: 'button', text: `${l} ${k === 'all' ? A.findings.length : counts[k]}`, onclick: () => { state.filter = k; renderAnalysis(); } }))));
  const list = A.findings.filter((f) => state.filter === 'all' || f.sev === state.filter);
  if (!list.length) kids.push(el('p', { class: 'muted', text: 'Keine Einträge.' }));
  for (const f of list) kids.push(findingEl(f, f.sev === 'error'));

  if (state.project.wires.length) {
    kids.push(el('div', { class: 'p-sec', text: 'Kabel' }));
    const rows = state.project.wires.map((w) => {
      const r = A.wires[w.id]; if (!r) return null;
      const a = instById(w.a.inst), b = instById(w.b.inst);
      const nm = (i) => (i.label || productOf(i).name).replace(/ \(Beispiel\)$/, '');
      return el('tr', { class: 'click', onclick: () => focusRef(w.id) },
        el('td', { text: `${nm(a)} → ${nm(b)}` }), el('td', { class: 'n', text: fmt(r.area) }), el('td', { class: 'n', text: fmt(r.len, 1) }), el('td', { class: 'n', text: fmt(r.I, 1) }),
        el('td', { class: 'n st-' + r.status, text: fmt(r.pct, 2) }));
    });
    kids.push(el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, el('th', { text: 'Verbindung' }), el('th', { text: 'mm²' }), el('th', { text: 'm' }), el('th', { text: 'A' }), el('th', { text: 'ΔU %' }))), el('tbody', {}, rows)));
  }
  if (A.bom.length) {
    kids.push(el('div', { class: 'p-sec', text: 'Stückliste' }));
    const rows = A.bom.map((b) => el('tr', {},
      el('td', {}, b.url ? el('a', { href: b.url, target: '_blank', rel: 'noopener noreferrer', text: b.name }) : b.name),
      el('td', { class: 'n', text: `${fmt(b.qty, b.unit === 'm' ? 1 : 0)} ${b.unit}` }),
      el('td', { class: 'n', text: b.price !== null ? fmt(b.price * b.qty, 2) + ' €' : '–' })));
    rows.push(el('tr', {}, el('td', {}, el('strong', { text: 'Summe' })), el('td'), el('td', { class: 'n' }, el('strong', { text: fmt(A.totalCost, 2) + ' €' }))));
    kids.push(el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, el('th', { text: 'Bauteil' }), el('th', { text: 'Menge' }), el('th', { text: 'Preis' }))), el('tbody', {}, rows)));
    if (A.missingPrices) kids.push(el('p', { class: 'muted small', text: `${A.missingPrices} Position(en) ohne Preis – Preise lassen sich am Bauteil hinterlegen.` }));
  }
  box.replaceChildren(...kids);
}

// ---------- Projekt-Reiter ----------
function renderProjectTab() {
  const s = state.project.settings;
  $('#setPlz').value = s.plz || '';
  $('#setCoords').value = s.coords || '';
  $('#setYield').value = s.yieldOverride || '';
  $('#setTmin').value = s.tMin;
  $('#setAutonomy').value = s.autonomy;
  $('#setBattPrefStart').value = s.battPrefStart !== undefined ? s.battPrefStart : 0;
  $('#setBattPrefEnd').value = s.battPrefEnd !== undefined ? s.battPrefEnd : 24;
  $('#setNotes').value = state.project.notes || '';
  updateRegion();
  renderPlanTab();
}
function updateRegion() {
  const loc = E.location(state.project.settings);
  const bad = String(state.project.settings.coords || '').trim() && loc.lat === null;
  $('#setRegion').textContent = `Region: ${loc.name} · ${fmt(loc.annual)} kWh pro kWp und Jahr (optimal ausgerichtet)` + (bad ? ' · Koordinaten nicht erkannt (Format: 50.12, 8.68)' : '');
}
const bindSetting = (id, key, num) => $(id).addEventListener('change', () => {
  const v = $(id).value;
  state.project.settings[key] = num ? (v === '' ? '' : Number(v)) : v.trim();
  if (key === 'tMin' && state.project.settings.tMin === '') state.project.settings.tMin = -10;
  if (key === 'autonomy' && state.project.settings.autonomy === '') state.project.settings.autonomy = 2;
  if (key === 'battPrefStart' && state.project.settings.battPrefStart === '') state.project.settings.battPrefStart = 0;
  if (key === 'battPrefEnd' && state.project.settings.battPrefEnd === '') state.project.settings.battPrefEnd = 24;
  setDirty(true); updateRegion(); scheduleAnalysis();
});
bindSetting('#setPlz', 'plz'); bindSetting('#setCoords', 'coords');
// Standort über den Browser. Achtung: Firefox fragt dafür einen Ortungsdienst im Internet an (WLAN-Umgebung) – nur auf Knopfdruck.
$('#btnGeo').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Der Browser kann den Standort nicht ermitteln', true);
  navigator.geolocation.getCurrentPosition((p) => {
    state.project.settings.coords = `${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}`;
    $('#setCoords').value = state.project.settings.coords;
    setDirty(true); updateRegion(); scheduleAnalysis();
  }, () => toast('Standort nicht verfügbar – Koordinaten bitte von Hand eintragen (z. B. aus Google Maps: Rechtsklick auf den Ort)', true), { timeout: 10000 });
}); bindSetting('#setYield', 'yieldOverride', true); bindSetting('#setTmin', 'tMin', true); bindSetting('#setAutonomy', 'autonomy', true);
bindSetting('#setBattPrefStart', 'battPrefStart', true); bindSetting('#setBattPrefEnd', 'battPrefEnd', true);
$('#setNotes').addEventListener('change', () => { state.project.notes = $('#setNotes').value; setDirty(true); });
$('#projName').addEventListener('input', () => setDirty(true));

// ---------- Projekt-Aktionen ----------
$('#btnSave').addEventListener('click', () => save(false));
$('#btnSaveAs').addEventListener('click', () => save(true));
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);
function setMarqueeMode(on) {
  state.marqueeMode = on;
  $('#marqueeToggle').checked = on;
  canvas.classList.toggle('marquee-mode', on);
  if (!on) { state.multiSel.clear(); renderCanvas(); renderProps(); }
}
$('#marqueeToggle').addEventListener('change', () => setMarqueeMode($('#marqueeToggle').checked));
$('#btnNew').addEventListener('click', () => { if (confirmDiscard()) { loadProject(emptyProject()); state.zoom = ZOOM_BASE; state.panX = 80; state.panY = 80; applyView(); } });
$('#btnOpen').addEventListener('click', async () => {
  try {
    const list = await api('GET', '/api/projects');
    const box = $('#openList');
    box.replaceChildren(...(list.length ? list.map((p) => el('div', { class: 'open-row' },
      el('div', { class: 'nm' }, el('strong', { text: p.name }), el('span', { text: `${p.parts} Bauteile · zuletzt ${new Date(p.updated).toLocaleString('de-DE')}` })),
      el('button', { class: 'btn small primary', type: 'button', text: 'Öffnen', onclick: async () => {
        if (!confirmDiscard()) return;
        try { loadProject(await api('GET', '/api/projects/' + p.id)); $('#openModal').hidden = true; } catch (e) { toast(e.message, true); }
      } }),
      el('button', { class: 'btn small danger', type: 'button', text: 'Löschen', onclick: async () => {
        if (!confirm(`„${p.name}" endgültig löschen?`)) return;
        try { await api('DELETE', '/api/projects/' + p.id); if (state.project.id === p.id) state.project.id = null; $('#btnOpen').click(); } catch (e) { toast(e.message, true); }
      } }))) : [el('p', { class: 'muted', text: 'Noch nichts gespeichert.' })]));
    $('#openModal').hidden = false;
  } catch (e) { toast(e.message, true); }
});
$('#btnExport').addEventListener('click', () => {
  const p = projectForSave();
  const blob = new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: (p.name || 'energiesystem').replace(/[^\wäöüÄÖÜß -]+/g, '_') + '.json' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#fileImport').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !confirmDiscard()) return;
  try {
    const p = JSON.parse(await f.text());
    if (!Array.isArray(p.instances) || !Array.isArray(p.wires)) throw new Error('Keine gültige System-Datei');
    p.id = null;
    loadProject(p); setDirty(true);
    toast('Importiert – zum Behalten speichern');
  } catch (err) { toast('Import fehlgeschlagen: ' + err.message, true); }
});
window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('resize', applyView);

// ---------- Start ----------
(async function init() {
  try { await loadLibrary(); } catch (e) { toast('Bibliothek konnte nicht geladen werden: ' + e.message, true); }
  loadProject(emptyProject());
})();

// ---------- Bauplan im Hintergrund ----------
// Der Plan liegt als Bild in Weltkoordinaten (cm) unter dem Raster. PDFs rendert pdf.js (lokal unter vendor/) im Browser
// zu einem Bild; der Server speichert nur das Bild. Maßstab: über „1 : x" (PDF, Papiergröße bekannt) oder zwei Punkte.
const PDFJS = '/vendor/pdfjs/';
let planDrag = null;
let planCalib = null; // { pts: [] }
let planPdfData = null; // zuletzt geladenes PDF (für Seitenwechsel)

function renderPlan() {
  const layer = $('#planLayer');
  const pl = state.project.plan;
  if (!pl || pl.hidden) return layer.replaceChildren();
  const img = svg('image', { id: 'planImg', href: '/plans/' + pl.file, x: pl.x, y: pl.y, width: pl.w, height: pl.h, preserveAspectRatio: 'none', opacity: pl.opacity, class: pl.locked ? 'plan locked' : 'plan' });
  const kids = [img];
  if (!pl.locked) kids.push(svg('rect', { class: 'plan-frame', x: pl.x, y: pl.y, width: pl.w, height: pl.h, 'pointer-events': 'none' }));
  layer.replaceChildren(...kids);
}

function renderPlanTab() {
  const pl = state.project.plan;
  $('#planBox').hidden = !pl;
  if (!pl) return;
  $('#planInfo').textContent = `${pl.name || 'Bauplan'} · ${fmt(pl.w / 100, 2)} × ${fmt(pl.h / 100, 2)} m auf der Fläche`;
  $('#planScale').value = pl.scale || '';
  $('#planScale').disabled = !pl.paperW;
  $('#planPage').value = pl.page || 1;
  $('#planPage').closest('label').hidden = !pl.pdf;
  $('#planScaleHint').textContent = pl.paperW
    ? `Papierformat ${fmt(pl.paperW, 0)} × ${fmt(pl.paperH, 0)} mm. Der Maßstab steht meist im Plankopf (z. B. 1:50 oder 1:100). Zur Kontrolle eine bemaßte Strecke mit „Maßstab über 2 Punkte" nachmessen.`
    : 'Bild ohne Papiergröße: Maßstab über zwei Punkte mit bekanntem Abstand festlegen.';
  $('#planOpacity').value = pl.opacity;
  $('#planLocked').checked = pl.locked;
  $('#planHidden').checked = pl.hidden;
}

function planChanged() { setDirty(true); renderCanvas(); renderPlanTab(); }

// Größe aus Papierformat und Maßstab: 1 mm auf dem Papier = Maßstab mm in echt; Welt in cm
function applyPlanScale(scale) {
  const pl = state.project.plan;
  if (!pl || !pl.paperW || !(scale > 0)) return;
  pl.scale = scale;
  pl.w = pl.paperW * scale / 10;
  pl.h = pl.paperH * scale / 10;
  planChanged();
}

async function loadPdfJs() {
  const lib = await import(PDFJS + 'pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  return lib;
}
// PDF-Seite als PNG (lange Seite max. 4000 px) + Papiergröße in mm
async function pdfPageToPng(data, pageNo) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data, cMapUrl: PDFJS + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS + 'standard_fonts/', isEvalSupported: false }).promise;
  const n = Math.min(Math.max(1, pageNo || 1), doc.numPages);
  const page = await doc.getPage(n);
  const vp1 = page.getViewport({ scale: 1 }); // in pt (1/72 Zoll)
  const scale = Math.min(4000 / Math.max(vp1.width, vp1.height), 300 / 72);
  const vp = page.getViewport({ scale });
  const cv = document.createElement('canvas');
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  return { blob, pxW: cv.width, pxH: cv.height, paperW: vp1.width / 72 * 25.4, paperH: vp1.height / 72 * 25.4, pages: doc.numPages, page: n };
}
function imageSize(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => { res({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(url); };
    im.onerror = () => { rej(new Error('Bild konnte nicht gelesen werden')); URL.revokeObjectURL(url); };
    im.src = url;
  });
}
async function uploadPlan(blob) {
  const r = await fetch('/api/plans', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Hochladen fehlgeschlagen');
  return j.file;
}

async function loadPlanFile(file, pageNo) {
  try {
    toast('Bauplan wird geladen …');
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const old = state.project.plan;
    let pl;
    if (isPdf) {
      planPdfData = new Uint8Array(await file.arrayBuffer());
      const r = await pdfPageToPng(planPdfData.slice(), pageNo);
      const up = await uploadPlan(r.blob);
      const scale = old && old.pdf && old.scale ? old.scale : 100;
      pl = { file: up, name: file.name, pdf: true, page: r.page, pages: r.pages, pxW: r.pxW, pxH: r.pxH, paperW: r.paperW, paperH: r.paperH, scale, w: r.paperW * scale / 10, h: r.paperH * scale / 10 };
    } else {
      planPdfData = null;
      if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('Bitte PDF, PNG oder JPG wählen');
      const sz = await imageSize(file);
      const up = await uploadPlan(file);
      pl = { file: up, name: file.name, pdf: false, page: 1, pxW: sz.w, pxH: sz.h, paperW: 0, paperH: 0, scale: 0, w: 1000, h: 1000 * sz.h / sz.w };
    }
    // Lage: einen vorhandenen Plan ersetzen (Ursprung behalten), sonst bei 0/0
    pl.x = old ? old.x : 0; pl.y = old ? old.y : 0;
    pl.opacity = old ? old.opacity : 0.35; pl.locked = false; pl.hidden = false;
    state.project.plan = pl;
    planChanged();
    if (!state.project.instances.length) fitView();
    toast(pl.pdf ? `Bauplan geladen – Maßstab 1:${pl.scale} angenommen, bitte prüfen` : 'Bauplan geladen – jetzt den Maßstab über 2 Punkte festlegen');
  } catch (e) { toast(e.message, true); }
}

$('#planFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadPlanFile(f, 1); });
$('#planScale').addEventListener('change', () => applyPlanScale(Number($('#planScale').value)));
$('#planPage').addEventListener('change', async () => {
  const pl = state.project.plan;
  if (!pl || !pl.pdf) return;
  if (!planPdfData) return toast('Für einen Seitenwechsel das PDF bitte noch einmal laden', true);
  await loadPlanFile(new File([planPdfData], pl.name, { type: 'application/pdf' }), Number($('#planPage').value) || 1);
});
$('#planOpacity').addEventListener('input', () => { if (state.project.plan) { state.project.plan.opacity = Number($('#planOpacity').value); setDirty(true); renderPlan(); } });
$('#planLocked').addEventListener('change', () => { if (state.project.plan) { state.project.plan.locked = $('#planLocked').checked; planChanged(); } });
$('#planHidden').addEventListener('change', () => { if (state.project.plan) { state.project.plan.hidden = $('#planHidden').checked; planChanged(); } });
$('#planRemove').addEventListener('click', () => { if (state.project.plan && confirm('Bauplan aus diesem System entfernen?')) { state.project.plan = null; planChanged(); } });
$('#planCalib').addEventListener('click', () => {
  if (!state.project.plan) return;
  planCalib = { pts: [] };
  canvas.classList.add('calib');
  toast('Ersten Punkt auf dem Plan anklicken (z. B. Anfang einer bemaßten Wand) – Esc bricht ab');
});

function calibMarkers() {
  const k = [];
  for (const p of planCalib.pts) k.push(svg('circle', { class: 'calib-pt', cx: p.x, cy: p.y, r: 6 / state.zoom }));
  if (planCalib.pts.length === 2) k.push(svg('line', { class: 'calib-line', x1: planCalib.pts[0].x, y1: planCalib.pts[0].y, x2: planCalib.pts[1].x, y2: planCalib.pts[1].y }));
  $('#tempLayer').replaceChildren(...k);
}
function endCalib() { planCalib = null; canvas.classList.remove('calib'); $('#tempLayer').replaceChildren(); }
// Zwei Punkte mit bekannter echter Länge: Plan so skalieren, dass der Abstand stimmt (um den ersten Punkt)
function finishCalib(meters) {
  const pl = state.project.plan;
  const [a, b] = planCalib.pts;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (pl && meters > 0 && dist > 0) {
    const f = meters * 100 / dist;
    pl.x = a.x - (a.x - pl.x) * f; pl.y = a.y - (a.y - pl.y) * f;
    pl.w *= f; pl.h *= f;
    if (pl.paperW) pl.scale = Math.round(pl.w * 10 / pl.paperW);
    planChanged();
    toast(`Maßstab gesetzt: Strecke = ${fmt(meters, 2)} m${pl.paperW ? ` (entspricht ca. 1:${pl.scale})` : ''}`);
  }
  endCalib();
}

// Diese Handler laufen vor den übrigen Zeiger-Handlern der Fläche (Capture): Kalibrieren und Plan verschieben
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const pl = state.project.plan;
  if (planCalib) {
    e.stopImmediatePropagation();
    planCalib.pts.push(toWorld(e.clientX, e.clientY));
    calibMarkers();
    if (planCalib.pts.length === 1) return toast('Zweiten Punkt anklicken');
    setTimeout(() => {
      const txt = prompt('Wie lang ist diese Strecke in Wirklichkeit? (in Metern, z. B. 4,25)', '');
      finishCalib(Number(String(txt || '').replace(',', '.')));
    }, 30);
    return;
  }
  if (pl && !pl.locked && !pl.hidden && e.target.id === 'planImg') {
    e.stopImmediatePropagation();
    const w = toWorld(e.clientX, e.clientY);
    planDrag = { ox: w.x - pl.x, oy: w.y - pl.y, moved: false };
    canvas.setPointerCapture(e.pointerId);
  }
}, true);
canvas.addEventListener('pointermove', (e) => {
  if (!planDrag) return;
  e.stopImmediatePropagation();
  const pl = state.project.plan;
  const w = toWorld(e.clientX, e.clientY);
  pl.x = Math.round(w.x - planDrag.ox); pl.y = Math.round(w.y - planDrag.oy); planDrag.moved = true;
  renderPlan();
}, true);
canvas.addEventListener('pointerup', (e) => {
  if (!planDrag) return;
  e.stopImmediatePropagation();
  if (planDrag.moved) setDirty(true); else select(null);
  planDrag = null;
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && planCalib) { endCalib(); toast('Maßstab festlegen abgebrochen'); } });

// ---------- PDF-Export (Plan + Teileliste) ----------
// Druckansicht im selben Fenster; „Als PDF speichern" im Druckdialog erzeugt die PDF-Datei. Keine PDF-Bibliothek nötig.
const eur = (v) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
function exportPdf() {
  runAnalysis();
  const A = state.analysis;
  const P = state.project;
  const name = $('#projName').value.trim() || 'Energiesystem';
  const today = new Date().toLocaleDateString('de-DE');
  // Plan: Welt-Ebene klonen, Ausschnitt = alle Bauteile (+ Bauplan)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of P.instances) { const t = typeOf(i); if (!t) continue; const s = E.instSize(i, t); x0 = Math.min(x0, i.x - s.w / 2); y0 = Math.min(y0, i.y - s.h / 2); x1 = Math.max(x1, i.x + s.w / 2); y1 = Math.max(y1, i.y + s.h / 2); }
  const pl = P.plan && !P.plan.hidden ? P.plan : null;
  if (pl) { x0 = Math.min(x0, pl.x); y0 = Math.min(y0, pl.y); x1 = Math.max(x1, pl.x + pl.w); y1 = Math.max(y1, pl.y + pl.h); }
  const kids = [];
  kids.push(el('div', { class: 'pr-head' }, el('div', {}, el('h1', { text: name }), el('div', { class: 'pr-sub', text: `Energiemanagement · Stand ${today}` })),
    el('div', { class: 'pr-sub', text: E.location(P.settings).name })));
  if (isFinite(x0)) {
    const pad = 15;
    const sv = svg('svg', { class: 'pr-plan', viewBox: `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`, preserveAspectRatio: 'xMidYMid meet' });
    const world = $('#world').cloneNode(true);
    world.removeAttribute('id'); world.removeAttribute('transform');
    for (const n of world.querySelectorAll('#gridRect, #tempLayer, .plan-frame')) n.remove();
    for (const n of world.querySelectorAll('[id]')) n.removeAttribute('id');
    for (const n of world.querySelectorAll('image')) n.setAttribute('opacity', Math.max(0.5, Number(n.getAttribute('opacity')) || 0.5));
    sv.append(world);
    kids.push(sv);
    const s0 = (A.systems || [])[0];
    const facts = [];
    if (s0) {
      if (s0.kwp) facts.push(['Solarleistung', fmt(s0.kwp, 2) + ' kWp']);
      if (s0.capWh) facts.push(['Speicher', `${fmt(s0.usableWh / 1000, 1)} kWh nutzbar (${fmt(s0.capWh / 1000, 1)} kWh Nenn)`]);
      if (s0.sysV) facts.push(['Systemspannung', fmt(s0.sysV) + ' V']);
      if (s0.coverage !== undefined && s0.coverage !== null) facts.push(['Bedarf gedeckt', fmt(s0.coverage * 100, 0) + ' %']);
    }
    if (pl && pl.scale) facts.push(['Bauplan', `${pl.name} · Maßstab 1:${pl.scale}`]);
    facts.push(['Teile / Verbindungen', `${P.instances.length} / ${P.wires.length}`]);
    kids.push(el('dl', { class: 'pr-facts' }, facts.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])));
  } else kids.push(el('p', { text: 'Noch keine Bauteile auf der Fläche.' }));
  // Teileliste
  const list = el('section', { class: 'pr-page' }, el('h2', { text: 'Teileliste' }));
  if (A.bom.length) {
    const rows = A.bom.map((b) => el('tr', {},
      el('td', { text: (C.types[b.type] || {}).label || b.type }),
      el('td', { text: b.name.replace(/ \(Beispiel\)$/, '') }),
      el('td', { class: 'n', text: b.unit === 'm' ? fmt(b.qty, 1) + ' m' : fmt(b.qty) + ' Stk' }),
      el('td', { class: 'n', text: b.price !== null ? eur(b.price) : '–' }),
      el('td', { class: 'n', text: b.price !== null ? eur(b.price * b.qty) : '–' }),
      el('td', { class: 'url', text: b.url || '' })));
    list.append(el('table', { class: 'pr-table' },
      el('thead', {}, el('tr', {}, ['Art', 'Bezeichnung', 'Menge', 'Einzelpreis', 'Summe', 'Produkt-Link'].map((h) => el('th', { text: h })))),
      el('tbody', {}, rows),
      el('tfoot', {}, el('tr', {}, el('td', { colspan: 4, text: 'Summe Material' + (A.missingPrices ? ` (${A.missingPrices} Position(en) ohne Preis)` : '') }), el('td', { class: 'n', text: eur(A.totalCost) }), el('td')))));
    list.append(el('p', { class: 'pr-note', text: 'Kabellängen aus der Zeichnung bzw. eigener Angabe, ohne Verschnitt. Preise laut Bibliothek.' }));
  } else list.append(el('p', { text: 'Keine Teile.' }));
  // offene Hinweise
  const open = A.findings.filter((f) => f.sev === 'error' || f.sev === 'warn' || f.sev === 'tip');
  if (open.length) {
    list.append(el('h2', { text: 'Offene Hinweise' }));
    list.append(el('ul', { class: 'pr-findings' }, open.map((f) => el('li', {}, el('strong', { text: `${SEV_LABEL[f.sev]}: ${f.title}` }), f.text ? ' – ' + f.text : ''))));
  }
  list.append(el('p', { class: 'pr-note', text: 'Planungshilfe mit Näherungswerten – ersetzt keine Prüfung durch eine Elektrofachkraft.' }));
  kids.push(list);
  const view = $('#printView');
  view.replaceChildren(...kids);
  const done = () => { view.replaceChildren(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
$('#btnPdf').addEventListener('click', exportPdf);
