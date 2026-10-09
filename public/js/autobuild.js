// Automatisches Fertigstellen: aus den vorhandenen Grundelementen (Module, Batterien, Verbraucher …)
// eine verdrahtete Anlage bauen – Systemspannung, Verschaltung, Laderegler, Wechselrichter, Kabel.
// Sicherungen und Kabelquerschnitte übernimmt danach die Auto-Korrektur der Engine.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog.js'), require('./engine.js'));
  else root.EM_AUTOBUILD = factory(root.EM_CATALOG, root.EM_ENGINE);
})(typeof self !== 'undefined' ? self : this, function (C, E) {
  'use strict';

  const fmt = C.fmt;
  const num = (v, d) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const STD = [12, 24, 48];
  const stdV = (v) => STD.find((x) => Math.abs(v - x) / x <= 0.15) || null;
  const uid = () => 'a' + Math.random().toString(36).slice(2, 9);
  const short = (n) => String(n || '').replace(/ \(Beispiel\)$/, '');

  function buildOnce(project, library, extra) {
    const lib = {};
    for (const p of library) lib[p.id] = p;
    const settings = Object.assign({ tMin: -10, tCell: 70 }, project.settings || {});
    const prodOf = (i) => lib[i.productId] || i.product;
    const notes = [];
    const note = (sev, title, text, why, fix) => notes.push({ sev, title, text: text || '', why: why || [], fix: fix || [], refs: [], auto: null, choices: [] });
    const added = [];
    const changed = [];

    // Vorher automatisch ergänzte Teile werden neu geplant, eigene bleiben. Sicherungen plant die Auto-Korrektur
    // nach dem Verdrahten immer neu – alte würden sonst unverbunden auf der Fläche liegen bleiben (außer Istbestand).
    const keep = (project.instances || []).filter((i) => !i.auto && prodOf(i) && (i.bestand || prodOf(i).type !== 'fuse'));
    const dropped = (project.instances || []).filter((i) => !i.auto && prodOf(i) && !i.bestand && prodOf(i).type === 'fuse');
    const insts = keep.map((i) => ({ ...i })).concat((extra || []).map((i) => ({ ...i })));
    const wires = [];
    const of = (type) => insts.filter((i) => prodOf(i).type === type);
    const libOf = (type) => library.filter((p) => p.type === type);
    const newInst = (p, why) => {
      const i = { id: uid(), productId: p.id, x: 0, y: 0, rot: 0, label: '', props: C.instDefaults(p.type, p), auto: true };
      insts.push(i);
      added.push({ name: p.name, why });
      return i;
    };
    const cable = (pred, fallback) => libOf('cable').filter(pred).sort((a, b) => num(a.area, 0) - num(b.area, 0))[0] || libOf('cable')[0] || fallback;
    const CAB = {
      pv: cable((c) => c.ctype === 'solar' && num(c.area, 0) >= 6) || cable((c) => c.ctype === 'solar'),
      dc: cable((c) => c.ctype === 'batt' && num(c.area, 0) >= 16) || cable((c) => String(c.cores) === '1'),
      ac: cable((c) => String(c.cores) !== '1' && num(c.area, 0) >= 1.5),
    };
    const W = (a, ap, b, bp, cab) => wires.push({ id: uid(), a: { inst: a.id, port: ap }, b: { inst: b.id, port: bp }, cableId: cab ? cab.id : null, lengthMode: 'auto', length: null });
    const majority = (list) => {
      const cnt = {};
      for (const i of list) cnt[i.productId] = (cnt[i.productId] || 0) + 1;
      const best = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
      return { pid: best, use: list.filter((i) => i.productId === best), rest: list.filter((i) => i.productId !== best) };
    };

    const pvs = of('pv'), bats = of('battery'), acLoads = of('load_ac'), dcLoads = of('load_dc');
    const grid = of('grid')[0] || null;
    const unused = new Set(insts.filter((i) => !['pv', 'battery', 'load_ac', 'load_dc', 'grid'].includes(prodOf(i).type)).map((i) => i.id));
    const use = (i) => unused.delete(i.id);

    if (!pvs.length && !bats.length) {
      note('error', 'Zu wenig Grundelemente', 'Es gibt weder Solarmodule noch Batterien.',
        ['Für ein Energiesystem braucht es mindestens eine Quelle (Solarmodule) und – ohne Hausnetz – einen Speicher (Batterie).'],
        ['Solarmodule und Batterien aus der Bibliothek auf die Fläche ziehen und erneut „Autom. Fertigstellen" drücken.']);
      return { instances: project.instances, wires: project.wires, notes, added, changed, ok: false };
    }

    // ---------- Lastabschätzung ----------
    let peakAc = 0, surge = 0;
    const loadPeak = [];
    for (let h = 0; h < 24; h++) {
      let s = 0;
      const on = [];
      for (const l of acLoads) { const p = prodOf(l); if (E.loadProfile(l.props.hours, l.props.window)[h] > 0) { s += num(p.p, 0); on.push(short(p.name)); } }
      if (s > peakAc) { peakAc = s; loadPeak.splice(0, loadPeak.length, ...on); }
    }
    if (acLoads.length) surge = peakAc + Math.max(...acLoads.map((l) => num(prodOf(l).p, 0) * (num(prodOf(l).start, 1) - 1)));
    const pvW = pvs.reduce((a, i) => a + num(prodOf(i).pmax, 0), 0);

    // ---------- Layout-Helfer ----------
    const pos = (i, x, y) => { i.x = Math.round(x / 10) * 10; i.y = Math.round(y / 10) * 10; };

    // ---------- Batteriebank ----------
    let bank = null; // { plus: inst, minus: inst, v, chem, strings }
    function buildBank(prefV, fixed) {
      const m = majority(bats);
      const B = lib[m.pid];
      if (m.rest.length) note('warn', 'Unterschiedliche Batterien', `${m.rest.length} Batterie(n) eines anderen Typs werden nicht eingebunden.`,
        ['In einer Bank dürfen nur gleiche Batterien (Typ, Kapazität, Spannung, Alter) zusammengeschaltet werden – sonst werden einzelne dauerhaft über- oder tiefentladen.'],
        ['Nur gleiche Batterien verwenden, die anderen getrennt nutzen.']);
      const vb = num(B.v, 12);
      const vbStd = stdV(vb) || vb;
      const n = m.use.length;
      const feasible = STD.filter((sV) => sV % vbStd === 0 && n >= sV / vbStd);
      if (!feasible.length) {
        note('error', 'Batteriespannung passt zu keinem System', `${short(B.name)} (${fmt(vb)} V) lässt sich nicht zu 12, 24 oder 48 V verschalten.`,
          ['Laderegler und Wechselrichter gibt es für 12, 24 oder 48 V. Die Bank muss eine dieser Spannungen ergeben.'], ['Batterien mit 12 V, 24 V oder 48 V Nennspannung verwenden.']);
        return null;
      }
      // Reihenfolge: Wunschspannung, dann niedrigere, dann höhere – gewählt wird die erste, mit der Module,
      // Laderegler und Wechselrichter wirklich funktionieren (gleiche Regeln wie die Prüfung)
      const fixInv = of('inverter').find((i) => i.bestand);
      const fixV = fixInv ? Number(prodOf(fixInv).vdc) : null;
      if (fixV && !feasible.includes(fixV)) {
        note('error', `Batterien passen nicht zum vorhandenen Wechselrichter (${fixV} V)`, `${short(prodOf(fixInv).name)} ist Istbestand und braucht eine ${fixV}-V-Batteriebank. Mit ${n} × ${fmt(vb)} V geht das nicht.`,
          [`Bei ${fixV} V müssen ${fixV / vbStd} Batterien in Reihe geschaltet werden.`], [`Mindestens ${fixV / vbStd} Batterien verwenden (oder ein Vielfaches davon).`]);
        return null;
      }
      const order = fixV ? [fixV] : feasible.slice().sort((a, b) => (a === prefV ? -1 : b === prefV ? 1 : (a < prefV) !== (b < prefV) ? (a < prefV ? -1 : 1) : Math.abs(a - prefV) - Math.abs(b - prefV)));
      const cd0 = C.CHEM_DEFAULTS[B.chem] || C.CHEM_DEFAULTS.gel;
      const rated = order.map((v) => {
        const pp = Math.floor(n / (v / vbStd));
        return fixed ? { v, pv: { ok: true, physics: [], library: [] }, inv: true } : { v, pv: pvCheck(v, B.chem, pp * num(B.maxChg, cd0.chgC * num(B.ah, 100))), inv: invCheck(v) };
      });
      const chosen = rated.find((r) => r.pv.ok && r.inv) || rated.find((r) => r.pv.ok) || rated[0];
      let sV = chosen.v;
      // Hinweis, wenn eine eigentlich bessere Spannung an den Modulen oder der Bibliothek gescheitert ist
      for (const r of rated) {
        if (r === chosen || r.v < sV) continue;
        if (!r.pv.physics.length && r.pv.ok && r.inv) continue;
        if (r.v !== prefV) continue;
        const why = [];
        for (const f of r.pv.physics) why.push(`${f.m} × ${short(f.M.name)}: Selbst alle in Reihe liefern bei Hitze nur ${fmt(f.maxVmpHot)} V – zum Laden einer ${r.v}-V-Batterie braucht ein MPPT-Regler mindestens ${fmt(f.need)} V (Ladespannung + ${E.RULES.mpptMargin} V).`);
        for (const f of r.pv.library) why.push(`Für ${f.m} × ${short(f.M.name)} gibt es in der Bibliothek keinen passenden ${r.v}-V-Laderegler.`);
        if (!r.inv && acLoads.length) why.push(`In der Bibliothek gibt es keinen ${r.v}-V-Wechselrichter mit ≥ ${fmt(peakAc * E.RULES.invReserve)} W.`);
        note('tip', `${sV} V statt ${r.v} V gewählt`, `Für ${fmt(Math.max(peakAc, pvW))} W wären ${r.v} V sinnvoll, damit funktioniert die Anlage aber nicht.`,
          why.concat(['Eine niedrigere Systemspannung funktioniert, bedeutet aber höhere Ströme (dickere Kabel, größere Sicherungen).']),
          r.pv.physics.map((f) => `Für ${r.v} V: mindestens ${f.needSeries} Module dieser Sorte in Reihe (also ${f.needSeries} oder ein Vielfaches davon)`)
            .concat(r.pv.physics.length ? ['oder Module mit höherer Spannung (Standard-Module mit 54–72 Zellen, Vmp ≈ 31–41 V statt 12-V-Panels)'] : [])
            .concat(r.pv.library.length || !r.inv ? ['oder passendes Gerät als eigenes Bauteil anlegen'] : []));
      }
      const s = sV / vbStd;
      const p = Math.floor(n / s);
      const used = m.use.slice(0, s * p);
      const left = m.use.slice(s * p);
      if (sV < prefV && !feasible.includes(prefV)) {
        const nNeed = prefV / vbStd;
        note('tip', `Systemspannung nur ${sV} V möglich (${prefV} V wären besser)`,
          `Für ${fmt(Math.max(peakAc, pvW))} W Leistung wären ${prefV} V sinnvoll, mit ${n} × ${fmt(vb)} V geht aber nur ${sV} V.`,
          [`Bei ${prefV} V müssen immer ${nNeed} Batterien in Reihe geschaltet werden – also eine durch ${nNeed} teilbare Anzahl.`,
            'Höhere Spannung = kleinerer Strom = dünnere Kabel, kleinere Sicherungen, weniger Verluste.'],
          [`${Math.ceil(n / nNeed) * nNeed} oder ${Math.max(nNeed, Math.floor(n / nNeed) * nNeed)} Batterien verwenden, dann baut „Autom. Fertigstellen" ein ${prefV}-V-System.`]);
      }
      if (left.length) note('warn', `${left.length} Batterie(n) nicht verwendet`, `Bei ${sV} V werden immer ${s} Batterien in Reihe geschaltet – ${left.length} bleibt/bleiben übrig.`,
        ['Jeder Strang muss gleich viele Batterien haben, sonst entstehen Ausgleichsströme zwischen den Strängen.'],
        [`Auf ${s * (p + 1)} Batterien ergänzen oder ${left.length} weglassen.`]);
      // Verschalten: Stränge (Reihe) nebeneinander, Stränge untereinander parallel
      const strings = [];
      for (let j = 0; j < p; j++) {
        const st = used.slice(j * s, j * s + s);
        for (let k = 0; k + 1 < st.length; k++) W(st[k], '-', st[k + 1], '+', CAB.dc);
        strings.push({ plus: st[0], minus: st[st.length - 1], list: st });
        st.forEach(use);
      }
      for (let j = 0; j + 1 < strings.length; j++) { W(strings[j].plus, '+', strings[j + 1].plus, '+', CAB.dc); W(strings[j].minus, '-', strings[j + 1].minus, '-', CAB.dc); }
      note('info', `Batteriebank: ${s * p} × ${short(B.name)} → ${sV} V (${s}S${p}P)`, `${fmt(sV * num(B.ah, 0) * p / 1000, 1)} kWh Nennkapazität.`,
        [s > 1 ? `${s} Batterien in Reihe ergeben ${sV} V (Spannungen addieren sich).` : `Die Batterien haben bereits ${sV} V.`, p > 1 ? `${p} Stränge parallel addieren die Kapazität.` : null].filter(Boolean), []);
      const cd = C.CHEM_DEFAULTS[B.chem] || C.CHEM_DEFAULTS.gel;
      const maxChg = p * num(B.maxChg, cd.chgC * num(B.ah, 100));
      return { strings, plus: strings[0].plus, minus: strings[strings.length - 1].minus, v: sV, chem: B.chem, B, s, p, left, maxChg };
    }

    // ---------- Solarfeld + Laderegler ----------
    function layoutsFor(M, m) {
      const out = [];
      const tk = num(M.tkVoc, -0.3);
      for (let s = 1; s <= m; s++) if (m % s === 0) {
        const p = m / s;
        out.push({ s, p, vocCold: s * num(M.voc, 0) * (1 + tk / 100 * (settings.tMin - 25)), vmpHot: s * num(M.vmp, 0) * (1 + tk * 1.15 / 100 * (settings.tCell - 25)), vmp: s * num(M.vmp, 0), isc: p * num(M.isc, 0), P: m * num(M.pmax, 0) });
      }
      return out;
    }
    function ctrlScore(c, L, vCh, sV, strict, maxChg) {
      const volts = String(c.volts || '').split(/[^0-9]+/).map(Number);
      if ((c.ctype || 'mppt') !== 'mppt' || !volts.includes(sV)) return null;
      if (num(c.maxVoc, 0) < L.vocCold * E.RULES.vocMargin || L.vmpHot < vCh + E.RULES.mpptMargin) return null;
      if (num(c.maxIsc, 0) && num(c.maxIsc, 0) < L.isc) return null;
      if (strict && num(c.maxA, 0) * vCh * E.RULES.ctrlRatioMax < L.P) return null;
      // Regler, deren Ladestrom die Batterie nicht verträgt, nur nachrangig (sonst Warnung „Ladestrom zu hoch“)
      const tooStrong = maxChg && num(c.maxA, 0) > maxChg * 1.05 ? 100000 : 0;
      return tooStrong + num(c.price, num(c.maxA, 0) * 10) - L.s * 0.01; // günstigster; bei Gleichstand längere Stränge
    }
    // Vorab-Prüfung: Schaffen die Module die Spannung (Physik) und gibt es einen passenden Regler (Bibliothek)?
    function pvGroups() {
      const g = {};
      for (const i of pvs) (g[i.productId] = g[i.productId] || []).push(i);
      return Object.keys(g).map((pid) => ({ M: lib[pid], mods: g[pid] }));
    }
    function pvCheck(sV, chem, maxChg) {
      const vCh = sV * (C.CHEM_DEFAULTS[chem] || C.CHEM_DEFAULTS.gel).vCharge;
      const need = vCh + E.RULES.mpptMargin;
      const physics = [], library = [];
      for (const { M, mods } of pvGroups()) {
        const Ls = layoutsFor(M, mods.length);
        const maxVmpHot = Math.max(...Ls.map((L) => L.vmpHot));
        if (maxVmpHot < need) {
          physics.push({ M, m: mods.length, maxVmpHot, need, needSeries: Math.ceil(need / (maxVmpHot / mods.length)) });
          continue;
        }
        if (!libOf('mppt').some((c) => Ls.some((L) => ctrlScore(c, L, vCh, sV, true, 0) !== null))) library.push({ M, m: mods.length });
      }
      return { ok: !physics.length && !library.length, physics, library };
    }
    function invCheck(sV) {
      if (!acLoads.length) return true;
      return libOf('inverter').some((p) => Number(p.vdc) === sV && num(p.pCont, 0) >= peakAc * E.RULES.invReserve && num(p.pPeak, num(p.pCont, 0) * 2) >= surge);
    }
    function buildPv(sV, bankRef) {
      const groups = {};
      for (const i of pvs) (groups[i.productId] = groups[i.productId] || []).push(i);
      const vCh = sV * (C.CHEM_DEFAULTS[bankRef ? bankRef.chem : 'gel'] || C.CHEM_DEFAULTS.gel).vCharge;
      const userCtrls = of('mppt').filter((i) => unused.has(i.id));
      const fields = [];
      for (const pid of Object.keys(groups)) {
        const mods = groups[pid];
        const M = lib[pid];
        const Ls = layoutsFor(M, mods.length);
        const pickFrom = (list, strict) => {
          let best = null;
          for (const c of list) for (const L of Ls) {
            const sc = ctrlScore(c, L, vCh, sV, strict, bankRef ? bankRef.maxChg : 0);
            if (sc !== null && (!best || sc < best.sc)) best = { c, L, sc };
          }
          return best;
        };
        // vorhandenen Regler bevorzugen, wenn er passt
        const userCtrl = userCtrls.shift();
        let best = userCtrl ? pickFrom([prodOf(userCtrl)], true) : null;
        let ctrlInst = userCtrl || null;
        // Istbestand-Regler wird nie getauscht: notfalls eine Verschaltung, die er verarbeiten kann (auch wenn er zu klein ist)
        if (!best && userCtrl && userCtrl.bestand) {
          best = pickFrom([prodOf(userCtrl)], false);
          if (!best) {
            note('error', `Vorhandener Regler passt nicht zum Solarfeld`, `${short(prodOf(userCtrl).name)} ist Istbestand, verträgt aber keine Verschaltung von ${mods.length} × ${short(M.name)} an ${sV} V.`,
              ['Der Regler muss die Batteriespannung unterstützen, die Leerlaufspannung bei Kälte aushalten und bei Hitze mindestens 5 V über der Ladespannung liegen.'],
              ['Andere Modulanzahl verwenden oder die Istbestand-Markierung des Reglers aufheben.']);
            use(userCtrl);
            continue;
          }
          if (num(prodOf(userCtrl).maxA, 0) * vCh * E.RULES.ctrlRatioMax < best.L.P) note('warn', 'Vorhandener Regler kleiner als nötig', `${short(prodOf(userCtrl).name)} (Istbestand) begrenzt auf ${fmt(prodOf(userCtrl).maxA)} A.`,
            [`Das Solarfeld liefert bis ${fmt(best.L.P)} W, bei ${fmt(vCh, 1)} V Ladespannung wären ≈ ${fmt(best.L.P / vCh)} A nötig. Der Regler regelt darüber ab.`],
            ['Zweiten Regler für einen Teil der Module ergänzen oder Istbestand-Markierung aufheben.']);
        }
        if (!best) {
          best = pickFrom(libOf('mppt'), true);
          let weak = false;
          if (!best) { best = pickFrom(libOf('mppt').sort((a, b) => num(b.maxA, 0) - num(a.maxA, 0)).slice(0, 3), false); weak = Boolean(best); }
          if (!best) {
            const need = vCh + E.RULES.mpptMargin;
            const maxVmpHot = Math.max(...Ls.map((x) => x.vmpHot));
            if (maxVmpHot < need) {
              const needSeries = Math.ceil(need / (maxVmpHot / mods.length));
              note('error', `${mods.length} × ${short(M.name)} können eine ${sV}-V-Batterie nicht laden`,
                `Selbst alle ${mods.length} Module in Reihe liefern bei Hitze nur ${fmt(maxVmpHot)} V – nötig sind mindestens ${fmt(need)} V. Das liegt an den Modulen, nicht an der Bibliothek: Dafür gibt es keinen Regler.`,
                [`Ein MPPT-Laderegler kann die Spannung nur absenken, nicht erhöhen. Die Modulspannung muss deshalb immer über der Ladespannung der Batterie liegen (${fmt(vCh, 1)} V + ${E.RULES.mpptMargin} V Abstand).`,
                  `Modulspannung sinkt bei Hitze: ${short(M.name)} hat Vmp ${fmt(M.vmp)} V, bei ${settings.tCell} °C Zelltemperatur nur ca. ${fmt(maxVmpHot / mods.length)} V.`,
                  '12-V-Panels (Vmp ≈ 18–21 V) sind für 12-V-Batterien gedacht; für 24 V braucht es 2, für 48 V 4 in Reihe.'],
                [`Mindestens ${needSeries} dieser Module in Reihe verwenden`, 'oder eine niedrigere Batteriespannung (weniger Batterien in Reihe)', 'oder Module mit höherer Spannung (Standard-Module, Vmp ≈ 31–41 V).']);
              continue;
            }
            const L = Ls.reduce((a, b) => (b.vmpHot >= need && (!a || b.s < a.s) ? b : a), null) || Ls[Ls.length - 1];
            note('error', `Kein passender Laderegler für ${mods.length} × ${short(M.name)}`, `In der Bibliothek gibt es keinen MPPT-Regler für ${sV} V, der zu diesem Solarfeld passt.`,
              [`Benötigt: ${sV}-V-Batterie, PV-Eingang ≥ ${fmt(Math.ceil(L.vocCold * E.RULES.vocMargin))} V (Leerlaufspannung bei ${settings.tMin} °C), Ladestrom ≈ ${fmt(L.P / vCh)} A (${fmt(L.P)} W ÷ ${fmt(vCh, 1)} V).`],
              ['Einen passenden Regler als eigenes Bauteil anlegen (mit Datenblattwerten) und erneut fertigstellen.']);
            continue;
          }
          if (weak) note('warn', 'Laderegler kleiner als nötig', `${short(best.c.name)} ist der größte passende Regler in der Bibliothek, begrenzt aber auf ${fmt(best.c.maxA)} A.`,
            [`Das Solarfeld liefert bis ${fmt(best.L.P)} W, bei ${fmt(vCh, 1)} V Ladespannung wären ≈ ${fmt(best.L.P / vCh)} A nötig.`, 'Der Regler regelt alles darüber ab – Ertrag geht verloren.'],
            [`Regler mit ≥ ${fmt(Math.ceil(best.L.P / vCh / 1.2))} A anlegen`, 'oder das Feld auf zwei Regler aufteilen', sV < 48 ? 'oder höhere Systemspannung (mehr Batterien in Reihe)' : null].filter(Boolean));
          if (ctrlInst) { changed.push(`${short(prodOf(ctrlInst).name)} → ${short(best.c.name)} (passte nicht zum Solarfeld/${sV} V)`); ctrlInst.productId = best.c.id; delete ctrlInst.product; }
          else ctrlInst = newInst(best.c, `Laderegler für ${mods.length} × ${short(M.name)} an ${sV} V`);
        }
        use(ctrlInst);
        const L = best.L;
        // Ladestrom: verträgt die Bank weniger als der Regler liefert, wird er im Regler begrenzt (gleiche Regel wie die Prüfung)
        const cA = num(prodOf(ctrlInst).maxA, 0);
        if (bankRef && cA > bankRef.maxChg * 1.05) {
          const lim = Math.floor(bankRef.maxChg);
          ctrlInst.props = Object.assign({}, ctrlInst.props, { chgLimit: lim });
          note('info', `Ladestrom auf ${fmt(lim)} A begrenzt`, `${short(prodOf(ctrlInst).name)} kann ${fmt(cA)} A, die Batteriebank verträgt ${fmt(bankRef.maxChg)} A.`,
            ['Zu hohe Ladeströme erwärmen die Batterie und verkürzen ihre Lebensdauer (bei Gel/AGM ca. 0,2 C).', 'Die Begrenzung wird im Regler eingestellt (Eigenschaften → Ladestrom-Begrenzung).'], []);
        } else if (ctrlInst.props && ctrlInst.props.chgLimit !== undefined && ctrlInst.props.chgLimit !== '') {
          ctrlInst.props = Object.assign({}, ctrlInst.props, { chgLimit: '' });
        }
        // Module verschalten
        const strings = [];
        for (let j = 0; j < L.p; j++) {
          const st = mods.slice(j * L.s, j * L.s + L.s);
          for (let k = 0; k + 1 < st.length; k++) W(st[k], '-', st[k + 1], '+', CAB.pv);
          strings.push({ plus: st[0], minus: st[st.length - 1], list: st });
        }
        for (let j = 0; j + 1 < strings.length; j++) W(strings[j].minus, '-', strings[j + 1].minus, '-', CAB.pv);
        // Ab 3 parallelen Strängen: je Strang eine PV-Sicherung im Plus (gleiche Regel wie die Prüfung)
        const fuses = [];
        if (strings.length >= 3) {
          const spec = pvFuse(M, L);
          for (const st of strings) {
            const fu = { id: uid(), productId: spec.productId, product: spec.product, x: 0, y: 0, rot: 0, label: '', props: {}, auto: true };
            insts.push(fu);
            fuses.push(fu);
            W(st.plus, '+', fu, 'a', CAB.pv);
          }
          for (let j = 0; j + 1 < fuses.length; j++) W(fuses[j], 'b', fuses[j + 1], 'b', CAB.pv);
          W(fuses[0], 'b', ctrlInst, 'pv+', CAB.pv);
          added.push({ name: `${fuses.length} × ${spec.name}`, why: `Strangsicherung je Strang (${L.p} Stränge parallel)` });
          note('info', `${fuses.length} Strangsicherungen (${spec.name})`, `Je Strang eine Sicherung im Plus-Leiter, ${fmt(spec.rated)} A.`,
            ['Ab 3 parallelen Strängen kann bei einem Fehler der Strom aller anderen Stränge rückwärts durch den defekten Strang fließen.',
              `Nennstrom mindestens 1,25 × 1,25 × Kurzschlussstrom des Strangs (${fmt(num(M.isc, 0))} A), höchstens ca. 2,4 × (Rückstromfestigkeit des Moduls).`], []);
        } else {
          for (let j = 0; j + 1 < strings.length; j++) W(strings[j].plus, '+', strings[j + 1].plus, '+', CAB.pv);
          W(strings[0].plus, '+', ctrlInst, 'pv+', CAB.pv);
        }
        W(strings[strings.length - 1].minus, '-', ctrlInst, 'pv-', CAB.pv);
        note('info', `Solarfeld: ${mods.length} × ${short(M.name)} → ${L.s}S${L.p}P an ${short(prodOf(ctrlInst).name)}`,
          `${fmt(L.P)} Wp, Leerlaufspannung bei ${settings.tMin} °C ${fmt(L.vocCold)} V, MPP-Spannung bei Hitze ${fmt(L.vmpHot)} V.`,
          ['Reihenschaltung erhöht die Spannung (kleinere Ströme, dünnere Kabel), muss aber unter der Reglergrenze bleiben – auch bei Kälte.',
            `Ein MPPT-Regler braucht im Betrieb mindestens ca. 5 V mehr als die Ladespannung (${fmt(vCh, 1)} V) – auch an heißen Tagen.`,
            'Gewählt wurde die günstigste passende Kombination aus Verschaltung und Regler.'], []);
        fields.push({ ctrl: ctrlInst, strings, L, fuses });
      }
      return fields;
    }
    // PV-Strangsicherung (gPV): aus der Bibliothek oder als neues Teil (wird beim Übernehmen in der Bibliothek angelegt)
    function pvFuse(M, L) {
      const isc = num(M.isc, 10);
      // gleiche Regel wie die Prüfung: Strangstrom = 1,25 × Isc, Sicherung ≥ 1,25 × Strangstrom
      const lo = isc * 1.25 * 1.25, hi = isc * 2.4;
      const vocC = L.vocCold;
      const own = libOf('fuse').filter((p) => p.ftype === 'pvfuse' && num(p.rated, 0) >= lo && num(p.rated, 0) <= hi && num(p.maxV, 0) >= vocC * E.RULES.vocMargin)
        .sort((a, b) => num(a.rated, 0) - num(b.rated, 0) || num(a.price, 1e9) - num(b.price, 1e9))[0];
      if (own) return { productId: own.id, product: undefined, name: short(own.name), rated: num(own.rated, 0) };
      const rated = [10, 12, 15, 16, 20, 25, 30, 32, 40].find((x) => x >= lo - 0.01) || Math.ceil(lo);
      const product = { type: 'fuse', name: `PV-Sicherung ${rated} A / 1000 V`, kind: 'dc', rated, maxV: 1000, ftype: 'pvfuse' };
      return { productId: 'pending:' + product.name, product, name: product.name, rated };
    }

    // ---------- Wechselrichter ----------
    function buildInverter(sV) {
      const invs = libOf('inverter').filter((p) => Number(p.vdc) === sV);
      const fits = (p) => num(p.pCont, 0) >= peakAc * E.RULES.invReserve && num(p.pPeak, num(p.pCont, 0) * 2) >= surge;
      const userInv = of('inverter').find((i) => unused.has(i.id));
      let P = userInv && fits(prodOf(userInv)) && Number(prodOf(userInv).vdc) === sV ? prodOf(userInv) : null;
      // Istbestand: bleibt, auch wenn er zu klein ist – dann nur ein Hinweis
      if (!P && userInv && userInv.bestand && Number(prodOf(userInv).vdc) === sV) {
        P = prodOf(userInv);
        note('warn', 'Vorhandener Wechselrichter zu klein', `${short(P.name)} (Istbestand) liefert ${fmt(P.pCont)} W, gleichzeitig laufen bis zu ${fmt(peakAc)} W (${loadPeak.join(', ')}).`,
          [`Mit ${fmt((E.RULES.invReserve - 1) * 100, 0)} % Reserve wären ${fmt(peakAc * E.RULES.invReserve)} W Dauer- und ${fmt(surge)} W Spitzenleistung nötig.`],
          ['Nutzungszeiten der großen Verbraucher entzerren (Eigenschaften → Nutzungszeit)', 'oder Istbestand-Markierung aufheben, dann wählt die Automatik einen passenden.']);
      }
      if (!P) P = invs.filter(fits).sort((a, b) => num(a.pCont, 0) - num(b.pCont, 0) || num(a.price, 1e9) - num(b.price, 1e9))[0] || null;
      if (!P) {
        P = invs.sort((a, b) => num(b.pCont, 0) - num(a.pCont, 0))[0] || null;
        if (!P) {
          note('error', `Kein Wechselrichter für ${sV} V in der Bibliothek`, '230-V-Verbraucher können ohne Wechselrichter nicht versorgt werden.',
            [`Der Wechselrichter muss zur Batteriespannung (${sV} V) passen und mindestens ${fmt(peakAc * E.RULES.invReserve)} W Dauer- sowie ${fmt(surge)} W Spitzenleistung haben.`],
            ['Einen passenden Wechselrichter als eigenes Bauteil anlegen.']);
          return null;
        }
        note('warn', 'Verbraucher zu stark für die verfügbaren Wechselrichter', `Gleichzeitig laufen bis zu ${fmt(peakAc)} W (${loadPeak.join(', ')}), der stärkste ${sV}-V-Wechselrichter der Bibliothek schafft ${fmt(P.pCont)} W.`,
          ['Die Summe aller gleichzeitig laufenden Geräte muss der Wechselrichter dauerhaft liefern können. Grundlage sind die eingestellten Nutzungszeiten der Verbraucher.',
            'Wasserkocher, Kaffeemaschine und Mikrowelle brauchen je 1000–2000 W – zusammen schnell mehr, als kleine Inselanlagen hergeben.'],
          ['Nutzungszeiten der großen Verbraucher entzerren (Eigenschaften → Nutzungszeit)', `größeren Wechselrichter anlegen (≥ ${fmt(Math.ceil(peakAc * E.RULES.invReserve / 100) * 100)} W)`, sV < 48 ? 'Systemspannung erhöhen' : null].filter(Boolean));
      }
      let inst = userInv;
      if (inst) {
        if (inst.productId !== P.id) { changed.push(`${short(prodOf(inst).name)} → ${short(P.name)} (passte nicht zu ${sV} V / ${fmt(peakAc)} W)`); inst.productId = P.id; delete inst.product; }
      } else inst = newInst(P, `für ${fmt(peakAc)} W gleichzeitige Last${surge > peakAc ? `, Anlaufspitze ${fmt(surge)} W` : ''}`);
      use(inst);
      if (peakAc > 0) note('info', `Wechselrichter: ${short(P.name)}`, `Gleichzeitig bis zu ${fmt(peakAc)} W (${loadPeak.join(', ')}), Anlaufspitze ${fmt(surge)} W.`,
        [`Ausgewählt wurde der kleinste passende Wechselrichter mit ≥ ${fmt((E.RULES.invReserve - 1) * 100, 0)} % Reserve – größere verbrauchen mehr im Leerlauf und kosten mehr.`,
          'Die gleichzeitige Last ergibt sich aus Leistung und Nutzungszeit der Verbraucher.'], []);
      return inst;
    }

    // ---------- Aufbau ----------
    let invInst = null, fields = [], microInsts = [], batInvInst = null;
    const microGroups = []; // { mi, mods } – Module je Mikro-Wechselrichter, für die Anordnung zusammen platziert
    const dcConvOf = new Map(); // Last-ID → DC-Spannungswandler-Instanz, für die Anordnung
    if (!grid) {
      if (!bats.length) {
        note('error', 'Batterie fehlt', 'Ohne Hausnetz braucht eine Solaranlage einen Speicher.',
          ['Solarmodule liefern nur bei Sonne und schwankend – Verbraucher brauchen eine stabile Quelle. Ein Wechselrichter oder Laderegler darf nie ohne Batterie betrieben werden.'],
          ['Batterien hinzufügen (z. B. LiFePO4 12,8 V / 100 Ah) – oder ein Hausnetz, falls es ein Balkonkraftwerk werden soll.']);
        return { instances: project.instances, wires: project.wires, notes, added, changed, ok: false };
      }
      const P = Math.max(peakAc, pvW * 0.8);
      const prefV = P > 3000 ? 48 : P > 1500 ? 24 : 12;
      bank = buildBank(prefV);
      if (!bank) return { instances: project.instances, wires: project.wires, notes, added, changed, ok: false };
      fields = pvs.length ? buildPv(bank.v, bank) : [];
      if (!pvs.length) note('warn', 'Keine Solarmodule', 'Die Batterie hat keine Ladequelle.', ['Ohne Lader ist die Batterie irgendwann leer.'], ['Solarmodule, ein Ladegerät mit Landstrom oder einen Ladebooster hinzufügen.']);
      for (const f of fields) { W(f.ctrl, 'bat+', bank.plus, '+', CAB.dc); W(f.ctrl, 'bat-', bank.minus, '-', CAB.dc); }
      if (acLoads.length) {
        invInst = buildInverter(bank.v);
        if (invInst) {
          W(bank.plus, '+', invInst, 'dc+', CAB.dc); W(bank.minus, '-', invInst, 'dc-', CAB.dc);
          for (const l of acLoads) W(invInst, 'ac', l, 'ac', CAB.ac);
        }
      }
      for (const l of dcLoads) {
        const v = Number(prodOf(l).vdc);
        if (v !== bank.v) { note('warn', `${short(prodOf(l).name)}: ${v} V passt nicht`, `Das Gerät braucht ${v} V, die Batteriebank hat ${bank.v} V.`, ['Falsche Spannung zerstört das Gerät.'], [`Gerät für ${bank.v} V wählen oder DC/DC-Wandler verwenden.`]); continue; }
        W(bank.plus, '+', l, '+', CAB.dc); W(bank.minus, '-', l, '-', CAB.dc);
      }
      // weitere Ladequellen
      for (const type of ['charger', 'dcdc', 'wind']) for (const d of of(type)) {
        if (!unused.has(d.id)) continue;
        if (Number(prodOf(d).vdc) !== bank.v) { note('warn', `${short(prodOf(d).name)} passt nicht zu ${bank.v} V`, '', ['Ladequellen müssen zur Batteriespannung passen.'], [`Gerät für ${bank.v} V wählen.`]); continue; }
        W(d, '+', bank.plus, '+', CAB.dc); W(d, '-', bank.minus, '-', CAB.dc); use(d);
        if (type === 'charger') { const src = of('shore').concat(of('generator'))[0]; if (src) { W(src, 'ac', d, 'ac', CAB.ac); use(src); } }
      }
    } else {
      // Netzbetrieb
      use(grid);
      for (const l of acLoads) W(grid, 'ac', l, 'ac', CAB.ac);
      let storageWired = false;
      if (bats.length) {
        const hy = libOf('hybrid');
        bank = buildBank(48, true);
        let built = false;
        if (bank) {
          const H = hy.find((h) => Math.abs(num(h.batV, 48) - bank.v) / num(h.batV, 48) <= 0.15);
          if (H && pvs.length) {
            const m = majority(pvs);
            const M = lib[m.pid];
            const L = layoutsFor(M, m.use.length).filter((x) => x.vocCold <= num(H.maxVoc, 500) && x.vmp >= num(H.mpptMin, 0) && x.isc <= num(H.maxIsc, Infinity)).pop();
            if (L) {
              const hInst = newInst(H, 'Hybrid-Wechselrichter: Solar + Batterie + Netz (DC-gekoppelt)');
              const strings = [];
              for (let j = 0; j < L.p; j++) {
                const st = m.use.slice(j * L.s, j * L.s + L.s);
                for (let k = 0; k + 1 < st.length; k++) W(st[k], '-', st[k + 1], '+', CAB.pv);
                strings.push({ plus: st[0], minus: st[st.length - 1], list: st });
              }
              for (let j = 0; j + 1 < strings.length; j++) { W(strings[j].plus, '+', strings[j + 1].plus, '+', CAB.pv); W(strings[j].minus, '-', strings[j + 1].minus, '-', CAB.pv); }
              W(strings[0].plus, '+', hInst, 'pv+', CAB.pv); W(strings[strings.length - 1].minus, '-', hInst, 'pv-', CAB.pv);
              W(bank.plus, '+', hInst, 'bat+', CAB.dc); W(bank.minus, '-', hInst, 'bat-', CAB.dc);
              W(hInst, 'ac', grid, 'ac', CAB.ac);
              fields.push({ ctrl: hInst, strings, L });
              note('info', `Solarfeld: ${m.use.length} × ${short(M.name)} → ${L.s}S${L.p}P am ${short(H.name)}`, `${fmt(L.P)} Wp, MPP-Spannung ${fmt(L.vmp)} V (Bereich ab ${fmt(H.mpptMin)} V), Leerlauf bei Kälte ${fmt(L.vocCold)} V (max. ${fmt(H.maxVoc)} V).`,
                ['Hybrid-Wechselrichter brauchen hohe Strangspannungen – deshalb möglichst viele Module in Reihe, aber unter der maximalen Eingangsspannung.', 'DC-Kopplung: Solarstrom lädt die Batterie ohne Umweg über Wechselstrom.'], []);
              built = true;
              storageWired = true;
            } else note('warn', 'Module passen nicht zum Hybrid-Wechselrichter', `${m.use.length} × ${short(M.name)} erreichen nicht den MPP-Bereich ab ${fmt(H.mpptMin)} V.`,
              ['Hybrid-Wechselrichter sind Hochvolt-Geräte: Sie brauchen lange Modulstränge (oft 6–10 Module in Reihe).'], ['Mehr Module verwenden – oder Mikro-Wechselrichter + Batterie-Wechselrichter (AC-Kopplung).']);
          }
          if (!built) {
            const BI = libOf('batinv').find((b) => Math.abs(num(b.batV, 48) - bank.v) / num(b.batV, 48) <= 0.15);
            if (BI) {
              batInvInst = newInst(BI, 'Batterie-Wechselrichter: Speicher am Hausnetz (AC-gekoppelt)');
              W(bank.plus, '+', batInvInst, 'bat+', CAB.dc); W(bank.minus, '-', batInvInst, 'bat-', CAB.dc); W(batInvInst, 'ac', grid, 'ac', CAB.ac);
              storageWired = true;
            } else note('warn', `Kein Speicher-Wechselrichter für ${bank.v} V`, 'Die Batterien können nicht ans Hausnetz angebunden werden.',
              ['Am Hausnetz braucht ein Speicher einen Hybrid- oder Batterie-Wechselrichter mit passender Batteriespannung (meist 48 V).'], ['Batterien auf 48 V verschalten (mehr Batterien in Reihe) oder passenden Wechselrichter anlegen.']);
          }
          // Gleichstrom-Verbraucher (z. B. 12-V-USB-Lader) direkt an die Batteriebank, sobald die ans Hausnetz
          // angebunden ist – unabhängig von AC-Kopplung (Hybrid) oder DC-Kopplung (Batterie-Wechselrichter).
          if (storageWired) {
            for (const l of dcLoads) {
              const v = Number(prodOf(l).vdc);
              if (v === bank.v) { W(bank.plus, '+', l, '+', CAB.dc); W(bank.minus, '-', l, '-', CAB.dc); continue; }
              // Spannung passt nicht direkt: passenden DC-Spannungswandler suchen (eigenes Teil bevorzugt) oder anlegen.
              const P = num(prodOf(l).p, 0);
              const fits = (c) => Number(c.vIn) === bank.v && Number(c.vOut) === v && num(c.maxW, 0) >= P;
              const userConv = of('dcconv').find((i) => unused.has(i.id) && fits(prodOf(i)));
              let convInst = userConv || null;
              if (!convInst) {
                const best = libOf('dcconv').filter(fits).sort((a, b) => num(a.price, 1e9) - num(b.price, 1e9))[0];
                if (best) convInst = newInst(best, `DC-Spannungswandler für ${short(prodOf(l).name)} (${bank.v} V → ${v} V)`);
              }
              if (convInst) {
                use(convInst);
                dcConvOf.set(l.id, convInst);
                W(bank.plus, '+', convInst, 'bat+', CAB.dc); W(bank.minus, '-', convInst, 'bat-', CAB.dc);
                W(convInst, 'out+', l, '+', CAB.dc); W(convInst, 'out-', l, '-', CAB.dc);
                note('info', `DC-Spannungswandler: ${short(prodOf(convInst).name)}`,
                  `Versorgt ${short(prodOf(l).name)} (${v} V, ${fmt(P)} W) aus der ${bank.v}-V-Batteriebank.`,
                  ['Direkter Anschluss würde das Gerät durch die falsche Spannung zerstören – der Wandler setzt die Batteriespannung auf die Gerätespannung um.'], []);
                continue;
              }
              note('warn', `${short(prodOf(l).name)}: ${v} V passt nicht`, `Das Gerät braucht ${v} V, die Batteriebank hat ${bank.v} V.`,
                ['Falsche Spannung zerstört das Gerät.'],
                [`Gerät für ${bank.v} V wählen`, `DC-Spannungswandler (${bank.v} V → ${v} V, ≥ ${fmt(P)} W) als eigenes Bauteil anlegen`, 'oder Gerät als 230-V-Verbraucher modellieren.']);
            }
          }
        }
        if (built) pvs.forEach(use);
      }
      // Module, die noch nicht am Hybrid hängen: Mikro-Wechselrichter
      const freePv = pvs.filter((i) => !fields.some((f) => f.strings.some((s) => s.plus === i || s.minus === i)) && !wires.some((w) => w.a.inst === i.id || w.b.inst === i.id));
      if (freePv.length) {
        const M = prodOf(freePv[0]);
        const vocC = num(M.voc, 0) * (1 + num(M.tkVoc, -0.3) / 100 * (settings.tMin - 25));
        // günstigste Gesamtlösung für genau diese Modulanzahl
        const costOf = (p) => Math.ceil(freePv.length / Number(p.inputs || 1)) * num(p.price, 1e6);
        const micro = libOf('micro').filter((p) => num(p.maxInV, 60) >= vocC && (!settings.simplifiedReg || num(p.pAc, 0) <= 800)).sort((a, b) => costOf(a) - costOf(b) || num(a.pAc, 0) - num(b.pAc, 0))[0];
        if (!micro) note('error', 'Kein passender Mikro-Wechselrichter', `Die Leerlaufspannung der Module (${fmt(vocC)} V bei Kälte) passt zu keinem Mikro-Wechselrichter der Bibliothek.`, ['Mikro-Wechselrichter haben meist max. 60 V Eingangsspannung.'], ['Passenden Mikro-Wechselrichter anlegen.']);
        else {
          const nIn = Number(micro.inputs || 1);
          for (let k = 0; k < freePv.length; k += nIn) {
            const mi = newInst(micro, 'Netz-Wechselrichter: je Modul ein Eingang');
            microInsts.push(mi);
            const mods = freePv.slice(k, k + nIn);
            microGroups.push({ mi, mods });
            mods.forEach((pv, idx) => { W(pv, '+', mi, `pv${idx + 1}+`, CAB.pv); W(pv, '-', mi, `pv${idx + 1}-`, CAB.pv); use(pv); });
            W(mi, 'ac', grid, 'ac', CAB.ac);
          }
        }
      }
      if (dcLoads.length && !storageWired) note('info', 'DC-Verbraucher nicht eingebunden', 'Am Hausnetz werden 230-V-Geräte versorgt; DC-Verbraucher brauchen eine Batterie mit Speicher-Wechselrichter.', [], []);
    }
    for (const id of unused) {
      const i = insts.find((x) => x.id === id);
      note('info', `${short(prodOf(i).name)} nicht verwendet`, 'Für dieses Bauteil gab es im Aufbau keinen passenden Platz.', [], ['Bei Bedarf von Hand verbinden.']);
    }

    // ---------- Anordnen (links → rechts: Solar, Regler, Batterie, Wechselrichter, Netz/Verbraucher) ----------
    // Jede Gruppe bekommt eine eigene Spalte (x-Bereich) und eigene Zeilen (y-Bereich), die sich nicht
    // überschneiden – so bleiben alle Leitungen kurz und direkt zwischen benachbarten Bauteilen nachvollziehbar.
    let x = 0;
    let maxY = 0;
    let y0 = 0;
    for (const f of fields) {
      f.strings.forEach((s, j) => s.list.forEach((m, k) => pos(m, k * 115, y0 + j * 80)));
      const sw = Math.max(...f.strings.map((s) => s.list.length)) * 115;
      const fx = f.fuses && f.fuses.length ? 90 : 0;
      (f.fuses || []).forEach((fu, j) => pos(fu, sw + 40, y0 + j * 80));
      pos(f.ctrl, sw + 60 + fx, y0 + (f.strings.length - 1) * 40 + 50);
      x = Math.max(x, sw + 60 + fx);
      y0 += f.strings.length * 80 + 70;
    }
    maxY = y0;
    x += 160;
    if (bank) {
      bank.strings.forEach((s, j) => s.list.forEach((b, k) => pos(b, x + k * 80, j * 60)));
      x += bank.s * 80 + 150;
      maxY = Math.max(maxY, bank.p * 60);
    }
    const others = insts.filter((i) => ['charger', 'dcdc', 'wind', 'shore', 'generator'].includes(prodOf(i).type) && !unused.has(i.id));
    others.forEach((o, k) => pos(o, x - 230 + (prodOf(o).type === 'shore' || prodOf(o).type === 'generator' ? -110 : 0), (bank ? bank.p * 60 : 0) + 60 + k * 60));
    maxY = Math.max(maxY, (bank ? bank.p * 60 : 0) + 60 + others.length * 60);
    // Wechselrichter am Hausnetz: entweder Insel-Wechselrichter (ohne Netz) oder Batterie-Wechselrichter (AC-gekoppelt) – nie beide zugleich.
    const mainInv = invInst || batInvInst;
    if (mainInv) { pos(mainInv, x, 0); x += 160; }
    // Mikro-Wechselrichter: jeweils mit den eigenen Modulen als kompakte Gruppe, damit die kurzen PV-Leitungen sichtbar bleiben.
    microGroups.forEach((grp, idx) => {
      const rowY = idx * 130;
      grp.mods.forEach((m, k) => pos(m, x + k * 115, rowY));
      pos(grp.mi, x + grp.mods.length * 115 + 30, rowY);
      maxY = Math.max(maxY, rowY + 100);
    });
    if (microGroups.length) x += Math.max(...microGroups.map((g) => g.mods.length)) * 115 + 30 + 140;
    if (grid) { pos(grid, x, 0); x += 130; }
    acLoads.forEach((l, k) => pos(l, x, k * 55));
    maxY = Math.max(maxY, acLoads.length * 55);
    // DC-Verbraucher: direkt an der Batteriebank, oder – falls die Spannung nicht passt – über den DC-Spannungswandler davor.
    const dcRowY0 = (bank ? bank.p * 60 : 0) + 60 + others.length * 60;
    dcLoads.forEach((l, k) => {
      const rowY = dcRowY0 + k * 60;
      const baseX = bank ? bank.plus.x : x;
      const conv = dcConvOf.get(l.id);
      if (conv) { pos(conv, baseX + 90, rowY); pos(l, baseX + 190, rowY); } else pos(l, baseX, rowY);
    });
    maxY = Math.max(maxY, dcRowY0 + dcLoads.length * 60);
    // unbenutzte Teile unten ablegen
    let ux = 0;
    for (const id of unused) { const i = insts.find((q) => q.id === id); pos(i, ux, Math.max(maxY, 300) + 120); ux += 120; }

    return { instances: insts, wires, notes, added, changed, ok: true, dropped,
      bank: bank ? { v: bank.v, s: bank.s, p: bank.p, left: bank.left.length, pid: bank.B.id, B: bank.B } : null };
  }

  // Titel der Prüfung, die eine zu kleine Batteriebank (Anzahl/Spannung) anzeigen
  const BANK_FINDINGS = [/^Entladestrom zu hoch/, /^Ladestrom zu hoch/, /^Autonomie/, /^Batterie-Lebensdauer/, /^Laderegler zu klein/, /^Hoher Strom bei 12 V/, /^Höhere Systemspannung/];

  // Fertigstellen: erst mit den vorhandenen Batterien bauen. Ist die Bank zu klein, Batterien gleichen Typs ergänzen –
  // bewertet mit derselben Prüfung (engine.analyze), die auch die Hinweise erzeugt. Istbestand-Batterien: nie ergänzen.
  function autoBuild(project, library) {
    const base = buildOnce(project, library);
    if (!base.ok || !base.bank) return base;
    const lib = {};
    for (const p of library) lib[p.id] = p;
    const userBats = (project.instances || []).filter((i) => !i.auto && (lib[i.productId] || i.product || {}).type === 'battery');
    if (userBats.some((b) => b.bestand)) return base;
    const pid = base.bank.pid;
    const B = lib[pid] || base.bank.B;
    const nUser = userBats.filter((b) => b.productId === pid).length;
    const vbStd = stdV(num(B.v, 12)) || num(B.v, 12);
    const maxN = Math.min(64, Math.max(nUser * 4, nUser + 4 * Math.max(1, 48 / vbStd)));
    const score = (res) => {
      if (!res.ok || !res.bank) return { v: Infinity, hits: [] };
      const A = E.analyze(Object.assign({}, project, { instances: res.instances, wires: res.wires }), library);
      const hits = A.findings.filter((f0) => ['error', 'warn', 'tip'].includes(f0.sev) && BANK_FINDINGS.some((re) => re.test(f0.title)));
      const notesBad = res.notes.filter((n0) => n0.sev === 'error' || n0.sev === 'warn').length;
      return { v: hits.reduce((a, f0) => a + (f0.sev === 'tip' ? 1 : 100), 0) + notesBad * 100 + (res.bank.left ? 1000 : 0), hits };
    };
    const s0 = score(base);
    let best = { n: nUser, res: base, sc: s0 };
    for (let n = nUser + 1; n <= maxN && best.sc.v > 0; n++) {
      const extra = [];
      for (let k = nUser; k < n; k++) extra.push({ id: uid(), productId: pid, x: 0, y: 0, rot: 0, label: '', props: C.instDefaults('battery', B), auto: true });
      const res = buildOnce(project, library, extra);
      const sc = score(res);
      if (sc.v < best.sc.v) best = { n, res, sc };
    }
    if (best.n === nUser) return base;
    const res = best.res;
    const geloest = s0.hits.filter((h) => !best.sc.hits.some((x) => x.title.split(' ')[0] === h.title.split(' ')[0])).map((h) => h.title.replace(/ \(.*$/, ''));
    res.added.unshift({ name: `${best.n - nUser} × ${short(B.name)}`, why: `Batteriebank auf ${best.n} Stück vergrößert (gleicher Typ)${geloest.length ? ' – behebt: ' + geloest.join(', ') : ''}` });
    res.notes.unshift({ sev: 'info', title: `Batteriebank vergrößert: ${nUser} → ${best.n} × ${short(B.name)}`,
      text: `Mit ${nUser} Batterien meldete die Prüfung: ${s0.hits.map((h) => h.title).join('; ') || 'Spannung/Verschaltung ungünstig'}.`,
      why: ['Ergänzt werden nur Batterien desselben Typs – in einer Bank dürfen keine unterschiedlichen Batterien gemischt werden.',
        'Gewählt wurde die kleinste Anzahl, bei der die Prüfung die wenigsten Probleme meldet. Grundlage sind dieselben Regeln wie bei den Hinweisen.',
        'Soll die Bank so bleiben, wie sie ist: Batterien als „Istbestand“ markieren.'], fix: [], refs: [], auto: null, choices: [] });
    return res;
  }

  return { autoBuild };
});
