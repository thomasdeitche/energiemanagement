// Berechnungs-Engine: Verschaltung erkennen, prüfen, simulieren, Empfehlungen mit Begründung.
// Läuft im Browser (window.EM_ENGINE) und unter Node (require) – ohne DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog.js'));
  else root.EM_ENGINE = factory(root.EM_CATALOG);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const fmt = C.fmt;
  const STD_V = [12, 24, 48];
  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const MONTH_SHARE = norm([2.4, 4.4, 8.0, 11.4, 13.2, 13.3, 14.0, 12.2, 9.0, 6.3, 3.4, 2.0]);
  const DAYLEN = [8.2, 9.8, 11.8, 13.8, 15.5, 16.4, 15.9, 14.4, 12.5, 10.4, 8.7, 7.8];
  const NOON = [12.3, 12.3, 12.3, 13.3, 13.3, 13.3, 13.3, 13.3, 13.3, 13.3, 12.3, 12.3];
  // Jahresertrag kWh/kWp (optimale Ausrichtung) nach erster PLZ-Ziffer
  const REGION_YIELD = { 0: 990, 1: 980, 2: 930, 3: 950, 4: 950, 5: 980, 6: 1020, 7: 1070, 8: 1100, 9: 1040 };
  const REGION_NAME = { 0: 'Sachsen / Thüringen', 1: 'Berlin / Brandenburg / Mecklenburg', 2: 'Hamburg / Schleswig-Holstein / Nord-Niedersachsen', 3: 'Niedersachsen / Nordhessen / Ost-Westfalen', 4: 'Nordrhein-Westfalen', 5: 'Rheinland / Rheinland-Pfalz', 6: 'Hessen / Saarland / Pfalz', 7: 'Baden-Württemberg', 8: 'Südbayern', 9: 'Franken / Ostbayern / Südthüringen' };
  // Ausrichtungsfaktor: Neigung × Abweichung von Süd (0, 45, 90, 135, 180°)
  const TILTS = [0, 15, 30, 45, 60, 90];
  const ORIENT = [
    [0.87, 0.87, 0.87, 0.87, 0.87],
    [0.97, 0.94, 0.86, 0.77, 0.72],
    [1.00, 0.95, 0.84, 0.70, 0.62],
    [0.98, 0.93, 0.80, 0.63, 0.52],
    [0.93, 0.88, 0.75, 0.55, 0.42],
    [0.72, 0.68, 0.57, 0.40, 0.28],
  ];
  const DIR_DEV = { S: 0, SO: 45, SW: 45, O: 90, W: 90, NO: 135, NW: 135, N: 180 };
  const HOUSE_PROFILE = {
    haushalt: norm([2.5, 2.2, 2.0, 2.0, 2.0, 2.4, 3.5, 4.5, 4.5, 4.2, 4.2, 4.5, 4.8, 4.5, 4.0, 3.8, 4.0, 5.0, 6.0, 6.5, 6.2, 5.5, 4.5, 3.2]),
    gewerbe: norm([1.5, 1.5, 1.5, 1.5, 1.5, 2, 4, 7, 8, 8, 8, 7.5, 7, 7.5, 7.5, 7, 6, 4, 2.5, 2, 1.5, 1.5, 1.5, 1.5]),
    konstant: norm(new Array(24).fill(1)),
  };
  const HOUSE_MONTH = [1.15, 1.1, 1.05, 0.97, 0.92, 0.88, 0.87, 0.89, 0.94, 1.02, 1.1, 1.16];
  const WINDOW_HOURS = {
    ganztags: range(0, 24), morgen: range(6, 9), tag: range(8, 18), mittag: range(11, 15),
    abend: range(18, 23), nacht: [23, 0, 1, 2, 3, 4, 5],
  };
  const CTRL_SIZES_A = [10, 15, 20, 30, 40, 50, 60, 70, 85, 100, 150, 200];
  const CTRL_SIZES_V = [50, 75, 100, 150, 200, 250, 450];
  // Gemeinsame Auslegungsregeln – Prüfung und Autom. Fertigstellen nutzen dieselben Werte
  const RULES = { invReserve: 1.25, ctrlRatioMax: 1.3, vocMargin: 1.05, mpptMargin: 5 };
  const INV_SIZES = [300, 500, 800, 1000, 1500, 2000, 3000, 5000, 8000, 10000];

  function range(a, b) { const r = []; for (let i = a; i < b; i++) r.push(i); return r; }
  function norm(a) { const s = a.reduce((x, y) => x + y, 0); return a.map((x) => x / s); }
  const num = (v, d) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const stdVolt = (v) => { const s = STD_V.find((x) => Math.abs(v - x) / x <= 0.15); return s || null; };
  const differs = (a, b, tol) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9) > tol;
  const nextSize = (list, v) => list.find((x) => x >= v) || Math.ceil(v);

  // ---------- Geometrie (auch von der Oberfläche genutzt) ----------
  function instSize(inst, t) {
    const rot = ((inst.rot || 0) % 360 + 360) % 360;
    return rot === 90 || rot === 270 ? { w: t.h, h: t.w } : { w: t.w, h: t.h };
  }
  function portGeom(inst, t, port) {
    let x, y, nx, ny;
    const w = t.w, h = t.h;
    if (port.side === 'l') { x = 0; y = port.pos * h; nx = -1; ny = 0; }
    else if (port.side === 'r') { x = w; y = port.pos * h; nx = 1; ny = 0; }
    else if (port.side === 't') { x = port.pos * w; y = 0; nx = 0; ny = -1; }
    else { x = port.pos * w; y = h; nx = 0; ny = 1; }
    let dx = x - w / 2, dy = y - h / 2;
    const rot = ((inst.rot || 0) % 360 + 360) % 360;
    for (let r = 0; r < rot; r += 90) { [dx, dy] = [-dy, dx]; [nx, ny] = [-ny, nx]; }
    return { x: inst.x + dx, y: inst.y + dy, nx, ny };
  }

  // ---------- Hauptfunktion ----------
  // Auto-Korrekturen, die die Anlage neu planen („Autom. Fertigstellen"). Teile im Istbestand bleiben dabei unverändert.
  const REBUILD_BANK = { op: 'rebuild', grow: true, label: 'Batteriebank mit gleichem Typ vergrößern und Anlage neu fertigstellen' };
  const BESTAND_BANK = 'Die Batterien sind als Istbestand markiert – die Automatik ergänzt deshalb keine weiteren. Ohne größere Bank bleibt dieser Hinweis bestehen.';
  // Ladestrom eines Reglers: Datenblatt, begrenzt durch die Einstellung „Ladestrom-Begrenzung" am Bauteil
  const ctrlA = (d, def) => { const m = num(d.product.maxA, def); const lim = num(d.props && d.props.chgLimit, 0); return lim > 0 ? Math.min(m, lim) : m; };
  const isBestand = (list) => (list || []).some((i) => i.bestand);
  // Module gleichen Typs ergänzen, bis die Modulleistung für den Dezember reicht (nicht bei Istbestand-Modulen)
  function modulesAuto(r, needKwp) {
    const mods = r.pvSrc.flatMap((x) => x.g.insts);
    if (!mods.length || isBestand(mods) || !(needKwp > r.kwp)) return null;
    const cnt = {};
    for (const i of mods) cnt[i.productId] = (cnt[i.productId] || 0) + 1;
    const pid = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    const M = mods.find((i) => i.productId === pid).product;
    const n = Math.ceil((needKwp - r.kwp) * 1000 / Math.max(1, Number(M.pmax) || 0));
    if (!(n > 0) || n > 200) return null;
    return { op: 'addModules', productId: pid, count: n, label: `${n} × „${M.name}" ergänzen und Anlage neu fertigstellen` };
  }

  function analyze(project, library) {
    const lib = {};
    for (const p of library || []) lib[p.id] = p;
    const settings = Object.assign({ plz: '', yieldOverride: '', tMin: -10, tCell: 70, autonomy: 2 }, project.settings || {});
    const F = [];
    const add = (sev, title, text, why, fix, refs, auto) => {
      // Istbestand-Teile werden nie automatisch getauscht
      if (auto && auto.op === 'swap' && byId[auto.inst] && byId[auto.inst].bestand) auto = null;
      const f = { sev, title, text: text || '', why: why || [], fix: fix || [], refs: refs || [], auto: auto || null };
      F.push(f);
      return f;
    };
    // ---------- Auswahl passender Bauteile für die Auto-Korrektur ----------
    const libOf = (type) => (library || []).filter((p) => p.type === type);
    const FUSE_SIZES = [10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100, 125, 150, 175, 200, 250, 300, 350, 400, 500];
    const cheapest = (list, by) => list.sort((a, b) => by(a) - by(b) || num(a.price, 1e9) - num(b.price, 1e9))[0] || null;
    function pickController(o) {
      return cheapest(libOf('mppt').filter((p) => (p.ctype || 'mppt') === 'mppt' && num(p.maxVoc, 0) >= o.vocCold * 1.05 && num(p.maxA, 0) >= o.needA &&
        (!o.sysV || String(p.volts || '').split(/[^0-9]+/).map(Number).includes(o.sysV)) && (!num(p.maxIsc, 0) || num(p.maxIsc, 0) >= o.isc)), (p) => num(p.maxA, 0) * 1000 + num(p.maxVoc, 0));
    }
    function pickInverter(vdc, minCont, minPeak) {
      return cheapest(libOf('inverter').filter((p) => Number(p.vdc) === vdc && num(p.pCont, 0) >= minCont && num(p.pPeak, num(p.pCont, 0) * 2) >= (minPeak || 0)), (p) => num(p.pCont, 0));
    }
    // Sicherung: vorhandenes Produkt oder Vorlage für ein neues
    function fuseSpec(kind, minA, maxA, minV, pv) {
      const ok = libOf('fuse').filter((p) => (p.kind || 'dc') === kind && num(p.rated, 0) >= minA && (!maxA || num(p.rated, 0) <= maxA) && (!minV || num(p.maxV, 0) >= minV) && (kind === 'ac' || p.ftype !== 'ls'));
      const best = cheapest(ok, (p) => num(p.rated, 0));
      if (best) return { productId: best.id, name: best.name, rated: num(best.rated, 0) };
      const rated = FUSE_SIZES.find((s) => s >= minA);
      if (!rated || (maxA && rated > maxA)) return null;
      const ftype = kind === 'ac' ? 'ls' : pv ? 'pvfuse' : rated >= 125 ? 'anl' : rated >= 40 ? 'mega' : 'midi';
      const label = { ls: 'LS-Schalter', pvfuse: 'PV-Sicherung', anl: 'ANL-Sicherung', mega: 'MEGA-Sicherung', midi: 'MIDI-Sicherung' }[ftype];
      const maxV = kind === 'ac' ? 400 : minV > 58 ? 1000 : 58;
      return { create: { type: 'fuse', name: `${label} ${rated} A${maxV === 1000 ? ' / 1000 V' : ''}`, kind, rated, maxV, ftype }, name: `${label} ${rated} A`, rated };
    }
    // Kabel: vorhandenes Produkt mit Zielquerschnitt oder Vorlage für ein neues
    const CTYPE_NAME = { solar: 'Solarkabel', batt: 'Batteriekabel', gummi: 'H07RN-F', nym: 'NYM-J', erd: 'Erdkabel' };
    function cableSpec(cab, area) {
      const same = libOf('cable').filter((c) => num(c.area, 0) === area && (c.material || 'cu') === (cab.material || 'cu') && String(c.cores || '1') === String(cab.cores || '1'));
      const best = same.find((c) => c.ctype === cab.ctype) || same[0];
      if (best) return { productId: best.id, name: best.name };
      const cores = String(cab.cores || '1');
      const name = `${CTYPE_NAME[cab.ctype] || 'Kabel'} ${cores !== '1' ? cores + ' × ' : ''}${fmt(area)} mm²${cab.material === 'al' ? ' Alu' : ''}`;
      return { create: { type: 'cable', name, ctype: cab.ctype || 'batt', material: cab.material || 'cu', area, cores }, name };
    }

    // Instanzen auflösen
    const insts = [];
    const byId = {};
    for (const raw of project.instances || []) {
      const product = lib[raw.productId] || raw.product;
      if (!product || !C.types[product.type]) continue;
      const t = C.types[product.type];
      const inst = { ...raw, product, t, type: product.type, props: Object.assign(C.instDefaults(product.type), raw.props || {}) };
      inst.name = raw.label || product.name;
      inst.ports = t.ports(product);
      inst.portMap = {};
      for (const p of inst.ports) inst.portMap[p.id] = p;
      insts.push(inst);
      byId[inst.id] = inst;
    }
    const key = (instId, portId) => instId + '|' + portId;

    // ---------- Graph: Anschlüsse als Knoten, Kabel + interne Verbindungen passiver Bauteile als Kanten ----------
    const nodes = new Map(); // key -> { inst, port }
    for (const i of insts) for (const p of i.ports) nodes.set(key(i.id, p.id), { inst: i, port: p });
    const edges = []; // { id, a, b, kind, wire?, inst? }
    const adj = new Map();
    const link = (e) => { edges.push(e); for (const k of [e.a, e.b]) { if (!adj.has(k)) adj.set(k, []); adj.get(k).push(e); } };

    const wires = [];
    for (const w of project.wires || []) {
      const a = key(w.a.inst, w.a.port), b = key(w.b.inst, w.b.port);
      if (!nodes.has(a) || !nodes.has(b) || a === b) continue;
      const cable = lib[w.cableId] || w.cable || C.defaultLibrary.find((p) => p.type === 'cable');
      const wire = { ...w, ka: a, kb: b, cable };
      wires.push(wire);
      link({ id: 'w:' + w.id, a, b, kind: 'wire', wire });
    }
    for (const i of insts) {
      if (!i.t.passive) continue;
      const ks = i.ports.map((p) => key(i.id, p.id));
      for (let n = 1; n < ks.length; n++) link({ id: 'p:' + i.id + ':' + n, a: ks[0], b: ks[n], kind: i.t.passive, inst: i });
    }
    const connected = (k) => (adj.get(k) || []).some((e) => e.kind === 'wire');

    // Netze (zusammenhängende Anschlüsse)
    const netOf = new Map();
    let netCount = 0;
    for (const k of nodes.keys()) {
      if (netOf.has(k)) continue;
      const id = netCount++;
      const stack = [k];
      netOf.set(k, id);
      while (stack.length) {
        const c = stack.pop();
        for (const e of adj.get(c) || []) {
          const o = e.a === c ? e.b : e.a;
          if (!netOf.has(o)) { netOf.set(o, id); stack.push(o); }
        }
      }
    }
    const netMembers = new Map();
    for (const [k, n] of netOf) { if (!netMembers.has(n)) netMembers.set(n, []); netMembers.get(n).push(k); }
    const N = (inst, portId) => netOf.get(key(inst.id, portId));

    // Stromart-Fehler (DC an AC)
    for (const w of wires) {
      const pa = nodes.get(w.ka).port, pb = nodes.get(w.kb).port;
      if (pa.kind !== pb.kind) {
        add('error', 'Gleichstrom mit Wechselstrom verbunden',
          `Kabel zwischen „${nodes.get(w.ka).inst.name}" (${pa.kind.toUpperCase()}) und „${nodes.get(w.kb).inst.name}" (${pb.kind.toUpperCase()}).`,
          ['DC- und AC-Anschlüsse dürfen nie direkt verbunden werden – Geräte werden zerstört.', 'Zwischen Gleich- und Wechselstrom braucht es immer einen Wandler (Wechselrichter oder Ladegerät).'],
          ['Kabel entfernen und über einen passenden Wandler verbinden.'], [w.id]);
      }
    }

    // ---------- Gruppen: Solarmodule und Batterien (Reihen-/Parallelschaltung) ----------
    const groups = [];
    const groupOfInst = {};
    const isActive = (inst) => !inst.t.passive;
    for (const kind of ['pv', 'battery']) {
      for (const start of insts.filter((i) => i.type === kind)) {
        if (groupOfInst[start.id]) continue;
        const g = { id: 'g' + groups.length, kind, insts: [], nets: new Set() };
        const queue = [start];
        groupOfInst[start.id] = g;
        while (queue.length) {
          const i = queue.shift();
          g.insts.push(i);
          for (const p of i.ports) {
            const n = N(i, p.id);
            g.nets.add(n);
            for (const k of netMembers.get(n)) {
              const o = nodes.get(k).inst;
              if (o.type === kind && !groupOfInst[o.id]) { groupOfInst[o.id] = g; queue.push(o); }
            }
          }
        }
        reduceGroup(g);
        groups.push(g);
      }
    }

    function memberVal(i) {
      const p = i.product;
      if (i.type === 'pv') {
        const tk = num(p.tkVoc, -0.3);
        const shade = num(i.props.shade, 0);
        return {
          P: num(p.pmax, 0), voc: num(p.voc, 0), vmp: num(p.vmp, 0), isc: num(p.isc, 0), imp: num(p.imp, 0),
          vocCold: num(p.voc, 0) * (1 + tk / 100 * (settings.tMin - 25)),
          vmpHot: num(p.vmp, 0) * (1 + tk * 1.15 / 100 * (settings.tCell - 25)),
          maxSys: num(p.maxSys, 1000), s: 1, par: 1, n: 1, mismatchS: false, mismatchP: false, irregular: false, shade,
        };
      }
      const cd = C.CHEM_DEFAULTS[p.chem] || C.CHEM_DEFAULTS.gel;
      const ah = num(p.ah, 0), v = num(p.v, 12);
      return {
        v, ah, chem: new Set([p.chem]), s: 1, par: 1, n: 1,
        maxChg: num(p.maxChg, cd.chgC * ah), maxDis: num(p.maxDis, cd.disC * ah),
        dod: num(p.dod, cd.dod), rt: num(p.rt, cd.rt), cycles: num(p.cycles, cd.cycles),
        mismatchS: false, mismatchV: false, irregular: false,
      };
    }
    function combine(kind, a, b, series) {
      if (kind === 'pv') {
        if (series) return { ...a, P: a.P + b.P, voc: a.voc + b.voc, vmp: a.vmp + b.vmp, isc: Math.min(a.isc, b.isc), imp: Math.min(a.imp, b.imp),
          vocCold: a.vocCold + b.vocCold, vmpHot: a.vmpHot + b.vmpHot, maxSys: Math.min(a.maxSys, b.maxSys), s: a.s + b.s, par: Math.min(a.par, b.par), n: a.n + b.n,
          mismatchS: a.mismatchS || b.mismatchS || differs(a.imp / a.par, b.imp / b.par, 0.05), mismatchP: a.mismatchP || b.mismatchP, irregular: a.irregular || b.irregular || a.par !== b.par, shade: Math.max(a.shade, b.shade) };
        return { ...a, P: a.P + b.P, voc: Math.min(a.voc, b.voc), vmp: Math.min(a.vmp, b.vmp), isc: a.isc + b.isc, imp: a.imp + b.imp,
          vocCold: Math.max(a.vocCold, b.vocCold), vmpHot: Math.min(a.vmpHot, b.vmpHot), maxSys: Math.min(a.maxSys, b.maxSys), s: Math.max(a.s, b.s), par: a.par + b.par, n: a.n + b.n,
          mismatchS: a.mismatchS || b.mismatchS, mismatchP: a.mismatchP || b.mismatchP || differs(a.vmp, b.vmp, 0.05), irregular: a.irregular || b.irregular || a.s !== b.s, shade: Math.max(a.shade, b.shade) };
      }
      const chem = new Set([...a.chem, ...b.chem]);
      if (series) return { ...a, v: a.v + b.v, ah: Math.min(a.ah, b.ah), chem, s: a.s + b.s, par: Math.min(a.par, b.par), n: a.n + b.n,
        maxChg: Math.min(a.maxChg, b.maxChg), maxDis: Math.min(a.maxDis, b.maxDis), dod: Math.min(a.dod, b.dod), rt: Math.min(a.rt, b.rt), cycles: Math.min(a.cycles, b.cycles),
        mismatchS: a.mismatchS || b.mismatchS || differs(a.ah, b.ah, 0.03), mismatchV: a.mismatchV || b.mismatchV, irregular: a.irregular || b.irregular || a.par !== b.par };
      return { ...a, v: (a.v + b.v) / 2, ah: a.ah + b.ah, chem, s: Math.max(a.s, b.s), par: a.par + b.par, n: a.n + b.n,
        maxChg: a.maxChg + b.maxChg, maxDis: a.maxDis + b.maxDis, dod: Math.min(a.dod, b.dod), rt: Math.min(a.rt, b.rt), cycles: Math.min(a.cycles, b.cycles),
        mismatchS: a.mismatchS || b.mismatchS, mismatchV: a.mismatchV || b.mismatchV || differs(a.v, b.v, 0.03), irregular: a.irregular || b.irregular || a.s !== b.s };
    }

    // Serien-/Parallel-Reduktion eines Gruppen-Netzwerks auf zwei Klemmen
    function reduceGroup(g) {
      const kind = g.kind;
      let E = g.insts.map((i) => ({ p: N(i, '+'), m: N(i, '-'), val: memberVal(i), ids: [i.id] }));
      const memberNet = new Set();
      for (const i of g.insts) memberNet.add(N(i, '+')), memberNet.add(N(i, '-'));
      // Netze mit fremden aktiven Anschlüssen sind "extern"
      const external = new Set();
      for (const n of memberNet) {
        for (const k of netMembers.get(n)) {
          const o = nodes.get(k).inst;
          if (isActive(o) && groupOfInst[o.id] !== g) external.add(n);
        }
      }
      g.external = external;
      g.errors = [];
      let changed = true;
      while (changed && E.length > 1) {
        changed = false;
        for (const e of E) if (e.p === e.m) { g.errors.push('short'); }
        if (g.errors.length) break;
        // parallel
        outer: for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
          const a = E[i], b = E[j];
          if (a.p === b.p && a.m === b.m) {
            E.splice(j, 1);
            E[i] = { p: a.p, m: a.m, val: combine(kind, a.val, b.val, false), ids: a.ids.concat(b.ids) };
            changed = true; break outer;
          }
          if (a.p === b.m && a.m === b.p) { g.errors.push('antiparallel'); g.errIds = a.ids.concat(b.ids); break outer; }
        }
        if (changed || g.errors.length) continue;
        // seriell
        for (const n of memberNet) {
          if (external.has(n)) continue;
          const at = E.filter((e) => e.p === n || e.m === n);
          if (at.length !== 2) continue;
          const [a, b] = at;
          let ne;
          if (a.m === n && b.p === n) ne = { p: a.p, m: b.m };
          else if (a.p === n && b.m === n) ne = { p: b.p, m: a.m };
          else { g.errors.push('antiseries'); g.errIds = a.ids.concat(b.ids); break; }
          E = E.filter((e) => e !== a && e !== b);
          E.push({ ...ne, val: combine(kind, a.val, b.val, true), ids: a.ids.concat(b.ids) });
          changed = true;
          break;
        }
      }
      g.reduced = E.length === 1 && !g.errors.length;
      g.complex = E.length > 1 && !g.errors.length;
      if (E.length === 1) { g.val = E[0].val; g.plusNet = E[0].p; g.minusNet = E[0].m; }
      else {
        // Näherung: Summenwerte, damit trotzdem gerechnet werden kann
        g.val = g.insts.map(memberVal).reduce((a, b) => combine(kind, a, b, false));
      }
    }

    const groupLabel = (g) => g.kind === 'pv'
      ? `Solarfeld ${g.val.n} × ${g.insts[0].product.name.replace(/ \(Beispiel\)/, '')}`
      : `Batteriebank ${g.val.n} × ${g.insts[0].product.name.replace(/ \(Beispiel\)/, '')}`;
    const layout = (v) => (v.par > 1 ? `${v.s} in Reihe × ${v.par} parallel (${v.s}S${v.par}P)` : v.s > 1 ? `${v.s} in Reihe (${v.s}S)` : 'einzeln');

    // Gruppenfehler und Kennwerte
    for (const g of groups) {
      const refs = g.insts.map((i) => i.id);
      g.label = groupLabel(g);
      if (g.errors.includes('short')) add('error', 'Kurzschluss', `${g.label}: Plus und Minus eines Bauteils liegen auf derselben Leitung.`,
        [g.kind === 'pv' ? 'Ein kurzgeschlossenes Modul liefert keine Leistung und kann heiße Stellen (Hotspots) bilden.' : 'Ein Batteriekurzschluss erzeugt extreme Ströme – Brand- und Explosionsgefahr.'],
        ['Verkabelung prüfen: Plus und Minus dürfen nie direkt verbunden werden.'], refs);
      if (g.errors.includes('antiparallel')) add('error', 'Verpolt parallel geschaltet', `${g.label}: zwei Bauteile sind Plus an Minus parallel verbunden.`,
        ['Bei Parallelschaltung müssen alle Pluspole und alle Minuspole miteinander verbunden sein.', 'Verpolt parallel = Kurzschluss zwischen den Bauteilen.'],
        ['Plus mit Plus und Minus mit Minus verbinden.'], g.errIds || refs);
      if (g.errors.includes('antiseries')) add('error', 'Gegeneinander in Reihe geschaltet', `${g.label}: zwei Bauteile sind Plus an Plus (bzw. Minus an Minus) in Reihe.`,
        ['Bei Reihenschaltung wird immer Plus des einen mit Minus des nächsten verbunden.', 'Gegeneinander geschaltet heben sich die Spannungen auf.'],
        ['Verbindung umdrehen: Plus an Minus.'], g.errIds || refs);
      if (g.complex) add('warn', 'Verschaltung nicht eindeutig', `${g.label}: Die Verschaltung lässt sich nicht als reine Reihen-/Parallelschaltung auswerten. Es wird näherungsweise gerechnet.`,
        ['Die Engine kann gemischte Schaltungen nur auswerten, wenn sie sich schrittweise in Reihe/parallel zerlegen lassen.', 'Häufige Ursache: ein Modul/eine Batterie ist nur mit einem Pol angeschlossen.'],
        ['Alle Bauteile vollständig verbinden; Plus- und Minus-Enden der Gruppe zum Gerät führen.'], refs);
      if (g.kind === 'pv') {
        const v = g.val;
        if (v.mismatchS) add('warn', 'Unterschiedliche Module in Reihe', `${g.label}: In einem Strang sind Module mit unterschiedlichem Strom (Imp) in Reihe.`,
          ['In Reihe bestimmt das schwächste Modul den Strom des ganzen Strangs.', 'Die stärkeren Module verschenken dadurch Leistung.'], ['Nur gleiche Module in einen Strang, oder verschiedene Module auf getrennte MPP-Tracker/Regler verteilen.'], refs);
        if (v.mismatchP) add('warn', 'Parallele Stränge mit unterschiedlicher Spannung', `${g.label}: Parallel geschaltete Stränge haben unterschiedliche MPP-Spannungen.`,
          ['Parallele Stränge werden auf eine gemeinsame Spannung gezwungen.', 'Der Strang mit höherer Spannung arbeitet dann außerhalb seines optimalen Punkts.'], ['Stränge gleich lang und mit gleichen Modulen aufbauen oder getrennte Tracker nutzen.'], refs);
        if (v.irregular) add('warn', 'Ungleich lange Stränge parallel', `${g.label}: Parallel geschaltete Stränge enthalten unterschiedlich viele Module.`,
          ['Unterschiedlich lange Stränge haben verschiedene Spannungen – der längere Strang wird heruntergezogen.', 'Das kostet deutlich Ertrag und kann Rückströme verursachen.'], ['Alle parallelen Stränge gleich lang machen.'], refs);
        if (v.vocCold > v.maxSys) add('error', 'Systemspannung der Module überschritten', `${g.label}: Leerlaufspannung bei Kälte ${fmt(v.vocCold)} V > zulässige Systemspannung ${fmt(v.maxSys)} V.`,
          ['Die Isolation der Module ist nur bis zur angegebenen Systemspannung geprüft.'], ['Weniger Module in Reihe schalten.'], refs);
        if (v.par >= 3) {
          const fused = g.insts.some((i) => (adj.get(key(i.id, '+')) || []).concat(adj.get(key(i.id, '-')) || []).some((e) => e.kind === 'wire' && [e.a, e.b].some((k) => nodes.get(k).inst.type === 'fuse')));
          if (!fused) add('warn', 'Strangsicherungen fehlen', `${g.label}: ${v.par} Stränge parallel ohne Strangsicherungen.`,
            ['Ab 3 parallelen Strängen kann bei einem Fehler (z. B. Kurzschluss in einem Modul) der Strom aller anderen Stränge rückwärts durch den defekten Strang fließen.', 'Dieser Rückstrom übersteigt dann die zulässige Rückstromfestigkeit des Moduls (meist 20–25 A) – Brandgefahr.'],
            ['Je Strang eine PV-Sicherung (gPV) im Plus-Leiter einsetzen, Nennstrom ca. 1,5–2 × Isc des Strangs.'], refs,
            { op: 'rebuild', label: 'Solarfeld mit Strangsicherungen neu verschalten (Autom. Fertigstellen)' });
        }
      } else {
        const v = g.val;
        if (v.chem.size > 1) add('error', 'Batterietechnologien gemischt', `${g.label}: ${[...v.chem].map(C.chemLabel).join(' + ')} in einer Bank.`,
          ['Jede Technologie braucht eigene Ladespannungen – gemischt wird immer eine Sorte falsch geladen.', 'Folge: Überladung, Ausgasen oder dauerhaft volle/leere Zellen, stark verkürzte Lebensdauer.'],
          ['Nur gleiche Batterien (Typ, Kapazität, Alter) in einer Bank verwenden.'], refs);
        if (v.mismatchV) add('error', 'Unterschiedliche Spannungen parallel', `${g.label}: Parallel geschaltete Batterien/Stränge haben unterschiedliche Spannung.`,
          ['Beim Zusammenschalten fließt ein sehr hoher Ausgleichsstrom von der höheren zur niedrigeren Spannung.'], ['Nur Stränge gleicher Nennspannung parallel schalten.'], refs);
        if (v.mismatchS) add('warn', 'Unterschiedliche Kapazitäten in Reihe', `${g.label}: In Reihe geschaltete Batterien haben unterschiedliche Kapazität.`,
          ['In Reihe fließt durch alle Batterien derselbe Strom – die kleinste ist zuerst leer bzw. voll.', 'Sie wird dadurch regelmäßig tiefentladen/überladen und fällt früh aus; die Bank hat nur die Kapazität der kleinsten.'], ['Gleiche Batterien in Reihe schalten.'], refs);
        if (v.irregular) add('warn', 'Ungleich aufgebaute Stränge', `${g.label}: Parallel geschaltete Stränge haben unterschiedlich viele Batterien.`,
          ['Unterschiedliche Strangspannungen führen zu Ausgleichsströmen und ungleicher Belastung.'], ['Alle Stränge gleich aufbauen.'], refs);
        const lead = [...v.chem].some((c) => (C.CHEM_DEFAULTS[c] || {}).lead);
        if (lead && v.par > 3) add('warn', 'Viele Blei-Stränge parallel', `${g.label}: ${v.par} Stränge parallel.`,
          ['Bei Bleibatterien teilen sich Lade- und Entladeströme bei mehr als 3–4 parallelen Strängen sehr ungleich auf.', 'Einzelne Stränge altern dann schneller als andere.'],
          ['Weniger, dafür größere Batterien verwenden (z. B. 2-V-Zellen in Reihe) oder auf LiFePO4 mit BMS wechseln.'], refs);
      }
      // nicht angeschlossene Pole an Gruppenmitgliedern
      for (const i of g.insts) for (const p of i.ports) if (!connected(key(i.id, p.id)) && g.insts.length > 0 && !(adj.get(key(i.id, p.id)) || []).length) {
        add('info', 'Anschluss offen', `${i.name}: Pol ${p.label} ist nicht angeschlossen.`,
          ['Ein offener Pol bedeutet: das Bauteil ist nicht im Stromkreis und wird nicht berechnet.'], ['Pol mit dem passenden Gegenstück verbinden.'], [i.id]);
      }
    }
    const pvGroups = groups.filter((g) => g.kind === 'pv');
    const batGroups = groups.filter((g) => g.kind === 'battery');

    // Polaritätsprüfung pro Netz
    const reportedNets = new Set();
    for (const [n, ks] of netMembers) {
      let plus = false, minus = false;
      const refs = new Set();
      for (const k of ks) {
        const { inst, port } = nodes.get(k);
        if (!isActive(inst) || !port.pol) continue;
        const g = groupOfInst[inst.id];
        if (g && !g.external.has(n)) continue; // internes Gruppennetz
        if (port.pol === '+') plus = true; else minus = true;
        refs.add(inst.id);
      }
      if (plus && minus && !reportedNets.has(n)) {
        reportedNets.add(n);
        add('error', 'Verpolung / Kurzschluss', 'Ein Pluspol ist mit einem Minuspol eines anderen Geräts verbunden.',
          ['Plus- und Minusleitungen sind getrennte Stromkreise – eine Verbindung ist ein Kurzschluss oder eine Verpolung.', 'Verpolte Geräte werden meist sofort zerstört; bei Batterien besteht Brandgefahr.'],
          ['Leitungen prüfen: Plus immer nur mit Plus, Minus nur mit Minus (außer bei Reihenschaltung innerhalb einer Modul-/Batteriegruppe).'], [...refs]);
      }
    }

    // Gerät ↔ Gruppe zuordnen
    function attached(inst, plusId, minusId, kind) {
      const np = N(inst, plusId), nm = N(inst, minusId);
      for (const g of groups) {
        if (g.kind !== kind || g.plusNet === undefined) continue;
        if (g.plusNet === np && g.minusNet === nm) return { g };
        if (g.plusNet === nm && g.minusNet === np) return { g, reversed: true };
      }
      for (const g of groups) {
        if (g.kind !== kind) continue;
        if (g.nets.has(np) || g.nets.has(nm)) return { g, partial: true };
      }
      return null;
    }

    // ---------- Anlagen (zusammenhängende Systeme) ----------
    const sysOf = {};
    const systems = [];
    for (const i of insts) {
      if (sysOf[i.id] !== undefined) continue;
      const s = { id: systems.length, insts: [] };
      const q = [i];
      sysOf[i.id] = s.id;
      while (q.length) {
        const c = q.shift();
        s.insts.push(c);
        for (const p of c.ports) for (const k of netMembers.get(N(c, p.id))) {
          const o = nodes.get(k).inst;
          if (sysOf[o.id] === undefined) { sysOf[o.id] = s.id; q.push(o); }
        }
      }
      systems.push(s);
    }

    // ---------- Bemessungsströme je Anschluss ----------
    const portI = new Map();
    const setI = (inst, pid, I) => portI.set(key(inst.id, pid), I);
    const pvAttach = new Map(); // inst.id+input -> group
    const batAttach = new Map(); // inst.id -> group
    const devices = insts.filter((i) => isActive(i) && i.type !== 'pv' && i.type !== 'battery');
    for (const d of devices) {
      const p = d.product;
      const pvIn = (plus, minus, label) => {
        const a = attached(d, plus, minus, 'pv');
        if (a && !a.partial) { pvAttach.set(d.id + ':' + plus, a); return a; }
        if (a && a.partial) { pvAttach.set(d.id + ':' + plus, a); return a; }
        return null;
      };
      if (d.type === 'mppt' || d.type === 'hybrid') pvIn('pv+', 'pv-');
      if (d.type === 'micro') for (let n = 1; n <= Number(p.inputs || 1); n++) pvIn(`pv${n}+`, `pv${n}-`);
      if (d.ports.some((x) => x.role === 'bat')) {
        const a = attached(d, d.portMap['bat+'] ? 'bat+' : d.portMap['dc+'] ? 'dc+' : '+', d.portMap['bat-'] ? 'bat-' : d.portMap['dc-'] ? 'dc-' : '-', 'battery');
        if (a) batAttach.set(d.id, a);
      }
    }
    const pvGroupFor = (d, plus) => { const a = pvAttach.get(d.id + ':' + plus); return a && !a.reversed ? a.g : null; };
    const batGroupFor = (d) => { const a = batAttach.get(d.id); return a && !a.reversed && !a.partial ? a.g : null; };
    const groupI = (g) => (g.kind === 'pv' ? g.val.isc * 1.25 : 0);

    for (const d of devices) {
      const p = d.product;
      const bg = batGroupFor(d);
      const vBat = bg ? bg.val.v : num(p.vdc, num(p.batV, 12));
      switch (d.type) {
        case 'mppt': {
          const g = pvGroupFor(d, 'pv+');
          setI(d, 'pv+', g ? groupI(g) : num(p.maxIsc, p.maxA)); setI(d, 'pv-', g ? groupI(g) : num(p.maxIsc, p.maxA));
          const out = ctrlA(d, 30);
          setI(d, 'bat+', out); setI(d, 'bat-', out); d.chgI = out; break;
        }
        case 'micro': {
          for (let n = 1; n <= Number(p.inputs || 1); n++) {
            const g = pvGroupFor(d, `pv${n}+`);
            const I = g ? groupI(g) : num(p.maxInA, 14);
            setI(d, `pv${n}+`, I); setI(d, `pv${n}-`, I);
          }
          setI(d, 'ac', num(p.pAc, 800) / 230); break;
        }
        case 'hybrid': {
          const g = pvGroupFor(d, 'pv+');
          setI(d, 'pv+', g ? groupI(g) : num(p.maxIsc, 15)); setI(d, 'pv-', g ? groupI(g) : num(p.maxIsc, 15));
          const I = num(p.maxBatW, 5000) / (num(p.batV, 48) * 0.9);
          setI(d, 'bat+', I); setI(d, 'bat-', I); d.chgI = I; d.disI = I;
          setI(d, 'ac', num(p.pAc, 5000) / 230); break;
        }
        case 'batinv': {
          const I = num(p.pAc, 2500) / (num(p.batV, 48) * 0.9 * num(p.eta, 95) / 100);
          setI(d, 'bat+', I); setI(d, 'bat-', I); d.chgI = I; d.disI = I; setI(d, 'ac', num(p.pAc, 2500) / 230); break;
        }
        case 'inverter': {
          const I = num(p.pCont, 1000) / (num(p.vdc, 12) * 0.9 * num(p.eta, 92) / 100);
          setI(d, 'dc+', I); setI(d, 'dc-', I); d.disI = I; setI(d, 'ac', num(p.pCont, 1000) / 230); break;
        }
        case 'charger': setI(d, '+', num(p.maxA, 30)); setI(d, '-', num(p.maxA, 30)); d.chgI = num(p.maxA, 30);
          setI(d, 'ac', num(p.maxA, 30) * num(p.vdc, 12) * 1.2 / (num(p.eta, 88) / 100) / 230); break;
        case 'dcdc': case 'wind': setI(d, '+', num(p.maxA, 30)); setI(d, '-', num(p.maxA, 30)); d.chgI = num(p.maxA, 30); break;
        case 'load_dc': { const I = num(p.p, 0) / num(p.vdc, vBat); setI(d, '+', I); setI(d, '-', I); d.disI = I; break; }
        case 'load_ac': setI(d, 'ac', num(p.p, 0) * num(p.start, 1) / 230); break;
        case 'generator': setI(d, 'ac', num(p.p, 2000) / 230); break;
        case 'shore': setI(d, 'ac', num(p.maxA, 16)); break;
        case 'grid': setI(d, 'ac', 16); break;
      }
    }
    // Gruppenmitglieder: Strangstrom bzw. Bankstrom
    for (const g of groups) {
      let gi;
      if (g.kind === 'pv') gi = g.val.isc * 1.25;
      else {
        let chg = 0, dis = 0;
        for (const d of devices) if (batGroupFor(d) === g) { chg += d.chgI || 0; dis += d.disI || 0; }
        gi = Math.max(chg, dis);
        g.chgI = chg; g.disI = dis;
      }
      g.I = gi;
      const per = gi / Math.max(1, g.val.par);
      for (const i of g.insts) for (const p of i.ports) setI(i, p.id, per);
    }

    // Strom durch eine Kante: Netz an der Kante teilen, kleinere Seite zählt
    function sideCurrent(startKey, skipEdge) {
      const seen = new Set([startKey]);
      const st = [startKey];
      let sum = 0;
      while (st.length) {
        const c = st.pop();
        sum += portI.get(c) || 0;
        for (const e of adj.get(c) || []) {
          if (e === skipEdge) continue;
          const o = e.a === c ? e.b : e.a;
          if (!seen.has(o)) { seen.add(o); st.push(o); }
        }
      }
      return { sum, seen };
    }
    function edgeCurrent(e) {
      const A = sideCurrent(e.a, e), B = sideCurrent(e.b, e);
      if (A.seen.has(e.b)) {
        // Masche. Bei Sicherungen/Schaltern (z. B. Strangsicherungen mit gemeinsamem Minus) begrenzt das kleinere Anschlussnetz den Strom.
        const netI = (k) => { const n = netOf.get(k); let s0 = 0; for (const m of (n !== undefined && netMembers.get(n)) || []) if (m !== k) s0 += portI.get(m) || 0; return s0 || Infinity; };
        const local = e.kind === 'wire' ? Infinity : Math.min(netI(e.a), netI(e.b));
        return Math.min(portI.get(e.a) || Infinity, portI.get(e.b) || Infinity, local, A.sum) || 0;
      }
      return Math.min(A.sum, B.sum);
    }

    // Bezugsspannung eines Netzes
    function netVoltage(n) {
      let v = 0;
      for (const k of netMembers.get(n)) {
        const { inst, port } = nodes.get(k);
        if (port.kind === 'ac') return 230;
        const g = groupOfInst[inst.id];
        if (g && g.kind === 'pv') v = Math.max(v, g.val.vmp);
        else if (g) v = Math.max(v, g.val.v);
        else if (port.role === 'pvin') { const pg = pvGroupFor(inst, port.id.replace('-', '+')); if (pg) v = Math.max(v, pg.val.vmp); }
        else if (port.role === 'bat') v = Math.max(v, num(inst.product.vdc, num(inst.product.batV, 0)));
      }
      return v || 12;
    }
    function netVocCold(n) {
      let v = 0;
      for (const k of netMembers.get(n)) {
        const { inst, port } = nodes.get(k);
        const g = groupOfInst[inst.id];
        if (g && g.kind === 'pv') v = Math.max(v, g.val.vocCold);
        else if (port.role === 'pvin') { const pg = pvGroupFor(inst, port.id.replace('-', '+')); if (pg) v = Math.max(v, pg.val.vocCold); }
      }
      return v;
    }

    // ---------- Kabel ----------
    const wireRes = {};
    const ampOf = (cab, a) => C.ampacity({ ...cab, area: a, ampacity: '' });
    for (const w of wires) {
      const e = edges.find((x) => x.wire === w);
      const I = edgeCurrent(e);
      const pa = nodes.get(w.ka), pb = nodes.get(w.kb);
      let len = num(w.length, null);
      if (w.lengthMode !== 'manual' || len === null) {
        const ga = portGeom(pa.inst, pa.inst.t, pa.port), gb = portGeom(pb.inst, pb.inst.t, pb.port);
        len = Math.max(0.2, (Math.abs(ga.x - gb.x) + Math.abs(ga.y - gb.y)) / 100);
      }
      const cab = w.cable;
      const area = num(cab.area, 1.5);
      const rho = C.RHO[cab.material] || C.RHO.cu;
      const loop = cab.cores && cab.cores !== '1' ? 2 : 1;
      const R = rho * len * loop / area;
      const V = netVoltage(netOf.get(w.ka));
      const dU = I * R;
      const pct = V ? dU / V * 100 : 0;
      const amp = C.ampacity(cab);
      // Grenzwerte: je Einzelleiter halbes Budget (Hin+Rück zusammen 1,5 % / 3 % / 5 %)
      const lim = loop === 2 ? [1.5, 3, 5] : [0.75, 1.5, 2.5];
      let status = pct <= lim[0] ? 'good' : pct <= lim[1] ? 'ok' : pct <= lim[2] ? 'warn' : 'bad';
      if (I > amp) status = 'bad';
      // Querschnitt nach Belastbarkeit (Strom) und nach Spannungsfall – der größere gilt
      const ampArea = C.AREAS.find((a) => ampOf(cab, a) >= I) || null;
      const dropNeed = I > 0 ? rho * len * loop * I / (V * lim[0] / 100) : 0;
      const dropArea = C.AREAS.find((a) => a >= dropNeed) || null;
      const suggest = ampArea ? Math.max(ampArea, dropArea || C.AREAS[C.AREAS.length - 1]) : null;
      const res = { I, len, R, V, dU, pct, amp, status, lossW: I * I * R, suggest, ampArea, dropArea, loop, lim, area };
      wireRes[w.id] = res;
    }

    // Meldungen je Verbindung (Plus- und Minusleitung zwischen denselben Geräten zusammengefasst)
    const pairKey = (w) => [w.ka.split('|')[0], w.kb.split('|')[0]].sort().join('~');
    const pairs = new Map();
    for (const w of wires) {
      const r = wireRes[w.id];
      const pa = nodes.get(w.ka), pb = nodes.get(w.kb);
      if (pa.port.kind !== pb.port.kind) continue;
      const kind = r.I > r.amp ? 'over' : (r.status === 'bad' || r.status === 'warn') ? 'drop' : null;
      if (!kind) continue;
      const k = kind + ':' + pairKey(w);
      if (!pairs.has(k)) pairs.set(k, { kind, list: [], nm: `${pa.inst.name} → ${pb.inst.name}` });
      pairs.get(k).list.push(w);
    }
    for (const { kind, list, nm } of pairs.values()) {
      // maßgeblich ist das ungünstigste Kabel der Verbindung
      const w = list.reduce((a, b) => (wireRes[b.id].I / wireRes[b.id].amp > wireRes[a.id].I / wireRes[a.id].amp || wireRes[b.id].pct > wireRes[a.id].pct ? b : a));
      const r = wireRes[w.id];
      const both = list.length > 1;
      const which = both ? 'Plus- und Minusleitung' : 'Kabel';
      const target = r.suggest;
      const spec = target ? cableSpec(w.cable, target) : null;
      const auto = spec ? { op: 'cable', wires: list.map((x) => x.id), spec, label: `${nm.replace(/ \(Beispiel\)/g, '')}: ${both ? 'beide Leitungen' : 'Kabel'} auf ${fmt(target)} mm² ändern` } : null;
      const areaWhy = [];
      if (r.ampArea) areaWhy.push(`Für ${fmt(r.I)} A Dauerstrom braucht es mindestens ${fmt(r.ampArea)} mm² (Belastbarkeit – sonst wird das Kabel zu heiß).`);
      if (r.dropArea) areaWhy.push(`Damit bei ${fmt(r.len, 1)} m Länge höchstens ${fmt(r.lim[0], 2)} % Spannung verloren gehen, braucht es ${fmt(r.dropArea)} mm² (Spannungsfall).`);
      if (target) areaWhy.push(`Der größere Wert gilt: ${fmt(target)} mm².`);
      if (both) areaWhy.push('Plus- und Minusleitung führen denselben Strom – beide müssen den gleichen Querschnitt haben.');
      if (kind === 'over') {
        if (!r.ampArea) {
          const vSys = r.V;
          add('error', 'Strom zu hoch für ein einzelnes Kabel', `${nm}: ${fmt(r.I)} A – selbst das dickste Kabel der Liste (240 mm²) trägt nur ca. ${fmt(ampOf(w.cable, 240))} A.`,
            [`Der Strom ergibt sich aus Leistung ÷ Spannung: Bei ${fmt(vSys)} V fließen sehr hohe Ströme.`,
              'Solche Ströme sind in der Praxis kaum beherrschbar: riesige Kabel, Sicherungen und Klemmen, hohe Verluste.',
              vSys <= 24 ? `Mit 48 V statt ${fmt(vSys)} V wäre der Strom ${vSys <= 12 ? 'nur ein Viertel' : 'nur halb so groß'} (ca. ${fmt(r.I * vSys / 48)} A).` : null].filter(Boolean),
            [vSys <= 24 ? 'Systemspannung auf 48 V erhöhen (Batteriebank, Wechselrichter und Regler für 48 V)' : 'Leistung aufteilen', 'oder die Leistung des Geräts verringern', 'oder mehrere Kabel parallel verlegen (in dieser App nicht abgebildet)'],
            list.map((x) => x.id));
        } else {
          add('error', 'Kabel überlastet', `${nm}: ${fmt(r.I)} A bei nur ${fmt(r.amp)} A Belastbarkeit (${fmt(r.area)} mm²${both ? ', ' + which : ''}).`,
            ['Ein überlastetes Kabel wird heiß – die Isolation kann schmelzen, es droht ein Kabelbrand.',
              `Der Bemessungsstrom ${fmt(r.I)} A ergibt sich aus den angeschlossenen Geräten (bei Solarströmen inkl. Sicherheitszuschlag 1,25 × Isc).`, ...areaWhy],
            [`${which} auf ${fmt(target)} mm² ändern${!spec ? '' : spec.create ? ' (Kabeltyp wird bei der Auto-Korrektur angelegt)' : ` („${spec.name}")`}.`, r.V <= 24 ? 'Alternativ: höhere Systemspannung – halbiert/viertelt den Strom.' : null].filter(Boolean),
            list.map((x) => x.id), auto);
        }
      } else {
        add(r.status === 'bad' ? 'error' : 'warn', 'Spannungsfall zu hoch',
          `${nm}: ${fmt(r.pct, 2)} % Spannungsfall je Leiter (${fmt(r.dU, 2)} V bei ${fmt(r.I)} A über ${fmt(r.len, 1)} m, ${fmt(r.area)} mm²). Verlust ca. ${fmt(r.lossW * list.length)} W.`,
          [`Je Leiter sind höchstens ${fmt(r.lim[1], 2)} % sinnvoll (Hin- und Rückleiter zusammen ${fmt(r.lim[1] * (r.loop === 2 ? 1 : 2), 2)} %).`,
            'Zu viel Spannungsfall verschenkt Energie als Wärme und lässt Geräte zu früh abschalten (Unterspannung) bzw. Laderegler falsch messen.',
            r.V <= 24 ? `Bei ${fmt(r.V)} V Systemspannung wirken sich schon wenige Zehntel Volt stark aus – Niedervolt-Systeme brauchen dicke, kurze Kabel.` : 'Längere Leitungen brauchen größere Querschnitte.', ...areaWhy],
          [target ? `${which} auf ${fmt(target)} mm² ändern` : null, 'oder Kabel kürzen (Geräte näher zusammen)', r.V <= 24 ? 'oder höhere Systemspannung (24/48 V) wählen – halbiert/viertelt den Strom.' : null].filter(Boolean),
          list.map((x) => x.id), auto);
      }
    }

    // ---------- Sicherungen & Schalter ----------
    for (const i of insts.filter((x) => x.t.passive === 'fuse' || x.t.passive === 'switch')) {
      const ka = key(i.id, 'a'), kb = key(i.id, 'b');
      const e = edges.find((x) => x.inst === i);
      if (!connected(ka) || !connected(kb)) {
        add('warn', 'Bauteil nicht eingebunden', `${i.name}: ${connected(ka) || connected(kb) ? 'nur eine Seite' : 'keine Seite'} angeschlossen.`,
          ['Sicherungen und Schalter wirken nur, wenn sie im Stromkreis zwischen zwei Teilen liegen.'], ['Beide Seiten verbinden.'], [i.id]);
        continue;
      }
      const I = edgeCurrent(e);
      const rated = num(i.product.rated, 0);
      const n = netOf.get(ka);
      const V = netVoltage(n);
      const vocCold = netVocCold(n);
      const isDC = !(adj.get(ka) || []).concat(adj.get(kb) || []).some((x) => x.kind === 'wire' && [x.a, x.b].some((k) => nodes.get(k).port.kind === 'ac'));
      const wiresHere = (adj.get(ka) || []).concat(adj.get(kb) || []).filter((x) => x.kind === 'wire');
      const minAmp = wiresHere.length ? Math.min(...wiresHere.map((x) => C.ampacity(x.wire.cable))) : 0;
      const needV = Math.max(V, vocCold);
      i.calc = { I, V };
      // passende Sicherung: ≥ 1,25 × I, ≤ Kabelbelastbarkeit, Spannung ausreichend
      const fuseFix = () => {
        if (i.t.passive !== 'fuse') return null;
        const s = fuseSpec(isDC ? 'dc' : 'ac', I * 1.25, minAmp || null, needV * 1.05, vocCold > 0);
        return s ? { op: 'swap', inst: i.id, spec: s, label: `Sicherung durch „${s.name}" ersetzen` } : null;
      };
      const noFuseWhy = minAmp && I * 1.25 > minAmp ? [`Es gibt keine passende Sicherungsgröße: nötig wären ≥ ${fmt(I * 1.25)} A, das Kabel verträgt aber nur ${fmt(minAmp)} A – zuerst das Kabel vergrößern.`] : [];
      if (i.t.passive === 'fuse') {
        if (isDC && (i.product.kind === 'ac' || i.product.ftype === 'ls')) add('error', 'AC-Sicherung im Gleichstromkreis', `${i.name} sitzt in einem DC-Kreis.`,
          ['Gleichstrom hat keinen Nulldurchgang – ein Lichtbogen erlischt nicht von selbst.', 'AC-Sicherungen/LS-Schalter können DC-Fehlerströme oft nicht sicher trennen.'], ['Eine für DC zugelassene Sicherung verwenden (ANL/MEGA/MIDI, gPV, DC-LS).'], [i.id], fuseFix());
        else if (rated && I && rated < I * 1.25) add('warn', 'Sicherung zu klein', `${i.name}: ${fmt(rated)} A bei ${fmt(I)} A Bemessungsstrom.`,
          ['Sicherungen sollten mindestens das 1,25-fache des Dauerstroms haben – sonst lösen sie bei normaler Volllast aus oder altern.', `1,25 × ${fmt(I)} A = ${fmt(I * 1.25)} A.`, ...noFuseWhy],
          [`Nennstrom ca. ${fmt(nextSize(FUSE_SIZES, I * 1.25))} A wählen${minAmp ? `, aber höchstens ${fmt(minAmp)} A (Kabel)` : ''}.`], [i.id], fuseFix());
        else if (rated && minAmp && rated > minAmp) add('error', 'Sicherung schützt das Kabel nicht', `${i.name}: ${fmt(rated)} A, angeschlossenes Kabel verträgt nur ${fmt(minAmp)} A.`,
          ['Die Sicherung ist dazu da, das Kabel zu schützen: Sie muss auslösen, bevor das Kabel überhitzt.', 'Ist die Sicherung größer als die Kabel-Belastbarkeit, kann das Kabel im Fehlerfall brennen, ohne dass die Sicherung auslöst.', ...noFuseWhy],
          ['Kleinere Sicherung oder dickeres Kabel wählen (Sicherung ≤ Belastbarkeit des schwächsten Kabels).'], [i.id], fuseFix());
      }
      const maxV = num(i.product.maxV, 0);
      if (maxV && needV > maxV) add('error', 'Spannungsfestigkeit zu gering', `${i.name}: zulässig ${fmt(maxV)} V, im Kreis bis ${fmt(needV)} V.`,
        [vocCold ? 'Im Solarkreis zählt die Leerlaufspannung bei Kälte – sie liegt deutlich über der Betriebsspannung.' : 'Bauteile müssen für die maximale Spannung im Kreis ausgelegt sein.', 'Zu geringe Spannungsfestigkeit: Lichtbogen beim Trennen, die Sicherung/der Schalter kann den Strom nicht sicher unterbrechen.'],
        [`Bauteil mit mindestens ${fmt(Math.ceil(needV * 1.1))} V DC Spannungsfestigkeit verwenden.`], [i.id], fuseFix());
      if (rated && I > rated && i.t.passive === 'switch') add('warn', 'Schalter zu klein', `${i.name}: ${fmt(rated)} A bei ${fmt(I)} A.`,
        ['Ein überlasteter Schalter erwärmt sich an den Kontakten.'], ['Schalter mit höherem Nennstrom wählen.'], [i.id]);
    }

    // Fehlende Batteriesicherung: Pfad Batterie+ → Gerät ohne Sicherung
    for (const g of batGroups) {
      if (g.plusNet === undefined) continue;
      const starts = g.insts.map((i) => key(i.id, '+')).filter((k) => netOf.get(k) === g.plusNet);
      const seen = new Set(starts);
      const st = [...starts];
      const hit = new Set();
      while (st.length) {
        const c = st.pop();
        const { inst, port } = nodes.get(c);
        if (isActive(inst) && !groupOfInst[inst.id] && port.pol === '+') hit.add(inst.id);
        for (const e of adj.get(c) || []) {
          if (e.kind === 'fuse') continue;
          const o = e.a === c ? e.b : e.a;
          if (!seen.has(o)) { seen.add(o); st.push(o); }
        }
      }
      for (const id of hit) {
        const dev = byId[id];
        const I = Math.max(dev.disI || 0, dev.chgI || 0);
        // Direktes Kabel Batterie+ → Gerät+ ? Dann kann die Sicherung automatisch eingesetzt werden.
        const plusPort = dev.ports.find((p) => p.pol === '+' && p.role === 'bat');
        const direct = plusPort && wires.find((w) => [w.ka, w.kb].includes(key(dev.id, plusPort.id)) &&
          [w.ka, w.kb].some((k) => { const o = nodes.get(k).inst; return groupOfInst[o.id] === g; }));
        let auto = null;
        let fixTxt = `Sicherung (z. B. ANL/MEGA) direkt am Batterie-Plus einsetzen, ca. ${fmt(nextSize(FUSE_SIZES, I * 1.25))} A, aber ≤ Kabelbelastbarkeit.`;
        if (direct) {
          let amp = C.ampacity(direct.cable);
          const rated = FUSE_SIZES.find((s0) => s0 >= I * 1.25);
          let cableUp = null;
          if (rated && amp < rated) {
            // Kabel muss die Sicherung "aushalten" – sonst schützt sie es nicht. Plus- und Minusleitung mit verstärken.
            const area = C.AREAS.find((a) => ampOf(direct.cable, a) >= rated);
            if (area) {
              const partner = wires.filter((w) => { const ia = nodes.get(w.ka).inst, ib = nodes.get(w.kb).inst; return (ia === dev && groupOfInst[ib.id] === g) || (ib === dev && groupOfInst[ia.id] === g); });
              cableUp = { spec: cableSpec(direct.cable, area), wires: partner.map((w) => w.id), area };
              amp = ampOf(direct.cable, area);
              fixTxt += ` Dafür muss das Kabel mindestens ${fmt(area)} mm² haben (Sicherung ${rated} A ≤ Kabelbelastbarkeit).`;
            }
          }
          const s = fuseSpec('dc', I * 1.25, amp, num(g.val.v, 12) * 1.3, false);
          if (s) auto = { op: 'insertFuse', wire: direct.id, batKey: [direct.ka, direct.kb].find((k) => groupOfInst[nodes.get(k).inst.id] === g), spec: s, cable: cableUp,
            label: `„${s.name}" am Batterie-Plus einsetzen${cableUp ? ` und Kabel auf ${fmt(cableUp.area)} mm² verstärken` : ''}` };
          else fixTxt += ` Achtung: Das Kabel (${fmt(amp)} A) ist für ${fmt(I * 1.25)} A zu dünn – zuerst das Kabel vergrößern.`;
        }
        add('warn', 'Batteriesicherung fehlt', `Zwischen ${g.label} und „${dev.name}" liegt keine Sicherung.`,
          ['Batterien können im Kurzschlussfall tausende Ampere liefern – ohne Sicherung brennt das Kabel durch, bevor irgendetwas abschaltet.', 'Die Sicherung gehört möglichst nah an den Pluspol der Batterie, damit das ganze Kabel geschützt ist.',
            `Größe: mindestens 1,25 × ${fmt(I)} A (Gerätestrom) = ${fmt(I * 1.25)} A, höchstens die Belastbarkeit des Kabels.`],
          [fixTxt], [id, ...g.insts.map((i) => i.id)], auto);
      }
    }

    // ---------- Geräteprüfungen ----------
    const vChargeOf = (g, sysV) => {
      const chem = g ? [...g.val.chem][0] : 'gel';
      return (stdVolt(g ? g.val.v : sysV) || sysV) * (C.CHEM_DEFAULTS[chem] || C.CHEM_DEFAULTS.gel).vCharge;
    };
    const ilr = []; // DC/AC-Verhältnisse

    for (const d of devices) {
      const p = d.product;
      const refs = [d.id];
      const bat = batAttach.get(d.id);
      const bg = batGroupFor(d);
      if (bat && bat.reversed) add('error', 'Batterie verpolt angeschlossen', `${d.name}: Batterie-Plus und -Minus sind vertauscht.`,
        ['Verpolung zerstört die Elektronik sofort; Batteriekurzschluss über interne Dioden ist möglich.'], ['Plus an Plus, Minus an Minus.'], refs.concat(bat.g.insts.map((i) => i.id)));
      if (bat && bat.partial && !bat.reversed) add('warn', 'Batterie nur einpolig angeschlossen', `${d.name}: nur ein Pol führt zur Batteriebank (oder die Bank ist nicht eindeutig verschaltet).`,
        ['Ohne geschlossenen Stromkreis (Plus und Minus) fließt kein Strom.'], ['Beide Pole zur Batteriebank führen.'], refs);
      const sysV = bg ? bg.val.v : null;
      const sysStd = sysV ? stdVolt(sysV) : null;

      const checkPv = (plus, minus, opts) => {
        const a = pvAttach.get(d.id + ':' + plus);
        if (!a) {
          const anyWire = connected(key(d.id, plus)) || connected(key(d.id, minus));
          if (opts.required !== false) add(anyWire ? 'warn' : 'info', anyWire ? 'Solareingang ohne erkennbares Solarfeld' : 'Solareingang frei', `${d.name}${opts.label ? ' ' + opts.label : ''}: kein Solarfeld angeschlossen.`,
            ['Ohne Module liefert der Eingang keine Energie.'], ['Solarmodule an PV+ und PV− anschließen.'], refs);
          return null;
        }
        if (a.reversed) { add('error', 'Solarfeld verpolt', `${d.name}: PV+ und PV− sind vertauscht.`, ['Viele Regler/Wechselrichter sind nicht verpolungsfest – Verpolung kann sie zerstören.'], ['Plus und Minus tauschen.'], refs.concat(a.g.insts.map((i) => i.id))); return null; }
        if (a.partial) { add('warn', 'Solarfeld nur einpolig angeschlossen', `${d.name}: Das Solarfeld ist nicht mit beiden Polen am Eingang.`, ['Ohne geschlossenen Stromkreis fließt kein Strom.'], ['Plus-Ende des Feldes an PV+, Minus-Ende an PV−.'], refs); return null; }
        return a.g;
      };

      if (d.type === 'mppt') {
        const g = checkPv('pv+', 'pv-', {});
        const isPwm = p.ctype === 'pwm';
        const volts = String(p.volts || '12/24').split(/[^0-9]+/).map(Number).filter(Boolean);
        if (!bg) add('error', 'Laderegler ohne Batterie', `${d.name}: Am Batterieausgang hängt keine Batteriebank.`,
          ['Ein Solarladeregler braucht die Batterie als Referenz – ohne sie kann er die Spannung nicht regeln.', 'Betrieb ohne Batterie (oder Solarfeld vor Batterie anklemmen) kann Regler und Verbraucher beschädigen.'],
          ['Batteriebank an B+ / B− anschließen – immer zuerst die Batterie, dann die Module anklemmen.'], refs);
        if (sysStd && !volts.includes(sysStd)) add('error', 'Regler passt nicht zur Batteriespannung', `${d.name}: unterstützt ${volts.join('/')} V, Batteriebank hat ${fmt(sysV)} V.`,
          ['Der Regler lädt mit falschen Ladespannungen – Überladung oder nie volle Batterie.'], [`Regler für ${sysStd} V wählen oder Batteriebank auf ${volts.join('/')} V umbauen.`], refs);
        if (g) {
          const v = g.val;
          const vCh = vChargeOf(bg, sysStd || 12);
          const maxVoc = num(p.maxVoc, 100);
          const pOut = ctrlA(d, 30) * vCh;
          d.calc = { pvP: v.P, pOut, vocCold: v.vocCold, vmpHot: v.vmpHot, ratio: v.P / pOut };
          const ctrlAuto = () => {
            const c = pickController({ vocCold: v.vocCold, needA: v.P / (vCh * 1.2), sysV: sysStd || 12, isc: v.isc });
            return c && c.id !== p.id ? { op: 'swap', inst: d.id, spec: { productId: c.id, name: c.name }, label: `Regler durch „${c.name}" ersetzen` } : null;
          };
          if (v.vocCold > maxVoc) add('error', 'PV-Spannung zu hoch – Regler wird zerstört', `${d.name}: ${g.label} (${layout(v)}) erreicht bei ${settings.tMin} °C ${fmt(v.vocCold)} V, erlaubt sind ${fmt(maxVoc)} V.`,
            ['Die Leerlaufspannung steigt bei Kälte (Temperaturkoeffizient). An einem kalten, sonnigen Wintermorgen liegt sie über dem Datenblattwert.', 'Überschreitet sie die Eingangsgrenze, wird der Regler beschädigt – das ist kein Garantiefall.'],
            [`Weniger Module in Reihe, dafür mehr parallel`, `oder Regler mit mindestens ${nextSize(CTRL_SIZES_V, v.vocCold * 1.05)} V PV-Eingang.`], refs.concat(g.insts.map((i) => i.id)), ctrlAuto());
          else if (v.vocCold > maxVoc * 0.95) add('warn', 'PV-Spannung knapp an der Grenze', `${d.name}: ${fmt(v.vocCold)} V bei Kälte von max. ${fmt(maxVoc)} V.`,
            ['Weniger als 5 % Reserve: Bei Extremkälte oder Reflexion (Schnee) kann die Grenze überschritten werden.'], [`Regler mit ${nextSize(CTRL_SIZES_V, v.vocCold * 1.1)} V wählen oder ein Modul weniger in Reihe.`], refs, ctrlAuto());
          if (!isPwm && v.vmpHot < vCh + 5) add('warn', 'PV-Spannung zu niedrig für MPPT', `${d.name}: MPP-Spannung bei ${settings.tCell} °C Zelltemperatur nur ${fmt(v.vmpHot)} V, Ladespannung ${fmt(vCh)} V.`,
            ['Ein MPPT-Regler braucht eine PV-Spannung, die einige Volt (typisch 5 V) über der Batterie-Ladespannung liegt.', 'An heißen Sommertagen sinkt die Modulspannung – dann lädt der Regler schlecht oder gar nicht.'],
            ['Mehr Module in Reihe schalten oder Module mit höherer Spannung wählen.'], refs);
          if (isPwm && v.vmp > vCh * 1.35) {
            const loss = 1 - (vCh * 1.05) / v.vmp;
            add('warn', 'PWM-Regler verschenkt Leistung', `${d.name}: Die Module arbeiten mit ~${fmt(vCh)} V statt ${fmt(v.vmp)} V – etwa ${fmt(loss * 100, 0)} % der Leistung gehen verloren.`,
              ['Ein PWM-Regler verbindet die Module direkt mit der Batterie – die Modulspannung wird auf Batteriespannung heruntergezogen.', 'Leistung = Spannung × Strom: Der Strom bleibt gleich, die Spannung sinkt, also sinkt die Leistung.', 'PWM passt nur zu 12-V-Panels (Vmp ≈ 18 V) an 12-V-Batterien.'],
              [`MPPT-Regler verwenden (mind. ${nextSize(CTRL_SIZES_V, v.vocCold * 1.05)} V / ${nextSize(CTRL_SIZES_A, v.P / vCh)} A).`], refs, ctrlAuto());
          }
          if (v.isc > num(p.maxIsc, Infinity)) add('error', 'PV-Strom zu hoch', `${d.name}: Kurzschlussstrom ${fmt(v.isc)} A > zulässig ${fmt(p.maxIsc)} A.`,
            ['Der Eingangskreis des Reglers ist nur für einen bestimmten Kurzschlussstrom ausgelegt.'], ['Weniger Stränge parallel oder Regler mit höherem PV-Strom wählen.'], refs, ctrlAuto());
          const r = v.P / pOut;
          if (r > 1.3) {
            const needA = nextSize(CTRL_SIZES_A, v.P / vCh);
            add('warn', 'Laderegler zu klein für das Solarfeld', `${d.name}: ${fmt(v.P)} Wp an einem Regler, der nur ca. ${fmt(pOut)} W (${fmt(p.maxA)} A × ${fmt(vCh, 1)} V) liefern kann – Verhältnis ${fmt(r, 2)}.`,
              ['Der Regler begrenzt den Ladestrom – alles darüber wird abgeregelt und ist verloren.', 'Eine leichte Überbelegung (bis ca. 1,2–1,3) ist üblich, weil Module selten Nennleistung bringen. Darüber geht spürbar Ertrag verloren.', `Benötigter Ladestrom ≈ PV-Leistung ÷ Ladespannung = ${fmt(v.P)} W ÷ ${fmt(vCh, 1)} V = ${fmt(v.P / vCh)} A.`],
              [`Regler mit mind. ${needA} A wählen`, sysStd && sysStd < 48 ? `oder Systemspannung auf ${sysStd * 2} V erhöhen – dann reichen ${nextSize(CTRL_SIZES_A, v.P / (vCh * 2))} A.` : null, 'oder das Feld auf zwei Regler aufteilen.'].filter(Boolean), refs, ctrlAuto());
          } else if (r > 1.0) add('info', 'Regler leicht überbelegt', `${d.name}: Verhältnis Solarleistung/Reglerleistung ${fmt(r, 2)} – an Spitzentagen wird kurz abgeregelt.`,
            ['Module liefern nur an kalten, klaren Tagen ihre volle Nennleistung. Eine leichte Überbelegung erhöht den Ertrag morgens, abends und im Winter.'], [], refs);
          else if (r < 0.5) add('tip', 'Regler deutlich größer als nötig', `${d.name}: Das Solarfeld nutzt nur ${fmt(r * 100, 0)} % der Reglerleistung.`,
            ['Ein kleinerer Regler wäre günstiger – oder es passen noch Module dazu.'], [`Bis zu ${fmt(pOut * 1.2)} Wp wären an diesem Regler möglich.`], refs);
          if (bg && ctrlA(d, 0) > bg.val.maxChg * 1.05) add('warn', 'Ladestrom zu hoch für die Batterie', `${d.name}: bis ${fmt(ctrlA(d, 0))} A Ladestrom, die Batteriebank verträgt ${fmt(bg.val.maxChg)} A.`,
            [`${[...bg.val.chem].map(C.chemLabel).join('/')} verträgt nur einen begrenzten Ladestrom (${[...bg.val.chem].some((c) => (C.CHEM_DEFAULTS[c] || {}).lead) ? 'bei Gel/AGM typisch 0,2–0,25 C, also 20–25 A je 100 Ah' : 'laut Datenblatt/BMS'}).`, 'Zu hohe Ladeströme erwärmen die Batterie und verkürzen ihre Lebensdauer; bei Gel entstehen dauerhafte Schäden.'],
            ['Ladestrombegrenzung im Regler einstellen (Eigenschaften → Ladestrom-Begrenzung)', 'oder Batteriebank vergrößern (mehr Kapazität parallel).'], refs.concat(bg.insts.map((i) => i.id)),
            { op: 'setProp', inst: d.id, key: 'chgLimit', value: Math.floor(bg.val.maxChg), label: `Ladestrom im Regler auf ${fmt(Math.floor(bg.val.maxChg))} A begrenzen` });
          // Verschaltungsvorschläge
          const opts = layoutOptions(g, maxVoc, vCh, isPwm);
          if (opts.length && (v.vocCold > maxVoc || (!isPwm && v.vmpHot < vCh + 5))) add('tip', 'Mögliche Verschaltungen', `Für ${v.n} Module an ${d.name}:`,
            ['Reihenschaltung addiert Spannungen (Strom bleibt), Parallelschaltung addiert Ströme (Spannung bleibt).', 'Höhere Spannung = kleinere Ströme = dünnere Kabel und weniger Verluste – solange die Reglergrenze eingehalten wird.'],
            opts.map((o) => `${o.s}S${o.p}P: Voc kalt ${fmt(o.vocCold)} V, Vmp heiß ${fmt(o.vmpHot)} V, Isc ${fmt(o.isc)} A${o.best ? ' ← empfohlen' : ''}`), refs);
        }
      }

      if (d.type === 'micro') {
        const n = Number(p.inputs || 1);
        let pvTotal = 0;
        for (let k = 1; k <= n; k++) {
          const g = checkPv(`pv${k}+`, `pv${k}-`, { label: `Eingang ${k}`, required: k === 1 });
          if (!g) continue;
          const v = g.val;
          pvTotal += v.P;
          const maxV = num(p.maxInV, 60);
          if (v.vocCold > maxV) add('error', 'Eingangsspannung zu hoch', `${d.name} Eingang ${k}: ${fmt(v.vocCold)} V bei Kälte, max. ${fmt(maxV)} V.`,
            ['Mikro-Wechselrichter haben niedrige Eingangsspannungen (meist 60 V) – meist passt nur ein Modul je Eingang.', 'Überspannung zerstört den Wechselrichter.'],
            ['Je Eingang nur ein Modul (oder Module parallel) anschließen.'], refs);
          if (v.vmp < num(p.mpptMin, 0) || v.vmp > num(p.mpptMax, Infinity)) add('warn', 'MPP-Spannung außerhalb des Arbeitsbereichs', `${d.name} Eingang ${k}: Vmp ${fmt(v.vmp)} V, Bereich ${fmt(p.mpptMin)}–${fmt(p.mpptMax)} V.`,
            ['Außerhalb des MPP-Bereichs kann der Wechselrichter den optimalen Arbeitspunkt nicht einstellen – Ertragsverlust.'], ['Module mit passender Spannung wählen.'], refs);
          if (v.imp > num(p.maxInA, Infinity)) add('info', 'Eingangsstrom wird begrenzt', `${d.name} Eingang ${k}: Imp ${fmt(v.imp)} A > ${fmt(p.maxInA)} A.`,
            ['Der Wechselrichter nimmt nur seinen maximalen Strom auf – der Rest wird abgeregelt. Das schadet nicht, kostet aber etwas Ertrag.'], ['Module mit kleinerem Strom oder Wechselrichter mit höherem Eingangsstrom wählen.'], refs);
        }
        const pAc = num(p.pAc, 800);
        if (pvTotal) {
          const r = pvTotal / pAc;
          ilr.push({ inst: d, pv: pvTotal, ac: pAc, r });
          d.calc = { pvP: pvTotal, ratio: r };
        }
        const grid = acNeighbors(d).some((o) => o.type === 'grid');
        if (!grid) add('error', 'Netz-Wechselrichter ohne Netz', `${d.name}: Am AC-Ausgang hängt kein Hausnetz.`,
          ['Netzgekoppelte Wechselrichter synchronisieren sich auf die Netzspannung. Ohne Netz schalten sie aus Sicherheitsgründen ab (Netz- und Anlagenschutz).', 'Sie können deshalb keine Verbraucher alleine versorgen – auch nicht bei Stromausfall.'],
          ['AC-Ausgang mit dem Hausnetz verbinden', 'für Notstrom: Hybrid- oder Insel-Wechselrichter mit Batterie verwenden.'], refs);
        if (pAc > 800) add('info', 'Mehr als 800 W Einspeiseleistung', `${d.name}: ${fmt(pAc)} W AC.`,
          ['Die vereinfachte Anmeldung als Steckersolargerät (Balkonkraftwerk) gilt in Deutschland bis 800 VA Wechselrichterleistung.', 'Darüber ist es eine normale PV-Anlage: Anmeldung beim Netzbetreiber durch eine Elektrofachkraft.'],
          ['Wechselrichter auf 800 W drosseln lassen oder als reguläre Anlage anmelden.'], refs);
        if (pvTotal > 2000) add('info', 'Mehr als 2000 Wp Modulleistung', `${d.name}: ${fmt(pvTotal)} Wp.`,
          ['Für Steckersolargeräte sind in Deutschland bis 2000 Wp Modulleistung vorgesehen.'], ['Modulleistung reduzieren oder als reguläre Anlage anmelden.'], refs);
      }

      if (d.type === 'hybrid') {
        const g = checkPv('pv+', 'pv-', {});
        if (!bg) add('info', 'Hybrid-Wechselrichter ohne Batterie', `${d.name}: Keine Batterie angeschlossen – er arbeitet wie ein reiner Netz-Wechselrichter.`,
          ['Ohne Batterie kann kein Solarstrom für abends gespeichert werden.'], ['Batteriebank an B+ / B− anschließen (Spannung beachten).'], refs);
        else if (Math.abs(bg.val.v - num(p.batV, 48)) / num(p.batV, 48) > 0.15) add('error', 'Batteriespannung passt nicht', `${d.name}: erwartet ${fmt(p.batV)} V, Bank hat ${fmt(bg.val.v)} V.`,
          ['Hybrid-Wechselrichter arbeiten nur mit dem vorgesehenen Batteriespannungsbereich.'], [`Batteriebank auf ${fmt(p.batV)} V aufbauen (${Math.round(num(p.batV, 48) / (bg.val.v / bg.val.s))} Batterien in Reihe).`], refs);
        if (g) {
          const v = g.val;
          if (v.vocCold > num(p.maxVoc, 500)) add('error', 'PV-Spannung zu hoch', `${d.name}: ${fmt(v.vocCold)} V bei Kälte, max. ${fmt(p.maxVoc)} V.`,
            ['Überspannung am PV-Eingang zerstört den Wechselrichter.'], ['Weniger Module in Reihe.'], refs);
          if (v.vmp < num(p.mpptMin, 0)) add('warn', 'PV-Spannung unter dem MPP-Bereich', `${d.name}: Vmp ${fmt(v.vmp)} V, MPP-Bereich ab ${fmt(p.mpptMin)} V.`,
            ['Hochvolt-Wechselrichter brauchen lange Strings. Unterhalb des Bereichs startet er spät oder gar nicht.'], [`Mehr Module in Reihe (mind. ${Math.ceil(num(p.mpptMin, 0) / (v.vmp / v.s))} Stück).`], refs);
          if (v.vmpHot > num(p.mpptMax, Infinity)) add('warn', 'PV-Spannung über dem MPP-Bereich', `${d.name}: Vmp ${fmt(v.vmp)} V > ${fmt(p.mpptMax)} V.`,
            ['Oberhalb des Bereichs wird abgeregelt.'], ['Ein Modul weniger in Reihe.'], refs);
          if (v.isc > num(p.maxIsc, Infinity)) add('warn', 'PV-Strom über Eingangsgrenze', `${d.name}: Isc ${fmt(v.isc)} A > ${fmt(p.maxIsc)} A.`,
            ['Zu hoher Eingangsstrom wird begrenzt oder kann den Eingang belasten.'], ['Weniger Stränge parallel.'], refs);
          ilr.push({ inst: d, pv: v.P, ac: num(p.pAc, 5000), r: v.P / num(p.pAc, 5000) });
          d.calc = { pvP: v.P, ratio: v.P / num(p.pAc, 5000) };
        }
      }

      if (d.type === 'batinv') {
        if (!bg) add('error', 'Batterie-Wechselrichter ohne Batterie', `${d.name}: keine Batteriebank angeschlossen.`, ['Ohne Batterie hat das Gerät nichts zu speichern.'], ['Batteriebank anschließen.'], refs);
        else if (Math.abs(bg.val.v - num(p.batV, 48)) / num(p.batV, 48) > 0.15) add('error', 'Batteriespannung passt nicht', `${d.name}: erwartet ${fmt(p.batV)} V, Bank hat ${fmt(bg.val.v)} V.`,
          ['Das Gerät arbeitet nur im vorgesehenen Spannungsbereich.'], [`Bank auf ${fmt(p.batV)} V aufbauen.`], refs);
        if (!acNeighbors(d).some((o) => o.type === 'grid')) add('warn', 'Batterie-Wechselrichter ohne Netz', `${d.name}: AC-Seite nicht mit dem Hausnetz verbunden.`,
          ['Bei AC-Kopplung lädt der Batterie-Wechselrichter mit Überschuss aus dem Hausnetz und speist abends zurück – dafür muss er am Hausnetz hängen.'], ['AC-Ausgang mit dem Hausnetz verbinden.'], refs);
      }

      if (d.type === 'inverter') {
        const vdc = Number(p.vdc || 12);
        if (!bg) add('error', 'Wechselrichter ohne Batterie', `${d.name}: DC-Eingang hängt nicht an einer Batteriebank.`,
          ['Insel-Wechselrichter brauchen eine stabile Gleichspannungsquelle mit hohem Strom – das kann nur eine Batterie.', 'Direkt an Solarmodule oder einen Laderegler-Ausgang angeschlossen bricht die Spannung zusammen.'], ['DC-Eingang an die Batteriebank (über Sicherung).'], refs);
        else if (sysStd !== vdc) add('error', 'Wechselrichter passt nicht zur Batteriespannung', `${d.name}: ${vdc} V-Eingang an ${fmt(sysV)} V-Bank.`,
          [sysStd > vdc ? 'Zu hohe Eingangsspannung zerstört den Wechselrichter.' : 'Bei zu niedriger Spannung schaltet er sofort wegen Unterspannung ab.'], [`Wechselrichter für ${sysStd} V wählen.`], refs, (() => { const c = pickInverter(sysStd, num(p.pCont, 0) * 0.99, 0) || pickInverter(sysStd, 0, 0); return c ? { op: 'swap', inst: d.id, spec: { productId: c.id, name: c.name }, label: `Wechselrichter durch „${c.name}" ersetzen` } : null; })());
        if (acNeighbors(d).some((o) => o.type === 'grid')) add('error', 'Insel-Wechselrichter am Hausnetz', `${d.name} ist mit dem Hausnetz verbunden.`,
          ['Ein Insel-Wechselrichter erzeugt ein eigenes Netz und darf nie mit dem öffentlichen Netz zusammengeschaltet werden – Kurzschluss zweier Spannungsquellen, Gefahr für Personen und Netz.'],
          ['Für Netzbetrieb einen Hybrid- oder Batterie-Wechselrichter mit Netzzulassung verwenden', 'oder eine Netzvorrangschaltung (Umschalter) einbauen.'], refs);
        const I = d.disI;
        if (vdc <= 12 && num(p.pCont, 0) > 1500) add(I > 250 ? 'warn' : 'tip', 'Hoher Strom bei 12 V', `${d.name}: ${fmt(p.pCont)} W an 12 V entsprechen bis zu ${fmt(I)} A.`,
          ['Leistung = Spannung × Strom. Bei 12 V braucht man für 2000 W über 180 A – dafür sind sehr dicke Kabel (≥ 50–70 mm²) und große Sicherungen nötig.', 'Bei 24 V halbiert, bei 48 V viertelt sich der Strom.'],
          ['Ab ca. 1500 W auf 24 V, ab ca. 3000 W auf 48 V wechseln.'], refs);
        if (bg && I > bg.val.maxDis * 1.05) add('warn', 'Entladestrom zu hoch für die Batterie', `${d.name}: bis ${fmt(I)} A, die Bank verträgt dauerhaft ${fmt(bg.val.maxDis)} A.`,
          ['Hohe Entladeströme senken bei Blei die nutzbare Kapazität stark (Peukert-Effekt) und erwärmen die Batterie.', 'Bei Lithium schaltet das BMS bei Überstrom ab – dann fällt der Strom plötzlich aus.'],
          isBestand(bg.insts) ? ['Größere Bank (mehr parallel) oder Batterien mit höherem Entladestrom.', BESTAND_BANK] : ['Größere Bank (mehr parallel) oder Batterien mit höherem Entladestrom.'],
          refs.concat(bg.insts.map((i) => i.id)), isBestand(bg.insts) ? null : REBUILD_BANK);
        const loads = acNeighbors(d).filter((o) => o.type === 'load_ac');
        const motor = loads.filter((o) => num(o.product.start, 1) >= 2);
        if (p.wave === 'mod' && motor.length) add('warn', 'Modifizierter Sinus mit Motoren', `${d.name}: ${motor.map((o) => o.name).join(', ')} an modifiziertem Sinus.`,
          ['Motoren, Kompressoren und Netzteile laufen an modifiziertem Sinus heißer, lauter und können ausfallen.'], ['Reinen Sinus-Wechselrichter verwenden.'], refs);
      }

      if (['charger', 'dcdc', 'wind', 'load_dc'].includes(d.type)) {
        const vdc = Number(p.vdc || 12);
        if (!bg && d.type !== 'load_dc') add('warn', `${d.t.label} ohne Batterie`, `${d.name}: nicht mit einer Batteriebank verbunden.`,
          ['Ladegeräte und Ladequellen brauchen eine Batterie als Ziel.'], ['Mit der Batteriebank verbinden.'], refs);
        if (!bg && d.type === 'load_dc' && (connected(key(d.id, '+')) || connected(key(d.id, '-')))) add('warn', 'DC-Verbraucher ohne Batterie', `${d.name}: hängt nicht an einer Batteriebank.`,
          ['DC-Verbraucher sollten an der Batterie (bzw. am Lastausgang) hängen, nicht direkt an Modulen.'], ['An die Batteriebank anschließen.'], refs);
        if (bg && sysStd && sysStd !== vdc) add('error', 'Spannung passt nicht', `${d.name}: ${vdc} V an ${fmt(sysV)} V-Bank.`,
          ['Falsche Spannung zerstört das Gerät oder lädt die Batterie falsch.'], [`Gerät für ${sysStd} V verwenden (oder DC/DC-Wandler).`], refs);
      }
      if (d.type === 'charger' && !acNeighbors(d).some((o) => ['grid', 'shore', 'generator', 'inverter', 'hybrid'].includes(o.type))) add('info', 'Ladegerät ohne Stromquelle', `${d.name}: AC-Eingang nicht mit Landstrom, Generator oder Netz verbunden.`,
        ['Ohne 230-V-Quelle lädt das Gerät nicht.'], ['AC-Eingang mit Landstrom/Generator verbinden.'], refs);
      if ((d.type === 'load_ac' || d.type === 'load_dc') && !d.ports.some((x) => connected(key(d.id, x.id)))) add('info', 'Verbraucher nicht angeschlossen', `${d.name} wird in der Berechnung nicht berücksichtigt.`, [], ['Mit Wechselrichter (230 V) bzw. Batterie (DC) verbinden.'], refs);
      if (d.type === 'load_ac' && connected(key(d.id, 'ac'))) {
        const src = acNeighbors(d).some((o) => ['inverter', 'grid', 'shore', 'generator', 'hybrid', 'micro', 'batinv'].includes(o.type));
        if (!src) add('warn', 'Verbraucher ohne Stromquelle', `${d.name}: Im AC-Kreis gibt es keine 230-V-Quelle.`, ['Verbraucher brauchen einen Wechselrichter, das Netz, Landstrom oder einen Generator.'], ['Einen Wechselrichter oder das Hausnetz anschließen.'], refs);
      }
    }

    function acNeighbors(d) {
      const ac = d.ports.find((x) => x.kind === 'ac');
      if (!ac) return [];
      const n = N(d, ac.id);
      return [...new Set(netMembers.get(n).map((k) => nodes.get(k).inst))].filter((o) => o !== d && isActive(o));
    }

    // Unverbundene Solarfelder
    for (const g of pvGroups) {
      if (g.plusNet === undefined) continue;
      const usedBy = devices.find((d) => d.ports.some((pp) => pp.role === 'pvin' && (N(d, pp.id) === g.plusNet || N(d, pp.id) === g.minusNet)));
      if (!usedBy) {
        const v = g.val;
        const tips = [];
        for (const V of [12, 24, 48]) {
          const vCh = V * 1.2;
          const a = nextSize(CTRL_SIZES_A, v.P / vCh);
          const best = bestLayout(v.n, g.insts[0], 150, vCh);
          tips.push(`Inselanlage ${V} V: MPPT-Laderegler mit mind. ${a} A Ladestrom${best ? `, z. B. ${best.s}S${best.p}P → Voc kalt ${fmt(best.vocCold)} V → Regler ≥ ${nextSize(CTRL_SIZES_V, best.vocCold * 1.05)} V` : ''}`);
        }
        tips.push(`Balkonkraftwerk / Netz: Mikro-Wechselrichter mit ${nextSize([400, 600, 800, 1600, 2000], v.P / 1.25)}–${nextSize([400, 600, 800, 1600, 2000], v.P)} W AC, je Modul ein Eingang (Voc ${fmt(g.insts[0].product.voc)} V ≤ 60 V)`);
        add('tip', 'Solarfeld noch nicht angeschlossen – was passt dazu?', `${g.label}: ${fmt(v.P)} Wp, ${layout(v)}.`,
          ['Solarmodule liefern Gleichstrom mit schwankender Spannung. Für eine Batterie braucht es einen Laderegler (kein Gleichrichter – der wandelt Wechsel- in Gleichstrom), fürs Hausnetz einen Wechselrichter.',
            'Ein MPPT-Regler holt 10–30 % mehr Energie heraus als PWM, weil er die Module im optimalen Arbeitspunkt hält.',
            `Ladestrom ≈ Modulleistung ÷ Ladespannung; die Spannungsgrenze des Reglers muss über der Leerlaufspannung bei ${settings.tMin} °C liegen.`],
          tips, g.insts.map((i) => i.id));
      }
    }

    // ---------- Simulation & Kennzahlen je Anlage ----------
    const loc = location(settings);
    const sysResults = [];
    for (const s of systems) {
      const members = new Set(s.insts.map((i) => i.id));
      const sDevices = devices.filter((d) => members.has(d.id));
      const sPv = pvGroups.filter((g) => members.has(g.insts[0].id));
      const sBat = batGroups.filter((g) => members.has(g.insts[0].id) && g.plusNet !== undefined);
      const hasLoads = sDevices.some((d) => d.type === 'load_ac' || d.type === 'load_dc' || d.type === 'grid');
      if (!sPv.length && !sBat.length && !hasLoads) continue;
      const res = simulate(s, sDevices, sPv, sBat, loc, settings, { pvGroupFor, batGroupFor, acNeighbors, wireRes, wires, groupOfInst, members });
      res.insts = [...members];
      sysResults.push(res);
    }
    // Systemweite Empfehlungen
    for (const r of sysResults) systemFindings(r, add, settings, ilr, lib, library, pickInverter);

    // Stückliste
    const bom = {};
    for (const i of insts) {
      const k = i.productId || i.product.id || i.product.name;
      if (!bom[k]) bom[k] = { name: i.product.name, type: i.type, qty: 0, price: num(i.product.price, null), url: i.product.url || '', unit: 'Stk' };
      bom[k].qty++;
    }
    for (const w of wires) {
      const k = 'cab:' + (w.cableId || w.cable.name);
      if (!bom[k]) bom[k] = { name: w.cable.name, type: 'cable', qty: 0, price: num(w.cable.pricePerM, null), url: w.cable.url || '', unit: 'm' };
      bom[k].qty += wireRes[w.id].len;
    }
    const bomList = Object.values(bom).sort((a, b) => C.CATEGORIES.indexOf(C.types[a.type].cat) - C.CATEGORIES.indexOf(C.types[b.type].cat));
    const totalCost = bomList.reduce((s, b) => s + (b.price !== null ? b.price * b.qty : 0), 0);
    const missingPrices = bomList.filter((b) => b.price === null).length;

    const order = { error: 0, warn: 1, tip: 2, info: 3, ok: 4 };
    F.sort((a, b) => order[a.sev] - order[b.sev]);
    return { findings: F, groups, systems: sysResults, wires: wireRes, ilr, bom: bomList, totalCost, missingPrices, location: loc,
      instCalc: Object.fromEntries(insts.filter((i) => i.calc).map((i) => [i.id, i.calc])) };
  }

  // ---------- Verschaltungsoptionen für ein Solarfeld ----------
  function layoutOptions(g, maxVoc, vCh, isPwm) {
    const m = g.insts[0].product;
    const n = g.val.n;
    const out = [];
    for (let s = 1; s <= n; s++) {
      if (n % s) continue;
      const p = n / s;
      const o = calcLayout(m, s, p);
      if (o.vocCold <= maxVoc && (isPwm ? s === 1 : o.vmpHot >= vCh + 5)) out.push(o);
    }
    if (out.length) out.reduce((a, b) => (b.s > a.s ? b : a)).best = true;
    return out;
  }
  function calcLayout(m, s, p) {
    const tk = num(m.tkVoc, -0.3);
    return { s, p, vocCold: s * num(m.voc, 0) * (1 + tk / 100 * (-10 - 25)), vmpHot: s * num(m.vmp, 0) * (1 + tk * 1.15 / 100 * (70 - 25)), isc: p * num(m.isc, 0) };
  }
  function bestLayout(n, inst, maxVoc, vCh) {
    let best = null;
    for (let s = 1; s <= n; s++) {
      if (n % s) continue;
      const o = calcLayout(inst.product, s, n / s);
      if (o.vocCold <= maxVoc && o.vmpHot >= vCh + 5 && (!best || s > best.s)) best = o;
    }
    return best;
  }

  // ---------- Standort & Ertrag ----------
  // Koordinaten „50.12, 8.68" oder „50,12; 8,68" (Breite, Länge in Grad, Süd/West negativ)
  function parseCoords(v) {
    const m = String(v || '').trim().match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
    if (!m) return null;
    const lat = Number(m[1].replace(',', '.')), lon = Number(m[2].replace(',', '.'));
    return Math.abs(lat) <= 75 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  }
  // Tageslänge (h) Mitte des Monats aus der Sonnendeklination
  function dayLengths(lat) {
    return [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349].map((n) => {
      const decl = 23.44 * Math.sin(2 * Math.PI * (284 + n) / 365) * Math.PI / 180;
      const x = -Math.tan(lat * Math.PI / 180) * Math.tan(decl);
      return x <= -1 ? 24 : x >= 1 ? 0 : 24 / Math.PI * Math.acos(x);
    });
  }
  // Monatsverteilung abhängig von der Neigung: steilere Module fangen die tiefe Wintersonne besser ein.
  // Der Jahresertrag bleibt der aus der Ausrichtungstabelle; verschoben wird nur zwischen den Monaten.
  // Grundlage: Mittagssonnenhöhe je Monat, Anteil direkter Strahlung (Winter trüber) und diffuses Licht.
  const BEAM = [0.3, 0.38, 0.45, 0.5, 0.55, 0.55, 0.57, 0.55, 0.5, 0.42, 0.32, 0.28];
  const DECL = [-21.3, -13.3, -2.4, 9.4, 18.8, 23.3, 21.5, 13.8, 2.2, -9.6, -19.1, -23.3];
  function tiltGain(m, tilt, lat) {
    const e = Math.max(3, 90 - Math.abs(lat) + DECL[m] * Math.sign(lat || 1)) * Math.PI / 180;
    const t = tilt * Math.PI / 180;
    const inc = Math.abs(Math.PI / 2 - e - t);
    return BEAM[m] * Math.max(0, Math.cos(inc)) / Math.sin(e) + (1 - BEAM[m]) * (1 + Math.cos(t)) / 2;
  }
  function monthCorr(tilt, dir, lat) {
    const dev = DIR_DEV[dir] !== undefined ? DIR_DEV[dir] : 0;
    const la = lat === undefined || lat === null ? 51 : lat;
    const tEff = Math.max(0, num(tilt, 30) * Math.cos(Math.min(90, dev) * Math.PI / 180)); // Ost/West: kaum Verschiebung
    const r = range(0, 12).map((m) => tiltGain(m, tEff, la) / tiltGain(m, 30, la));
    const sum = r.reduce((a, x, m) => a + x * MONTH_SHARE[m], 0);
    return r.map((x) => x / sum);
  }
  // Empfohlene Neigung nach demselben Modell: ganzjährig (Netz) bzw. bestmöglicher Dezember (Insel)
  function bestTilt(dir, lat, winter) {
    let best = 0, val = -1;
    for (let t = 0; t <= 80; t += 1) {
      const v = orientFactor(t, dir, lat) * (winter ? monthCorr(t, dir, lat)[11] : 1);
      if (v > val + 1e-9) { val = v; best = t; }
    }
    return { tilt: best, factor: val };
  }
  function location(settings) {
    const d = String(settings.plz || '').trim()[0];
    const region = d !== undefined && REGION_YIELD[d] ? d : null;
    const c = parseCoords(settings.coords);
    // ohne PLZ: Jahresertrag grob aus dem Breitengrad (Deutschland: Süden ~1180, Norden ~990 kWh/kWp)
    const latYield = c ? Math.round(Math.min(1800, Math.max(600, 1180 - 28 * (Math.abs(c.lat) - 47.5))) / 10) * 10 : null;
    const base = num(settings.yieldOverride, null) || (region ? REGION_YIELD[region] : latYield || 1000);
    const cTxt = c ? `${fmt(Math.abs(c.lat), 2)}° ${c.lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(c.lon), 2)}° ${c.lon >= 0 ? 'O' : 'W'}` : '';
    const name = region ? REGION_NAME[region] + (c ? ' · ' + cTxt : '') : c ? 'Koordinaten ' + cTxt : 'Deutschland (Durchschnitt)';
    return { region, name, annual: base, override: Boolean(num(settings.yieldOverride, null)), lat: c ? c.lat : null, lon: c ? c.lon : null,
      sun: c ? range(0, 12).map((m) => sunCurve(m, dayLengths(c.lat)[m])) : null };
  }
  function orientFactor(tilt, dir, lat) {
    let dev = DIR_DEV[dir] !== undefined ? DIR_DEV[dir] : 0;
    tilt = Math.max(0, Math.min(90, num(tilt, 30)));
    // Tabelle gilt für ca. 50° N. Weiter nördlich wirkt dieselbe Neigung „flacher", weiter südlich „steiler".
    // Südhalbkugel: Ausrichtung nach Norden ist optimal.
    if (lat !== undefined && lat !== null) {
      tilt = Math.max(0, Math.min(90, tilt - 0.76 * (Math.abs(lat) - 50)));
      if (lat < 0) dev = 180 - dev;
    }
    let ti = 0;
    while (ti < TILTS.length - 2 && TILTS[ti + 1] < tilt) ti++;
    const tf = (tilt - TILTS[ti]) / (TILTS[ti + 1] - TILTS[ti]);
    const di = Math.min(3, Math.floor(dev / 45));
    const df = (dev - di * 45) / 45;
    const row = (r) => ORIENT[r][di] + (ORIENT[r][di + 1] - ORIENT[r][di]) * df;
    return row(ti) + (row(ti + 1) - row(ti)) * tf;
  }
  // Tagesverlauf (Anteile je Stunde) für Monat m
  function sunCurve(m, lenOverride) {
    const len = lenOverride !== undefined ? lenOverride : DAYLEN[m], noon = NOON[m];
    const rise = noon - len / 2;
    const w = [];
    for (let h = 0; h < 24; h++) {
      let s = 0;
      for (let q = 0; q < 4; q++) { const t = h + (q + 0.5) / 4; if (t > rise && t < rise + len) s += Math.pow(Math.sin(Math.PI * (t - rise) / len), 1.3); }
      w.push(s);
    }
    return norm(w);
  }
  const SUN = range(0, 12).map((m) => sunCurve(m));

  function loadProfile(hours, window) {
    const hrs = WINDOW_HOURS[window] || WINDOW_HOURS.ganztags;
    const prof = new Array(24).fill(0);
    let rest = Math.max(0, Math.min(24, num(hours, 0)));
    const inWin = Math.min(rest, hrs.length);
    for (const h of hrs) prof[h] += inWin / hrs.length;
    rest -= inWin;
    if (rest > 0) for (let h = 0; h < 24; h++) if (!hrs.includes(h)) prof[h] += rest / (24 - hrs.length);
    return prof; // Anteil der Stunde in Betrieb
  }

  // ---------- Simulation einer Anlage (typischer Tag je Monat, stündlich) ----------
  function simulate(s, devs, pvs, bats, loc, settings, h) {
    const bank = bats.slice().sort((a, b) => b.val.v * b.val.ah - a.val.v * a.val.ah)[0] || null;
    const bv = bank ? bank.val : null;
    const capWh = bank ? bv.v * bv.ah : 0;
    const usableWh = bank ? capWh * bv.dod / 100 : 0;
    const etaB = bank ? Math.sqrt(bv.rt / 100) : 1;
    const hasGrid = devs.some((d) => d.type === 'grid');
    const island = !hasGrid;
    const mode = hasGrid ? (bank ? 'grid-storage' : 'grid') : (bank ? 'island' : 'none');

    // Cable loss factor je Solarfeld (Näherung: Durchschnittslast ~ 60 % → Verlust ~ 0,6 × Volllastverlust)
    const pvLoss = (g) => {
      let pct = 0;
      for (const w of h.wires) {
        const r = h.wireRes[w.id];
        const ia = w.ka.split('|')[0], ib = w.kb.split('|')[0];
        if (h.groupOfInst[ia] === g || h.groupOfInst[ib] === g) pct += r.pct;
      }
      return Math.max(0.5, 1 - pct / 100 * 0.6);
    };

    // Solarquellen
    const pvSrc = [];
    let kwp = 0;
    for (const d of devs) {
      const p = d.product;
      const inputs = d.type === 'micro' ? range(1, Number(p.inputs || 1) + 1).map((k) => `pv${k}+`) : (d.type === 'mppt' || d.type === 'hybrid') ? ['pv+'] : [];
      for (const inp of inputs) {
        const g = h.pvGroupFor(d, inp);
        if (!g || !g.reduced) continue;
        const i0 = g.insts[0];
        const of = orientFactor(i0.props.tilt, i0.props.dir, loc.lat) * (1 - num(i0.props.shade, 0) / 100);
        const mc = monthCorr(i0.props.tilt, i0.props.dir, loc.lat);
        const wpDay = range(0, 12).map((m) => loc.annual * MONTH_SHARE[m] * mc[m] / DAYS[m] * of * g.val.P); // Wh/Tag
        kwp += g.val.P / 1000;
        let limit = Infinity, eta = num(p.eta, 96) / 100, factor = pvLoss(g);
        if (d.type === 'mppt') {
          const vCh = (stdVolt(bv ? bv.v : 12) || 12) * (C.CHEM_DEFAULTS[bv ? [...bv.chem][0] : 'gel'] || C.CHEM_DEFAULTS.gel).vCharge;
          limit = ctrlA(d, 30) * vCh;
          if (p.ctype === 'pwm') factor *= Math.min(1, (vCh * 1.05) / g.val.vmp);
        }
        if (d.type === 'micro') limit = Math.min(num(p.maxInA, Infinity) * g.val.vmp * eta, Infinity);
        if (d.type === 'hybrid') limit = num(p.maxPv, Infinity);
        pvSrc.push({ d, g, wpDay, eta, factor, limit, bus: d.type === 'mppt' ? 'dc' : d.type === 'micro' ? 'ac' : 'hybrid', orient: of });
      }
    }
    // Wechselrichterleistung begrenzt Mikro-WR gesamt
    const microCap = {};
    for (const d of devs) if (d.type === 'micro') microCap[d.id] = num(d.product.pAc, 800);

    // Verbraucher
    const acLoads = devs.filter((d) => d.type === 'load_ac' && d.ports.some(() => true));
    const dcLoads = devs.filter((d) => d.type === 'load_dc' && h.batGroupFor(d));
    const gridDev = devs.find((d) => d.type === 'grid');
    const inverters = devs.filter((d) => d.type === 'inverter' && h.batGroupFor(d));
    const hybrid = devs.find((d) => d.type === 'hybrid');
    const batinv = devs.find((d) => d.type === 'batinv' && h.batGroupFor(d));
    const chargers = devs.filter((d) => d.type === 'charger' && h.batGroupFor(d));
    const shore = devs.find((d) => d.type === 'shore');
    const gen = devs.find((d) => d.type === 'generator');
    const winds = devs.filter((d) => d.type === 'wind' && h.batGroupFor(d));
    const dcdcs = devs.filter((d) => d.type === 'dcdc' && h.batGroupFor(d));
    const invCap = inverters.reduce((a, d) => a + num(d.product.pCont, 0), 0) + (hybrid && !hasGrid ? num(hybrid.product.pAc, 0) : 0);
    const invEta = inverters.length ? inverters.reduce((a, d) => a + num(d.product.eta, 92), 0) / inverters.length / 100 : hybrid ? num(hybrid.product.eta, 97) / 100 : 0.92;
    const idleW = inverters.reduce((a, d) => a + num(d.product.idle, 0), 0) + (hybrid ? num(hybrid.product.idle, 0) : 0) + (batinv ? num(batinv.product.idle, 0) : 0);
    const acPowered = (d) => h.acNeighbors(d).some((o) => ['inverter', 'grid', 'shore', 'generator', 'hybrid', 'batinv', 'micro'].includes(o.type));
    const acLoadProfiles = acLoads.filter(acPowered).map((d) => ({ d, P: num(d.product.p, 0), prof: loadProfile(d.props.hours, d.props.window), start: num(d.product.start, 1) }));
    const dcLoadProfiles = dcLoads.map((d) => ({ d, P: num(d.product.p, 0), prof: loadProfile(d.props.hours, d.props.window) }));
    const house = gridDev ? { year: num(gridDev.props.yearKwh, 0), prof: HOUSE_PROFILE[gridDev.props.profile] || HOUSE_PROFILE.haushalt } : null;
    const chgCap = chargers.reduce((a, d) => a + num(d.product.maxA, 0) * (bv ? bv.v : 12) * 1.1, 0);
    const chgEta = chargers.length ? num(chargers[0].product.eta, 88) / 100 : 0.88;
    const maxChgW = bank ? bv.maxChg * bv.v * 1.1 : 0;
    const maxDisW = bank ? bv.maxDis * bv.v : 0;
    const shoreHours = shore ? num(shore.props.hours, 24) : 0;

    // Spitzenlast AC (gleichzeitig) und Anlaufspitze
    let peakAc = 0;
    for (let hh = 0; hh < 24; hh++) peakAc = Math.max(peakAc, acLoadProfiles.reduce((a, l) => a + (l.prof[hh] > 0 ? l.P : 0), 0));
    const sumAc = acLoadProfiles.reduce((a, l) => a + l.P, 0);
    const surge = acLoadProfiles.length ? Math.max(...acLoadProfiles.map((l) => l.P * l.start - l.P)) + peakAc : 0;

    const months = [];
    for (let m = 0; m < 12; m++) {
      let soc = bank ? (island ? capWh : capWh * 0.5) : 0;
      let day;
      for (let iter = 0; iter < (bank ? 8 : 1); iter++) {
        day = { pvGen: 0, pvUsed: 0, curtailed: 0, acDemand: 0, dcDemand: 0, unmet: 0, gridImport: 0, gridExport: 0, socMin: soc, socMax: soc, genHours: 0, fuelL: 0, shoreKwh: 0, battIn: 0, battOut: 0 };
        let genOn = false;
        for (let hh = 0; hh < 24; hh++) {
          const sun = (loc.sun || SUN)[m][hh];
          // Solar
          let dcPv = 0, acPv = 0, hybPv = 0;
          const microOut = {};
          for (const src of pvSrc) {
            const raw = src.wpDay[m] * sun;
            day.pvGen += raw;
            const conv = Math.min(raw * src.factor * src.eta, src.limit);
            if (src.bus === 'dc') dcPv += conv;
            else if (src.bus === 'ac') microOut[src.d.id] = (microOut[src.d.id] || 0) + conv;
            else hybPv += Math.min(raw * src.factor, src.limit);
          }
          for (const id in microOut) acPv += Math.min(microOut[id], microCap[id]);
          const pvPotential = dcPv + acPv + hybPv;
          // Bedarf
          let acLoad = acLoadProfiles.reduce((a, l) => a + l.P * l.prof[hh], 0);
          if (house) acLoad += house.year * 1000 / 365 * HOUSE_MONTH[m] * house.prof[hh];
          const dcLoad = dcLoadProfiles.reduce((a, l) => a + l.P * l.prof[hh], 0) + idleW;
          day.acDemand += acLoad; day.dcDemand += dcLoad;
          let extraDc = winds.reduce((a, d) => a + num(d.product.kwhDay, 0) * 1000 / 24, 0);
          for (const d of dcdcs) { const hrs = num(d.props.hours, 0); if (hh >= 8 && hh < 8 + hrs) extraDc += num(d.product.maxA, 0) * bv.v * 1.1 * Math.min(1, 8 + hrs - hh); }

          const charge = (w) => { // Wh DC in die Batterie, Rest zurück
            if (!bank) return w;
            const room = (capWh - soc) / etaB;
            const c = Math.min(w, room, maxChgW);
            soc += c * etaB; day.battIn += c;
            return w - c;
          };
          const discharge = (w) => { // Wh DC benötigt, liefert Fehlmenge zurück
            if (!bank) return w;
            const avail = Math.max(0, (soc - capWh * (1 - bv.dod / 100)) * etaB);
            const d = Math.min(w, avail, maxDisW);
            soc -= d / etaB; day.battOut += d;
            return w - d;
          };

          if (!hasGrid) {
            // Inselbetrieb: AC-Last über Landstrom/Generator, sonst Wechselrichter
            let acRest = acLoad;
            let acSupply = 0;
            const shoreNow = shore && hh < shoreHours;
            if (shoreNow) acSupply += num(shore.product.maxA, 16) * 230;
            if (gen && bank && !genOn && soc < capWh * Math.max(0.3, 1 - bv.dod / 100 + 0.1)) genOn = true;
            if (gen && genOn) { acSupply += num(gen.product.p, 2000); day.genHours++; }
            const fromExt = Math.min(acRest, acSupply);
            acRest -= fromExt;
            let extLeft = acSupply - fromExt;
            // Ladegerät aus Landstrom/Generator
            let chgDc = 0;
            if (extLeft > 0 && chargers.length) chgDc = Math.min(chgCap, extLeft * chgEta);
            if (shoreNow) day.shoreKwh += fromExt + chgDc / chgEta;
            if (gen && genOn) day.fuelL += num(gen.product.fuel, 1) * Math.max(0.4, (fromExt + chgDc / chgEta) / num(gen.product.p, 2000));
            const invServe = Math.min(acRest, invCap);
            day.unmet += acRest - invServe;
            const dcNeed = invServe / invEta + dcLoad;
            let net = dcPv + hybPv * 0.97 + extraDc + chgDc - dcNeed; // Netz-WR liefern ohne Netz nichts
            if (net >= 0) { const rest = charge(net); day.curtailed += rest; day.pvUsed += Math.max(0, pvPotential - rest); }
            else { day.pvUsed += pvPotential; const miss = discharge(-net); day.unmet += miss; }
            if (gen && genOn && bank && soc >= capWh * 0.85) genOn = false;
          } else {
            // Netzbetrieb
            let need = acLoad;
            const fromMicro = Math.min(need, acPv); need -= fromMicro;
            let surplusAc = acPv - fromMicro;
            // DC-seitige Lasten (selten) direkt aus der Batterie bzw. Netz über Ladegerät ignoriert
            let hybAvail = hybPv;
            if (hybrid) {
              const hEta = num(hybrid.product.eta, 97) / 100;
              const cap = num(hybrid.product.pAc, 5000);
              const toLoad = Math.min(hybAvail * hEta, need, cap);
              need -= toLoad; hybAvail -= toLoad / hEta;
              const rest = charge(hybAvail); // DC-Kopplung: direkt in die Batterie
              const exp = Math.min(rest * hEta, cap - toLoad);
              surplusAc += exp;
              day.curtailed += Math.max(0, rest - exp / hEta);
              if (need > 0 && bank && h.batGroupFor(hybrid)) {
                const want = Math.min(need, cap - toLoad, num(hybrid.product.maxBatW, 5000)) / hEta;
                const miss = discharge(want);
                need -= (want - miss) * hEta;
              }
            }
            if (batinv && bank) {
              const bEta = num(batinv.product.eta, 95) / 100;
              const cap = num(batinv.product.pAc, 2500);
              if (surplusAc > 0) { // AC-Kopplung: Überschuss AC → DC
                const take = Math.min(surplusAc, cap);
                const rest = charge(take * bEta);
                surplusAc -= take - rest / bEta;
              }
              if (need > 0) {
                const want = Math.min(need, cap) / bEta;
                const miss = discharge(want);
                need -= (want - miss) * bEta;
              }
            }
            if (dcLoad > 0) { const miss = discharge(dcLoad); need += miss; }
            day.gridImport += need;
            day.gridExport += surplusAc;
            day.pvUsed += pvPotential;
          }
          day.socMin = Math.min(day.socMin, soc); day.socMax = Math.max(day.socMax, soc);
        }
        if (!bank) break;
      }
      day.month = m;
      day.pvYieldConv = pvSrc.reduce((a, s) => a + s.wpDay[m] * s.factor * s.eta, 0);
      months.push(day);
    }

    const sum = (f) => months.reduce((a, d, m) => a + f(d) * DAYS[m], 0) / 1000; // kWh/Jahr
    const demandYear = sum((d) => d.acDemand + d.dcDemand);
    const year = {
      pvGen: sum((d) => d.pvGen), demand: demandYear, unmet: sum((d) => d.unmet), curtailed: sum((d) => d.curtailed),
      import: sum((d) => d.gridImport), export: sum((d) => d.gridExport), genHours: months.reduce((a, d, m) => a + d.genHours * DAYS[m], 0), fuelL: months.reduce((a, d, m) => a + d.fuelL * DAYS[m], 0),
      shoreKwh: sum((d) => d.shoreKwh), battThroughput: sum((d) => d.battOut),
    };
    const avgDailyDemand = demandYear * 1000 / 365;
    // DC-Äquivalent des Tagesbedarfs (für Autonomie)
    const dcEqDaily = months.reduce((a, d) => a + (d.acDemand / invEta + d.dcDemand), 0) / 12;
    let coupling = null;
    if (bank) {
      const dcCoupled = pvSrc.some((s) => (s.bus === 'dc' || s.bus === 'hybrid') && (s.bus === 'dc' || h.batGroupFor(s.d) === bank));
      const acCoupled = Boolean(batinv) && pvSrc.some((s) => s.bus === 'ac');
      coupling = dcCoupled && acCoupled ? 'mixed' : dcCoupled ? 'dc' : acCoupled ? 'ac' : (batinv ? 'ac' : 'dc');
    }
    const price = gridDev ? num(gridDev.props.price, 35) / 100 : 0;
    const feed = gridDev ? num(gridDev.props.feedIn, 7.9) / 100 : 0;
    const selfUse = hasGrid ? Math.max(0, demandYear - year.import) : 0;
    const savings = hasGrid ? (demandYear - year.import) * price + year.export * feed : 0;
    return {
      id: s.id, mode, island, kwp, bank, capWh, usableWh, sysV: bv ? bv.v : null, months, year, avgDailyDemand, dcEqDaily,
      autonomyDays: dcEqDaily > 0 ? usableWh / dcEqDaily : null,
      coverage: demandYear > 0 ? Math.max(0, Math.min(1, 1 - year.unmet / demandYear)) : null,
      selfConsumption: hasGrid && year.pvGen > 0 ? Math.min(1, (demandYear - year.import) / Math.max(1e-9, sum((d) => d.pvYieldConv))) : null,
      autarky: hasGrid && demandYear > 0 ? 1 - year.import / demandYear : null,
      savings, price, feed, coupling, peakAc, sumAc, surge, invCap, hybrid, batinv, inverters, pvSrc, cycles: bank && usableWh ? year.battThroughput * 1000 / usableWh : 0,
      gen, shore, cyclesLife: bank ? bv.cycles : 0, invEta, hasGrid,
    };
  }

  // ---------- Systemweite Bewertung, Kopplung, Verhältnisse ----------
  function systemFindings(r, add, settings, ilr, lib, library, pickInverter) {
    const refs = r.insts;
    // gezielte Zuordnung, damit Systemwarnungen nicht jedes Bauteil markieren
    const pvRefs = r.pvSrc.flatMap((s) => s.g.insts.map((i) => i.id));
    const bankRefs = r.bank ? r.bank.insts.map((i) => i.id) : [];
    const invRefs = r.inverters.map((d) => d.id);
    const kwh = (x) => fmt(x / 1000, 1) + ' kWh';
    const worst = r.months.reduce((a, d) => (d.unmet > a.unmet ? d : a), r.months[0]);
    // Kopplung erklären
    if (r.coupling === 'dc') add('info', 'DC-gekoppeltes System', r.island ? 'Solarmodule und Batterie hängen auf derselben Gleichstromseite (Laderegler → Batterie → Wechselrichter).' : 'Solarmodule und Batterie hängen gemeinsam am Hybrid-Wechselrichter auf der Gleichstromseite.',
      ['Der Solarstrom fließt ohne Zwischenumwandlung in den Akku – nur eine Wandlung (DC→DC), deshalb hoher Wirkungsgrad beim Laden (ca. 95–98 %).', 'Ideal für Neuanlagen und Inselanlagen; Akku und PV teilen sich ein Gerät.', 'Nachteil bei Hybrid: Wechselrichter, Speicher und PV-Leistung müssen zueinander passen; Nachrüsten an bestehende Anlagen ist schwieriger.'], [], refs);
    if (r.coupling === 'ac') add('info', 'AC-gekoppeltes System', 'Der Akku ist über einen eigenen Batterie-Wechselrichter am Hausnetz angebunden; die Solarmodule speisen über ihren eigenen Wechselrichter ins Hausnetz.',
      ['Der Solarstrom wird erst in Wechselstrom umgewandelt und zum Speichern wieder in Gleichstrom – zwei zusätzliche Wandlungen, Gesamtwirkungsgrad Speicherpfad ca. 85–90 %.', 'Vorteil: Ideal zum Nachrüsten an eine bestehende PV-Anlage (oder Balkonkraftwerk), Komponenten unabhängig wählbar.'], [], refs);
    if (r.coupling === 'mixed') add('info', 'Gemischt gekoppeltes System', 'Ein Teil der Module lädt direkt (DC-Kopplung), ein anderer Teil speist über Wechselrichter ins Hausnetz und wird per Batterie-Wechselrichter gespeichert (AC-Kopplung).',
      ['Beide Wege funktionieren parallel; der DC-Pfad ist effizienter, der AC-Pfad flexibler.'], [], refs);

    // DC/AC-Verhältnis
    for (const x of ilr) {
      if (!refs.includes(x.inst.id)) continue;
      const r2 = x.r;
      const verdict = r2 < 0.8 ? 'warn' : r2 <= 1.3 ? 'ok' : r2 <= 1.5 ? 'info' : 'warn';
      add(verdict, `DC/AC-Verhältnis ${fmt(r2, 2)} – ${x.inst.name}`,
        `${fmt(x.pv)} Wp Modulleistung zu ${fmt(x.ac)} W Wechselrichter-Ausgangsleistung (auch Inverter Loading Ratio / Kapazitätsverhältnis genannt).`,
        ['Das DC/AC-Verhältnis beschreibt, wie viel Solarleistung (DC) auf die maximale Ausgangsleistung (AC) des Wechselrichters trifft. Kapazitätsverhältnis meint dasselbe: Modulleistung ÷ Wechselrichter-Nennleistung.',
          'Module erreichen ihre Nennleistung in Deutschland nur selten (Wärme, Einstrahlungswinkel). Deshalb ist ein Verhältnis von 1,1–1,3 meist wirtschaftlich optimal: Der Wechselrichter läuft öfter im effizienten Bereich, und nur wenige Spitzenstunden werden abgeregelt.',
          r2 < 0.8 ? 'Unter 0,8 ist der Wechselrichter überdimensioniert: teurer als nötig und im Teillastbereich mit schlechterem Wirkungsgrad.' : r2 > 1.5 ? 'Über 1,5 wird an sonnigen Tagen viel Energie abgeregelt (Clipping).' : r2 > 1.3 ? 'Zwischen 1,3 und 1,5 wird an Spitzentagen spürbar abgeregelt – bei Ost/West-Dächern oder Balkonen (nie volle Einstrahlung) aber oft noch sinnvoll.' : 'Der Wert liegt im empfohlenen Bereich.'],
        r2 < 0.8 ? ['Mehr Module anschließen oder kleineren Wechselrichter wählen.'] : r2 > 1.5 ? ['Größeren Wechselrichter wählen oder Module auf einen zweiten Wechselrichter verteilen.'] : [], [x.inst.id]);
    }
    for (const s of r.pvSrc) if (s.d.type === 'mppt' && s.d.calc) {
      const c = s.d.calc;
      if (c.ratio <= 1.3 && c.ratio >= 0.5) add('ok', `Solarfeld/Regler-Verhältnis ${fmt(c.ratio, 2)} – ${s.d.name}`, `${fmt(c.pvP)} Wp an ${fmt(c.pOut)} W Reglerleistung.`,
        ['Bei Ladereglern gilt dasselbe Prinzip wie beim DC/AC-Verhältnis: leichte Überbelegung bis ca. 1,3 ist sinnvoll.'], [], [s.d.id]);
    }

    // Insel: Energiebilanz
    if (r.mode === 'island') {
      const covered = r.coverage;
      if (worst.unmet > 1) {
        const decPv = r.pvSrc.reduce((a, s) => a + s.wpDay[11] * s.factor * s.eta, 0);
        const dem = r.months[11].acDemand / r.invEta + r.months[11].dcDemand;
        const loc = location(settings);
        const decPerKwp = loc.annual * MONTH_SHARE[11] / 31 * 0.9; // kWh/Tag je kWp, grob mit Verlusten
        const needKwp = r.kwp > 0 && decPv > 0 ? r.kwp * (dem / decPv) : dem / 1000 / decPerKwp;
        add('warn', `Energie reicht nicht in allen Monaten (Deckung ${fmt(covered * 100, 0)} %)`,
          `Im ${MONTHS[worst.month]} fehlen im Schnitt ${kwh(worst.unmet)} pro Tag. Betroffen: ${r.months.filter((d) => d.unmet > 1).map((d) => MONTHS[d.month]).join(', ')}.`,
          ['Im Winter liefern Module in Deutschland nur 10–20 % des Sommerertrags (kurze Tage, flacher Sonnenstand).', 'Die Batterie kann nur Tag/Nacht ausgleichen – keine Wochen ohne Sonne.',
            `Bedarf im Dezember (inkl. Wandlerverluste) ≈ ${kwh(dem)}/Tag, Ertrag ≈ ${kwh(decPv)}/Tag.`],
          [r.kwp > 0 ? `Mehr Modulleistung: für Dezember ca. ${fmt(needKwp, 1)} kWp nötig (jetzt ${fmt(r.kwp, 2)} kWp)` : `Solarmodule hinzufügen: für Dezember ca. ${fmt(needKwp, 1)} kWp nötig`, 'Module steiler stellen (60–70°): bringt im Winter mehr, im Sommer etwas weniger', 'Zusatzquelle für den Winter: Generator, Landstrom, Windgenerator', 'Verbrauch senken (effiziente Geräte, Laufzeiten verkürzen)']
            .concat(isBestand(r.pvSrc.flatMap((x) => x.g.insts)) ? ['Die Module sind als Istbestand markiert – die Automatik ergänzt deshalb keine weiteren.'] : []),
          pvRefs, modulesAuto(r, needKwp));
      } else if (r.year.demand > 0) add('ok', 'Energiebilanz ausgeglichen', `Im Durchschnittstag wird der Bedarf in allen Monaten gedeckt.`,
        ['Achtung: Berechnet wird ein durchschnittlicher Tag je Monat. Mehrere trübe Tage am Stück muss die Batterie überbrücken (siehe Autonomie).'], [], refs);
      if (r.year.curtailed > r.year.pvGen * 0.3 && r.year.pvGen > 0) add('tip', 'Viel Solarstrom bleibt ungenutzt', `Ca. ${fmt(r.year.curtailed)} kWh/Jahr (${fmt(r.year.curtailed / r.year.pvGen * 100, 0)} %) können nicht genutzt werden, weil die Batterie voll ist.`,
        ['Im Sommer erzeugt eine wintertaugliche Inselanlage zwangsläufig Überschuss.'], ['Überschuss nutzen: Warmwasser (Heizstab), Pumpen, Laden von Geräten tagsüber', 'oder Modulleistung reduzieren, wenn der Winter ohnehin anders abgedeckt wird.'], refs);
      // Autonomie & Batteriegröße
      const target = num(settings.autonomy, 2);
      if (r.dcEqDaily > 0) {
        const needUsable = r.dcEqDaily * target;
        const sysV = stdVolt(r.sysV || 12) || 12;
        const opts = [];
        const candidates = (library || []).filter((p) => p.type === 'battery');
        const pick = (chem) => candidates.filter((p) => p.chem === chem && (stdVolt(num(p.v, 12)) || 99) <= sysV).sort((a, b) => num(b.ah, 0) * num(b.v, 0) - num(a.ah, 0) * num(a.v, 0));
        const own = r.bank ? r.bank.insts[0].product : null;
        const list = [];
        if (own) list.push(own);
        for (const chem of ['gel', 'agm', 'lifepo4']) { const c = pick(chem)[0]; if (c && (!own || c.id !== own.id)) list.push(c); }
        for (const b of list) {
          const cd = C.CHEM_DEFAULTS[b.chem] || C.CHEM_DEFAULTS.gel;
          const bvn = stdVolt(num(b.v, 12)) || num(b.v, 12);
          const ser = Math.max(1, Math.round(sysV / bvn));
          const usablePer = num(b.v, 12) * ser * num(b.ah, 100) * num(b.dod, cd.dod) / 100;
          const par = Math.max(1, Math.ceil(needUsable / usablePer));
          const nTot = ser * par;
          opts.push(`${b.name}: ${nTot} Stück (${ser}S${par}P) = ${fmt(usablePer * par / 1000, 1)} kWh nutzbar${num(b.weight, 0) ? `, ${fmt(num(b.weight, 0) * nTot)} kg` : ''}${num(b.price, 0) ? `, ca. ${fmt(num(b.price, 0) * nTot)} €` : ''}`);
        }
        const auto = r.autonomyDays;
        const sev = !r.bank ? 'tip' : auto < target * 0.8 ? 'warn' : 'ok';
        add(sev, r.bank ? `Autonomie ${fmt(auto, 1)} Tage (Ziel ${fmt(target, 1)})` : 'Batterie dimensionieren',
          `Tagesbedarf inkl. Wandlerverluste ≈ ${kwh(r.dcEqDaily)}. Für ${fmt(target, 1)} Tage ohne Sonne nutzbar nötig: ${kwh(needUsable)}${r.bank ? `, vorhanden: ${kwh(r.usableWh)} nutzbar von ${kwh(r.capWh)} Nennkapazität` : ''}.`,
          ['Nutzbare Kapazität = Nennkapazität × empfohlene Entladetiefe. Blei (Gel/AGM) nur ca. 50 % – tiefer entladen halbiert die Lebensdauer. LiFePO4 ca. 90 %.',
            'Autonomie = wie viele Tage ohne Sonne die Batterie den Bedarf allein decken kann. Üblich sind 2–3 Tage (Ferienhaus) bis 5 Tage (ganzjährig ohne Generator).',
            'Gel-Batterien sind möglich und robust gegen Tiefentladung und Kälte, aber schwer, nur zu ca. 50 % nutzbar, mit begrenztem Ladestrom (ca. 0,2 C) und ca. 500–800 Zyklen. LiFePO4 kostet mehr pro Stück, hält aber 3000–6000 Zyklen und ist ca. 70 % leichter.'],
          (opts.length ? opts : [`Nutzbar ${kwh(needUsable)} nötig: bei Gel/AGM ${kwh(needUsable / 0.5)} Nennkapazität, bei LiFePO4 ${kwh(needUsable / 0.9)}.`]).concat(r.bank && isBestand(r.bank.insts) ? [BESTAND_BANK] : []),
          bankRefs, sev === 'warn' && !isBestand(r.bank.insts) ? REBUILD_BANK : null);
        if (r.bank && r.cycles > 0) {
          const years = r.cyclesLife / r.cycles;
          if (years < 5) add('warn', `Batterie-Lebensdauer ca. ${fmt(years, 1)} Jahre`, `Die Bank macht rechnerisch ${fmt(r.cycles, 0)} Vollzyklen pro Jahr bei ${fmt(r.cyclesLife, 0)} möglichen Zyklen.`,
            ['Jeder Lade-/Entladevorgang verbraucht einen Teil der Lebensdauer. Eine zu kleine Bank wird jeden Tag tief entladen.'],
            ['Größere Bank (geringere Entladetiefe pro Tag) oder Technologie mit mehr Zyklen (LiFePO4).'].concat(isBestand(r.bank.insts) ? [BESTAND_BANK] : []),
            bankRefs, isBestand(r.bank.insts) ? null : REBUILD_BANK);
        }
      }
      // Wechselrichter-Dimensionierung
      if (r.inverters.length && r.peakAc > 0) {
        const cap = r.invCap;
        const pk = r.inverters.reduce((a, d) => a + num(d.product.pPeak, num(d.product.pCont, 0) * 2), 0);
        const invSwap = (minCont, minPeak) => {
          if (r.inverters.length !== 1) return null;
          const d0 = r.inverters[0];
          const c = pickInverter(Number(d0.product.vdc), minCont, minPeak);
          return c && c.id !== d0.product.id ? { op: 'swap', inst: d0.id, spec: { productId: c.id, name: c.name }, label: `Wechselrichter durch „${c.name}" ersetzen` } : null;
        };
        const need = r.peakAc * RULES.invReserve;
        if (need > cap) add(r.peakAc > cap ? 'error' : 'warn', r.peakAc > cap ? 'Wechselrichter überlastet' : 'Wechselrichter ohne Reserve',
          `Dauerleistung ${fmt(cap)} W; zur gleichen Zeit laufen laut Nutzungszeiten bis zu ${fmt(r.peakAc)} W – mit ${fmt((RULES.invReserve - 1) * 100, 0)} % Reserve nötig: ${fmt(need)} W.`,
          ['Der Wechselrichter muss die Summe aller gleichzeitig laufenden Geräte dauerhaft liefern können, sonst schaltet er wegen Überlast ab.',
            `Die Reserve von ${fmt((RULES.invReserve - 1) * 100, 0)} % fängt Ungenauigkeiten der Nutzungszeiten ab und verhindert, dass er dauerhaft an der Grenze läuft (Hitze, Lüfter, Lebensdauer).`],
          [`Wechselrichter mit mind. ${nextSize(INV_SIZES, need)} W Dauerleistung`, 'oder große Verbraucher nicht gleichzeitig betreiben (Nutzungszeiten verteilen).'], invRefs, invSwap(need, r.surge));
        else if (r.sumAc > cap) add('info', 'Nicht alle Geräte gleichzeitig einschalten', `Alle Verbraucher zusammen hätten ${fmt(r.sumAc)} W, der Wechselrichter liefert ${fmt(cap)} W. Laut den eingestellten Nutzungszeiten laufen sie aber nie alle gleichzeitig (maximal ${fmt(r.peakAc)} W).`,
          ['Das ist so in Ordnung – nur sollten große Verbraucher (Kaffeemaschine, Mikrowelle, Wasserkocher) nicht zur selben Zeit laufen.'], [], invRefs);
        if (r.surge > pk) add('warn', 'Anlaufspitze zu hoch', `Beim Anlauf eines Motors werden bis zu ${fmt(r.surge)} W gebraucht, Spitzenleistung des Wechselrichters ${fmt(pk)} W.`,
          ['Kompressoren (Kühlschrank), Pumpen und Werkzeuge ziehen beim Start das 3–6-fache ihrer Nennleistung für Sekundenbruchteile.', 'Reicht die Spitzenleistung nicht, schaltet der Wechselrichter ab oder der Motor läuft nicht an.'],
          [`Wechselrichter mit mind. ${nextSize(INV_SIZES, r.surge / 2)} W Dauer / ${fmt(r.surge)} W Spitze`, 'oder Geräte mit Sanftanlauf/Inverter-Technik.'], invRefs, invSwap(r.peakAc, r.surge));
      }
      if (r.sysV && r.inverters.length) {
        const P = r.invCap;
        const sysV = stdVolt(r.sysV) || 12;
        const rec = P > 3000 ? 48 : P > 1500 ? 24 : 12;
        // Umbau auf höhere Spannung nur, wenn weder Batterien noch Wechselrichter/Regler als Istbestand festliegen
        const fest = isBestand(r.bank ? r.bank.insts : []) || isBestand(r.inverters) || isBestand(r.pvSrc.map((x) => x.d));
        if (rec > sysV) add('tip', `Höhere Systemspannung empfohlen (${rec} V)`, `${fmt(P)} W Wechselrichterleistung an ${sysV} V bedeuten bis zu ${fmt(P / (sysV * 0.9))} A Batteriestrom.`,
          ['Strom = Leistung ÷ Spannung: Doppelte Spannung halbiert den Strom.', 'Halber Strom bedeutet: Kabel mit einem Viertel der Verluste bei gleichem Querschnitt, kleinere Sicherungen, kleinere Laderegler (Ampere-Klasse).', 'Faustregel: bis 1500 W → 12 V, bis 3000 W → 24 V, darüber 48 V.'],
          [`Batteriebank, Wechselrichter und Laderegler auf ${rec} V auslegen.`].concat(fest ? ['Batterien, Wechselrichter oder Regler sind als Istbestand markiert – ein Umbau der Spannung ist deshalb nicht automatisch möglich.'] : []),
          refs, fest || !r.bank ? null : { op: 'rebuild', grow: true, label: `Auf ${rec} V umbauen (Batterien gleichen Typs ergänzen, Anlage neu fertigstellen)` });
      }
      if (r.gen && r.year.genHours > 0) add('info', `Generator läuft ca. ${fmt(r.year.genHours, 0)} h/Jahr`, `Kraftstoff ca. ${fmt(r.year.fuelL, 0)} l/Jahr (${fmt(r.year.fuelL * num(r.gen.product.fuelPrice, 1.85), 0)} €).`,
        ['Der Generator startet in der Simulation, wenn die Batterie unter die Entladegrenze (+10 %) fällt, und lädt bis ca. 85 %.'], [], refs);
    }

    // Neigung der Module für den Standort (gleiches Modell wie die Ertragsrechnung)
    {
      const locN = location(settings);
      const lat = locN.lat !== null ? locN.lat : 51;
      const winter = r.mode === 'island' && r.months.some((d) => d.unmet > 1);
      const seen = new Set();
      // Insel ohne Winterlücke: flacher stellen brächte nur mehr Sommerüberschuss (Batterie ist dann ohnehin voll) – kein Hinweis
      const skip = r.mode === 'island' && !winter;
      for (const src of (skip ? [] : r.pvSrc)) {
        if (seen.has(src.g)) continue;
        seen.add(src.g);
        const i0 = src.g.insts[0];
        const cur = num(i0.props.tilt, 30), dir = i0.props.dir;
        const b = bestTilt(dir, lat, winter);
        const now = orientFactor(cur, dir, lat) * (winter ? monthCorr(cur, dir, lat)[11] : 1);
        const gain = b.factor / Math.max(1e-6, now) - 1;
        if (Math.abs(b.tilt - cur) < 8 || gain < 0.03) continue;
        const fest = isBestand(src.g.insts);
        add('tip', `Neigung ${b.tilt}° statt ${fmt(cur)}° für diesen Standort`,
          `${src.g.label}: ${winter ? 'mehr Ertrag im Dezember' : 'mehr Jahresertrag'} um ca. ${fmt(gain * 100, 0)} %.`,
          [locN.lat !== null ? `Standort ${locN.name}.` : 'Ohne Koordinaten wird 51° N (Mitte Deutschlands) angenommen – im Reiter „Projekt" lassen sich die genauen Koordinaten eintragen.',
            winter ? 'Bei dieser Inselanlage reicht die Energie im Winter nicht. Steilere Module fangen die tief stehende Wintersonne besser ein (und Schnee rutscht ab) – dafür gibt es im Sommer etwas weniger, wo ohnehin Überschuss ist.'
              : 'Die Neigung mit dem höchsten Jahresertrag hängt vom Breitengrad ab: je weiter nördlich, desto steiler.',
            `Berechnet mit demselben Modell wie der Ertrag: Ausrichtungsfaktor und Monatsverteilung nach Sonnenstand (Mittagshöhe im Dezember bei ${fmt(Math.abs(lat), 1)}°: ca. ${fmt(90 - Math.abs(lat) - 23.3, 0)}°).`],
          [`Module auf ${b.tilt}° neigen (Ausrichtung ${dir || 'S'})`].concat(fest ? ['Die Module sind als Istbestand markiert. Die Neigung lässt sich trotzdem ändern, falls die Halterung das erlaubt.'] : []),
          src.g.insts.map((i) => i.id),
          { op: 'setProp', manual: true, insts: src.g.insts.map((i) => i.id), key: 'tilt', value: b.tilt, label: `Neigung aller ${src.g.insts.length} Module auf ${b.tilt}° setzen` });
      }
    }

    // Netz: Kennzahlen
    if (r.hasGrid && r.kwp > 0) {
      add('info', `Ertrag ${fmt(r.year.pvGen, 0)} kWh/Jahr, Eigenverbrauch ${fmt((r.selfConsumption || 0) * 100, 0)} %, Autarkie ${fmt((r.autarky || 0) * 100, 0)} %`,
        `Ersparnis ca. ${fmt(r.savings, 0)} €/Jahr (Bezugspreis ${fmt(r.price * 100, 1)} ct, Einspeisung ${fmt(r.feed * 100, 1)} ct).`,
        ['Eigenverbrauchsquote = Anteil des Solarstroms, der selbst genutzt wird. Autarkiegrad = Anteil des Bedarfs, der aus der eigenen Anlage kommt.', 'Selbst genutzter Strom ist ca. 4–5× mehr wert als eingespeister – deshalb lohnt es sich, Verbrauch in die Mittagszeit zu legen.'],
        r.selfConsumption !== null && r.selfConsumption < 0.4 && !r.bank ? ['Großverbraucher (Waschmaschine, Spülmaschine) mittags laufen lassen', 'Speicher prüfen, wenn abends viel verbraucht wird.'] : [], refs);
      if (r.bank) {
        const ratio = r.usableWh / 1000 / r.kwp;
        add(ratio < 0.5 || ratio > 2 ? 'tip' : 'ok', `Speicherverhältnis ${fmt(ratio, 2)} kWh nutzbar je kWp`,
          `${fmt(r.usableWh / 1000, 1)} kWh nutzbarer Speicher zu ${fmt(r.kwp, 2)} kWp.`,
          ['Faustregel für Hausanlagen: ca. 1–1,5 kWh nutzbare Speicherkapazität je kWp – bzw. so viel, wie abends und nachts verbraucht wird.', 'Ein zu großer Speicher wird im Winter nie voll und rechnet sich schlechter; ein zu kleiner ist im Sommer schon mittags voll.'],
          ratio > 2 ? ['Speicher kleiner wählen oder PV-Leistung erhöhen.'] : ratio < 0.5 ? ['Speicher vergrößern, falls abends viel verbraucht wird.'] : [], refs);
      }
    }
  }

  return { analyze, portGeom, instSize, orientFactor, location, parseCoords, bestTilt, monthCorr, MONTHS, REGION_NAME, stdVolt, loadProfile, RULES };
});
