// Energiemanagement – lokaler Server
// Baukasten für Energiesysteme: Bauteil-Bibliothek und Projekte als JSON im Ordner data\.
// Läuft portabel (USB-Stick): alle Pfade relativ zum Programmordner.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./public/js/catalog.js');

const PORT = Number(process.env.PORT) || 3490;
const HOST = '127.0.0.1';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const LIB_FILE = path.join(DATA_DIR, 'library.json');
const PROJ_DIR = path.join(DATA_DIR, 'projects');
const PLAN_DIR = path.join(DATA_DIR, 'plans'); // Baupläne als Bild (PDFs rendert der Browser vorher selbst)
const MAX_PLAN = 30 * 1024 * 1024;
const PLAN_RE = /^plan-[a-f0-9]{12}\.(png|jpg)$/;
const MAX_BODY = 4 * 1024 * 1024;
const ID_RE = /^[a-z0-9-]{3,40}$/;

fs.mkdirSync(PROJ_DIR, { recursive: true });
fs.mkdirSync(PLAN_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mjs': 'text/javascript; charset=utf-8',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; connect-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const err = (status, msg) => Object.assign(new Error(msg), { status });

// ---------- Speicher ----------

function writeJson(file, data) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1));
  fs.renameSync(file + '.tmp', file);
}

// Liste der Standard-Bauteile, die die Bibliothek schon kennt – neue Standard-Bauteile (spätere Versionen)
// werden automatisch ergänzt, vom Nutzer gelöschte kommen aber nicht zurück.
const KNOWN_FILE = path.join(DATA_DIR, 'library-known.json');
let libChecked = false;
function loadLibrary() {
  if (!fs.existsSync(LIB_FILE)) {
    writeJson(LIB_FILE, C.defaultLibrary);
    writeJson(KNOWN_FILE, C.defaultLibrary.map((p) => p.id));
  }
  const lib = JSON.parse(fs.readFileSync(LIB_FILE, 'utf8'));
  if (!libChecked) {
    libChecked = true;
    const known = new Set(fs.existsSync(KNOWN_FILE) ? JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8')) : lib.map((p) => p.id));
    const have = new Set(lib.map((p) => p.id));
    const fresh = C.defaultLibrary.filter((p) => !known.has(p.id) && !have.has(p.id));
    if (fresh.length) { lib.push(...fresh); writeJson(LIB_FILE, lib); console.log(`${fresh.length} neue Standard-Bauteile in die Bibliothek übernommen.`); }
    writeJson(KNOWN_FILE, C.defaultLibrary.map((p) => p.id).concat([...known]).filter((v, i, a) => a.indexOf(v) === i));
  }
  return lib;
}

function saveProduct(id, body) {
  const lib = loadLibrary();
  const p = C.sanitizeProduct({ ...body, id });
  if (!id) p.id = 'u-' + crypto.randomBytes(5).toString('hex');
  else if (!ID_RE.test(id)) throw err(400, 'Ungültige ID');
  p.updated = new Date().toISOString();
  const i = lib.findIndex((x) => x.id === p.id);
  if (i >= 0) { if (lib[i].type !== p.type) throw err(400, 'Der Bauteiltyp lässt sich nicht ändern'); lib[i] = p; } else lib.push(p);
  writeJson(LIB_FILE, lib);
  return p;
}

function deleteProduct(id) {
  const lib = loadLibrary();
  const i = lib.findIndex((x) => x.id === id);
  if (i < 0) throw err(404, 'Bauteil nicht gefunden');
  lib.splice(i, 1);
  writeJson(LIB_FILE, lib);
}

function restoreDefaults() {
  const lib = loadLibrary();
  const have = new Set(lib.map((x) => x.id));
  let added = 0;
  for (const p of C.defaultLibrary) if (!have.has(p.id)) { lib.push(p); added++; }
  writeJson(LIB_FILE, lib);
  return added;
}

const projFile = (id) => {
  if (!ID_RE.test(id)) throw err(400, 'Ungültige ID');
  return path.join(PROJ_DIR, id + '.json');
};

function listProjects() {
  const out = [];
  for (const f of fs.readdirSync(PROJ_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(PROJ_DIR, f), 'utf8'));
      out.push({ id: p.id, name: p.name, updated: p.updated, parts: (p.instances || []).length });
    } catch { /* defekte Datei überspringen */ }
  }
  return out.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
}

function cleanProject(b) {
  if (!b || typeof b !== 'object') throw err(400, 'Ungültiges Projekt');
  const name = String(b.name || '').trim().slice(0, 100) || 'Unbenanntes System';
  const instances = Array.isArray(b.instances) ? b.instances.slice(0, 3000) : [];
  const wires = Array.isArray(b.wires) ? b.wires.slice(0, 6000) : [];
  for (const i of instances) if (!i || typeof i.id !== 'string' || !Number.isFinite(i.x) || !Number.isFinite(i.y)) throw err(400, 'Ungültiges Bauteil im Projekt');
  for (const w of wires) if (!w || typeof w.id !== 'string' || !w.a || !w.b) throw err(400, 'Ungültiges Kabel im Projekt');
  return {
    name, instances, wires,
    settings: b.settings && typeof b.settings === 'object' ? b.settings : {},
    view: b.view && typeof b.view === 'object' ? b.view : {},
    notes: String(b.notes || '').slice(0, 5000),
    plan: cleanPlan(b.plan),
  };
}

// Bauplan im Hintergrund: Datei + Lage/Größe in cm (Weltkoordinaten), Deckkraft, gesperrt
function cleanPlan(pl) {
  if (!pl || typeof pl !== 'object' || !PLAN_RE.test(String(pl.file || ''))) return null;
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    file: pl.file, name: String(pl.name || '').slice(0, 200), page: n(pl.page, 1),
    x: n(pl.x, 0), y: n(pl.y, 0), w: Math.max(1, n(pl.w, 1000)), h: Math.max(1, n(pl.h, 700)),
    pxW: n(pl.pxW, 0), pxH: n(pl.pxH, 0), paperW: n(pl.paperW, 0), paperH: n(pl.paperH, 0), scale: n(pl.scale, 0),
    opacity: Math.min(1, Math.max(0.05, n(pl.opacity, 0.35))), locked: Boolean(pl.locked), hidden: Boolean(pl.hidden),
  };
}

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(err(413, 'Datei zu groß')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function savePlan(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0];
  const ext = type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : null;
  if (!ext) throw err(415, 'Nur PNG oder JPG (PDFs wandelt der Browser vorher um)');
  const buf = await readRaw(req, MAX_PLAN);
  // Inhalt prüfen, nicht nur den Header
  const ok = ext === 'png' ? buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) : buf[0] === 0xff && buf[1] === 0xd8;
  if (!ok) throw err(415, 'Datei ist kein gültiges Bild');
  const file = 'plan-' + crypto.randomBytes(6).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(PLAN_DIR, file), buf);
  return { file };
}

function saveProject(id, body) {
  const now = new Date().toISOString();
  const clean = cleanProject(body);
  let p;
  if (id) {
    const f = projFile(id);
    if (!fs.existsSync(f)) throw err(404, 'Projekt nicht gefunden');
    p = { ...JSON.parse(fs.readFileSync(f, 'utf8')), ...clean };
  } else {
    p = { id: 'p-' + crypto.randomBytes(5).toString('hex'), created: now, ...clean };
  }
  p.updated = now;
  writeJson(projFile(p.id), p);
  return p;
}

// ---------- HTTP ----------

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(err(413, 'Anfrage zu groß')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(err(400, 'Ungültiges JSON')); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, file) {
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) return sendJson(res, 404, { error: 'Nicht gefunden' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    fs.createReadStream(file).pipe(res);
  });
}

async function handleApi(req, res, url) {
  const m = req.method, p = url.pathname;
  let r;
  if (p === '/api/library' && m === 'GET') return sendJson(res, 200, loadLibrary());
  if (p === '/api/library' && m === 'POST') return sendJson(res, 200, saveProduct(null, await readJson(req)));
  if (p === '/api/library/restore' && m === 'POST') return sendJson(res, 200, { added: restoreDefaults() });
  if ((r = p.match(/^\/api\/library\/([a-z0-9-]+)$/))) {
    if (m === 'PUT') return sendJson(res, 200, saveProduct(r[1], await readJson(req)));
    if (m === 'DELETE') { deleteProduct(r[1]); return sendJson(res, 200, { ok: true }); }
  }
  if (p === '/api/plans' && m === 'POST') return sendJson(res, 200, await savePlan(req));
  if (p === '/api/projects' && m === 'GET') return sendJson(res, 200, listProjects());
  if (p === '/api/projects' && m === 'POST') return sendJson(res, 200, saveProject(null, await readJson(req)));
  if ((r = p.match(/^\/api\/projects\/([a-z0-9-]+)$/))) {
    const f = projFile(r[1]);
    if (m === 'GET') { if (!fs.existsSync(f)) throw err(404, 'Projekt nicht gefunden'); return sendJson(res, 200, JSON.parse(fs.readFileSync(f, 'utf8'))); }
    if (m === 'PUT') return sendJson(res, 200, saveProject(r[1], await readJson(req)));
    if (m === 'DELETE') { if (!fs.existsSync(f)) throw err(404, 'Projekt nicht gefunden'); fs.unlinkSync(f); return sendJson(res, 200, { ok: true }); }
  }
  return sendJson(res, 404, { error: 'Unbekannter Endpunkt' });
}

const server = http.createServer(async (req, res) => {
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) { res.writeHead(403); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && !ALLOWED_HOSTS.has(origin.replace(/^http:\/\//, ''))) return sendJson(res, 403, { error: 'Fremder Ursprung' });
    try { await handleApi(req, res, url); } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(new Date().toISOString(), req.method, url.pathname, e.message);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Interner Fehler' : e.message });
    }
    return;
  }
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Methode nicht erlaubt' });
  const pm = url.pathname.match(/^\/plans\/([^/]+)$/);
  if (pm) return PLAN_RE.test(pm[1]) ? serveFile(res, path.join(PLAN_DIR, pm[1])) : sendJson(res, 404, { error: 'Nicht gefunden' });
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 404, { error: 'Nicht gefunden' });
  serveFile(res, file);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} ist belegt – läuft das Energiemanagement schon?`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Energiemanagement läuft: http://localhost:${PORT}/`);
  console.log('Dieses Fenster offen lassen, solange die App benutzt wird.');
});
