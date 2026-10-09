// Bauteil-Katalog: Typen, Anschlüsse, Felder und die Start-Bibliothek.
// Gemeinsam genutzt von Browser (window.EM_CATALOG) und Server (require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EM_CATALOG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VOLTS = [
    { v: '12', l: '12 V' }, { v: '24', l: '24 V' }, { v: '48', l: '48 V' },
  ];
  const WINDOWS = [
    { v: 'ganztags', l: 'über den Tag verteilt (24 h)' },
    { v: 'morgen', l: 'morgens (6–9 Uhr)' },
    { v: 'tag', l: 'tagsüber (8–18 Uhr)' },
    { v: 'mittag', l: 'mittags (11–15 Uhr)' },
    { v: 'abend', l: 'abends (18–23 Uhr)' },
    { v: 'nacht', l: 'nachts (23–6 Uhr)' },
  ];
  const DIRS = [
    { v: 'S', l: 'Süd' }, { v: 'SO', l: 'Südost' }, { v: 'SW', l: 'Südwest' },
    { v: 'O', l: 'Ost' }, { v: 'W', l: 'West' },
    { v: 'NO', l: 'Nordost' }, { v: 'NW', l: 'Nordwest' }, { v: 'N', l: 'Nord' },
  ];
  const CHEM = [
    { v: 'gel', l: 'Gel (Blei)' },
    { v: 'agm', l: 'AGM (Blei)' },
    { v: 'nass', l: 'Blei-Säure (geflutet)' },
    { v: 'lifepo4', l: 'LiFePO4 (Lithium-Eisenphosphat)' },
    { v: 'nmc', l: 'Lithium-Ionen (NMC)' },
  ];
  // Kennwerte je Batteriechemie (Standard, falls am Produkt nichts angegeben ist)
  const CHEM_DEFAULTS = {
    gel: { dod: 50, rt: 80, chgC: 0.2, disC: 0.5, cycles: 600, lead: true, vCharge: 1.19 },
    agm: { dod: 50, rt: 82, chgC: 0.25, disC: 1.0, cycles: 500, lead: true, vCharge: 1.2 },
    nass: { dod: 50, rt: 80, chgC: 0.2, disC: 0.5, cycles: 300, lead: true, vCharge: 1.2 },
    lifepo4: { dod: 90, rt: 95, chgC: 0.5, disC: 1.0, cycles: 4000, lead: false, vCharge: 1.11 },
    nmc: { dod: 85, rt: 95, chgC: 0.5, disC: 1.0, cycles: 1500, lead: false, vCharge: 1.12 },
  };
  const AREAS = [0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240];
  // Belastbarkeit Kupfer, Einzelader frei in Luft (Näherung, Verlegeart C)
  const AMPACITY_CU = { 0.75: 12, 1: 15, 1.5: 19.5, 2.5: 27, 4: 36, 6: 46, 10: 63, 16: 85, 25: 112, 35: 138, 50: 168, 70: 213, 95: 258, 120: 299, 150: 344, 185: 392, 240: 461 };
  const RHO = { cu: 0.0178, al: 0.0287 }; // Ω·mm²/m bei 20 °C

  // Feldtypen: number, select, text, url, textarea
  const common = [
    { id: 'name', label: 'Bezeichnung', type: 'text', required: true },
    { id: 'maker', label: 'Hersteller', type: 'text' },
    { id: 'price', label: 'Preis', type: 'number', unit: '€', min: 0, step: 0.01 },
    { id: 'url', label: 'Link zum Produkt', type: 'url' },
  ];
  const tail = [{ id: 'note', label: 'Notiz', type: 'textarea' }];
  const kindSel = { id: 'kind', label: 'Stromart', type: 'select', def: 'dc', options: [{ v: 'dc', l: 'Gleichstrom (DC)' }, { v: 'ac', l: 'Wechselstrom (AC)' }] };

  const P = (id, label, side, pos, kind, pol, role) => ({ id, label, side, pos, kind, pol, role });

  const types = {
    pv: {
      label: 'Solarmodul', cat: 'Erzeugung', icon: '☀️', color: '#e0a400', w: 100, h: 60,
      fields: [
        { id: 'pmax', label: 'Nennleistung Pmax', type: 'number', unit: 'Wp', def: 400, min: 1, required: true },
        { id: 'voc', label: 'Leerlaufspannung Voc', type: 'number', unit: 'V', def: 37.1, min: 0.1, step: 0.1, required: true },
        { id: 'vmp', label: 'MPP-Spannung Vmp', type: 'number', unit: 'V', def: 31.0, min: 0.1, step: 0.1, required: true },
        { id: 'isc', label: 'Kurzschlussstrom Isc', type: 'number', unit: 'A', def: 13.8, min: 0.1, step: 0.01, required: true },
        { id: 'imp', label: 'MPP-Strom Imp', type: 'number', unit: 'A', def: 12.9, min: 0.1, step: 0.01, required: true },
        { id: 'tkVoc', label: 'Temperaturkoeffizient Voc', type: 'number', unit: '%/K', def: -0.27, step: 0.01 },
        { id: 'tkP', label: 'Temperaturkoeffizient Pmax', type: 'number', unit: '%/K', def: -0.35, step: 0.01 },
        { id: 'maxSys', label: 'max. Systemspannung', type: 'number', unit: 'V', def: 1500 },
        { id: 'dims', label: 'Abmessungen (L × B)', type: 'text', def: '1722 × 1134 mm' },
        { id: 'weight', label: 'Gewicht', type: 'number', unit: 'kg', step: 0.1 },
      ],
      inst: [
        { id: 'tilt', label: 'Neigung', type: 'number', unit: '°', def: 30, min: 0, max: 90 },
        { id: 'dir', label: 'Ausrichtung', type: 'select', def: 'S', options: DIRS },
        { id: 'shade', label: 'Verschattung', type: 'number', unit: '%', def: 0, min: 0, max: 100 },
      ],
      ports: () => [P('-', '−', 'l', 0.5, 'dc', '-', 'pv'), P('+', '+', 'r', 0.5, 'dc', '+', 'pv')],
      spec: (p) => `${fmt(p.pmax)} Wp · Voc ${fmt(p.voc)} V`,
    },
    wind: {
      label: 'Windgenerator', cat: 'Erzeugung', icon: '🌬️', color: '#4fb3d9', w: 60, h: 50,
      fields: [
        { id: 'vdc', label: 'Ausgangsspannung (Batterie)', type: 'select', def: '12', options: VOLTS },
        { id: 'prated', label: 'Nennleistung', type: 'number', unit: 'W', def: 400, min: 1 },
        { id: 'kwhDay', label: 'erwarteter Ertrag (Durchschnitt)', type: 'number', unit: 'kWh/Tag', def: 0.5, min: 0, step: 0.1 },
        { id: 'maxA', label: 'max. Ladestrom', type: 'number', unit: 'A', def: 30 },
      ],
      ports: () => [P('+', '+', 'r', 0.66, 'dc', '+', 'bat'), P('-', '−', 'r', 0.86, 'dc', '-', 'bat')],
      spec: (p) => `${fmt(p.prated)} W · ${p.vdc} V`,
    },
    generator: {
      label: 'Stromerzeuger', cat: 'Erzeugung', icon: '⛽', color: '#c46b3a', w: 60, h: 44,
      fields: [
        { id: 'p', label: 'Dauerleistung', type: 'number', unit: 'W', def: 2000, min: 1 },
        { id: 'fuel', label: 'Verbrauch bei Volllast', type: 'number', unit: 'l/h', def: 1.0, step: 0.1 },
        { id: 'fuelPrice', label: 'Kraftstoffpreis', type: 'number', unit: '€/l', def: 1.85, step: 0.01 },
      ],
      ports: () => [P('ac', 'AC', 'r', 0.75, 'ac', null, 'src')],
      spec: (p) => `${fmt(p.p)} W`,
    },
    shore: {
      label: 'Landstrom / Außensteckdose', cat: 'Erzeugung', icon: '🔌', color: '#8e7cc3', w: 56, h: 44,
      fields: [{ id: 'maxA', label: 'Absicherung', type: 'number', unit: 'A', def: 16 }],
      inst: [
        { id: 'hours', label: 'verfügbar', type: 'number', unit: 'h/Tag', def: 24, min: 0, max: 24 },
        { id: 'price', label: 'Strompreis', type: 'number', unit: 'ct/kWh', def: 50, min: 0 },
      ],
      ports: () => [P('ac', 'AC', 'r', 0.75, 'ac', null, 'src')],
      spec: (p) => `${fmt(p.maxA)} A · 230 V`,
    },
    mppt: {
      label: 'Laderegler', cat: 'Laderegler & Wandler', icon: '🔀', color: '#3fae6a', w: 64, h: 60,
      fields: [
        { id: 'ctype', label: 'Reglertyp', type: 'select', def: 'mppt', options: [{ v: 'mppt', l: 'MPPT' }, { v: 'pwm', l: 'PWM' }] },
        { id: 'maxVoc', label: 'max. PV-Leerlaufspannung', type: 'number', unit: 'V', def: 100, required: true },
        { id: 'maxA', label: 'max. Ladestrom', type: 'number', unit: 'A', def: 30, required: true },
        { id: 'maxIsc', label: 'max. PV-Kurzschlussstrom', type: 'number', unit: 'A', def: 35 },
        { id: 'volts', label: 'Batteriespannungen', type: 'text', def: '12/24', hint: 'z. B. 12/24 oder 12/24/48' },
        { id: 'eta', label: 'Wirkungsgrad', type: 'number', unit: '%', def: 97, min: 50, max: 100 },
      ],
      // Einstellung im Regler: Ladestrom unter das Datenblatt-Maximum begrenzen (z. B. wegen kleiner Gel-Bank). Leer = keine Begrenzung.
      inst: [{ id: 'chgLimit', label: 'Ladestrom-Begrenzung', type: 'number', unit: 'A', def: '', min: 0, hint: 'leer = max. Ladestrom des Reglers' }],
      ports: () => [
        P('pv+', 'PV+', 'l', 0.58, 'dc', '+', 'pvin'), P('pv-', 'PV−', 'l', 0.85, 'dc', '-', 'pvin'),
        P('bat+', 'B+', 'r', 0.58, 'dc', '+', 'bat'), P('bat-', 'B−', 'r', 0.85, 'dc', '-', 'bat'),
      ],
      spec: (p) => `${(p.ctype || 'mppt').toUpperCase()} ${fmt(p.maxVoc)} V / ${fmt(p.maxA)} A`,
    },
    dcdc: {
      label: 'Ladebooster (Lichtmaschine)', cat: 'Laderegler & Wandler', icon: '🚐', color: '#5d9c8f', w: 60, h: 50,
      fields: [
        { id: 'vdc', label: 'Ausgangsspannung', type: 'select', def: '12', options: VOLTS },
        { id: 'maxA', label: 'Ladestrom', type: 'number', unit: 'A', def: 30 },
      ],
      inst: [{ id: 'hours', label: 'Fahrzeit', type: 'number', unit: 'h/Tag', def: 1, min: 0, max: 24, step: 0.5 }],
      ports: () => [P('+', '+', 'r', 0.66, 'dc', '+', 'bat'), P('-', '−', 'r', 0.86, 'dc', '-', 'bat')],
      spec: (p) => `${p.vdc} V · ${fmt(p.maxA)} A`,
    },
    dcconv: {
      label: 'DC-Spannungswandler', cat: 'Laderegler & Wandler', icon: '🔀', color: '#4a90a4', w: 64, h: 50,
      fields: [
        { id: 'vIn', label: 'Eingangsspannung (Batterie)', type: 'select', def: '48', options: VOLTS, required: true },
        { id: 'vOut', label: 'Ausgangsspannung (Verbraucher)', type: 'select', def: '12', options: VOLTS, required: true },
        { id: 'maxW', label: 'max. Ausgangsleistung', type: 'number', unit: 'W', def: 120, required: true },
        { id: 'eta', label: 'Wirkungsgrad', type: 'number', unit: '%', def: 90, min: 50, max: 100 },
      ],
      ports: () => [
        P('bat+', 'B+', 'l', 0.58, 'dc', '+', 'bat'), P('bat-', 'B−', 'l', 0.85, 'dc', '-', 'bat'),
        P('out+', 'Aus+', 'r', 0.58, 'dc', '+', 'bat'), P('out-', 'Aus−', 'r', 0.85, 'dc', '-', 'bat'),
      ],
      spec: (p) => `${p.vIn} V → ${p.vOut} V · ${fmt(p.maxW)} W`,
    },
    charger: {
      label: 'Batterie-Ladegerät (230 V)', cat: 'Laderegler & Wandler', icon: '🔋', color: '#6b8fd6', w: 60, h: 50,
      fields: [
        { id: 'vdc', label: 'Batteriespannung', type: 'select', def: '12', options: VOLTS },
        { id: 'maxA', label: 'Ladestrom', type: 'number', unit: 'A', def: 30 },
        { id: 'eta', label: 'Wirkungsgrad', type: 'number', unit: '%', def: 88, min: 50, max: 100 },
      ],
      ports: () => [P('ac', 'AC', 'l', 0.76, 'ac', null, 'acin'), P('+', '+', 'r', 0.66, 'dc', '+', 'bat'), P('-', '−', 'r', 0.86, 'dc', '-', 'bat')],
      spec: (p) => `${p.vdc} V · ${fmt(p.maxA)} A`,
    },
    battery: {
      label: 'Batterie', cat: 'Speicher', icon: '🔋', color: '#2f9e44', w: 60, h: 46,
      fields: [
        { id: 'chem', label: 'Technologie', type: 'select', def: 'gel', options: CHEM, required: true },
        { id: 'v', label: 'Nennspannung', type: 'number', unit: 'V', def: 12, step: 0.1, required: true },
        { id: 'ah', label: 'Kapazität (C20)', type: 'number', unit: 'Ah', def: 100, required: true },
        { id: 'dod', label: 'empfohlene Entladetiefe', type: 'number', unit: '%', hint: 'leer = Standard der Technologie', min: 10, max: 100 },
        { id: 'maxChg', label: 'max. Ladestrom', type: 'number', unit: 'A', hint: 'leer = Standard der Technologie' },
        { id: 'maxDis', label: 'max. Entladestrom (dauernd)', type: 'number', unit: 'A', hint: 'leer = Standard der Technologie' },
        { id: 'cycles', label: 'Zyklen (bei empf. Entladetiefe)', type: 'number', hint: 'leer = Standard der Technologie' },
        { id: 'rt', label: 'Wirkungsgrad Laden+Entladen', type: 'number', unit: '%', hint: 'leer = Standard der Technologie' },
        { id: 'weight', label: 'Gewicht', type: 'number', unit: 'kg', step: 0.1 },
      ],
      ports: () => [P('-', '−', 'l', 0.74, 'dc', '-', 'cell'), P('+', '+', 'r', 0.74, 'dc', '+', 'cell')],
      spec: (p) => `${fmt(p.v)} V · ${fmt(p.ah)} Ah · ${chemLabel(p.chem)}`,
    },
    inverter: {
      label: 'Insel-Wechselrichter', cat: 'Wechselrichter', icon: '〰️', color: '#d9534f', w: 70, h: 60,
      fields: [
        { id: 'vdc', label: 'Eingangsspannung (Batterie)', type: 'select', def: '12', options: VOLTS, required: true },
        { id: 'pCont', label: 'Dauerleistung', type: 'number', unit: 'W', def: 1000, required: true },
        { id: 'pPeak', label: 'Spitzenleistung', type: 'number', unit: 'W', def: 2000 },
        { id: 'eta', label: 'Wirkungsgrad', type: 'number', unit: '%', def: 92, min: 50, max: 100 },
        { id: 'idle', label: 'Eigenverbrauch (Leerlauf)', type: 'number', unit: 'W', def: 10 },
        { id: 'wave', label: 'Ausgangsspannung', type: 'select', def: 'sinus', options: [{ v: 'sinus', l: 'reiner Sinus' }, { v: 'mod', l: 'modifizierter Sinus' }] },
      ],
      ports: () => [P('dc+', '+', 'l', 0.58, 'dc', '+', 'bat'), P('dc-', '−', 'l', 0.85, 'dc', '-', 'bat'), P('ac', 'AC', 'r', 0.71, 'ac', null, 'acout')],
      spec: (p) => `${p.vdc} V → 230 V · ${fmt(p.pCont)} W`,
    },
    micro: {
      label: 'Netz-/Mikro-Wechselrichter', cat: 'Wechselrichter', icon: '🏠', color: '#e07b39', w: 64, h: 100,
      fields: [
        { id: 'inputs', label: 'Anzahl PV-Eingänge', type: 'select', def: '2', options: [{ v: '1', l: '1' }, { v: '2', l: '2' }, { v: '4', l: '4' }] },
        { id: 'maxInV', label: 'max. Eingangsspannung', type: 'number', unit: 'V', def: 60, required: true },
        { id: 'mpptMin', label: 'MPP-Bereich von', type: 'number', unit: 'V', def: 16 },
        { id: 'mpptMax', label: 'MPP-Bereich bis', type: 'number', unit: 'V', def: 60 },
        { id: 'maxInA', label: 'max. Eingangsstrom je Eingang', type: 'number', unit: 'A', def: 14 },
        { id: 'pAc', label: 'AC-Ausgangsleistung', type: 'number', unit: 'W', def: 800, required: true },
        { id: 'eta', label: 'Wirkungsgrad', type: 'number', unit: '%', def: 95.5, min: 50, max: 100 },
      ],
      ports: (p) => {
        const n = Number(p.inputs) || 1;
        const out = [];
        for (let i = 1; i <= n; i++) {
          const base = 0.38 + 0.58 * (i - 0.5) / n;
          const span = 0.28 / n;
          out.push(P(`pv${i}+`, `PV${i}+`, 'l', base - span / 2, 'dc', '+', 'pvin'), P(`pv${i}-`, `PV${i}−`, 'l', base + span / 2, 'dc', '-', 'pvin'));
        }
        out.push(P('ac', 'AC', 'r', 0.67, 'ac', null, 'acgrid'));
        return out;
      },
      spec: (p) => `${p.inputs}× PV · ${fmt(p.pAc)} W AC`,
    },
    hybrid: {
      label: 'Hybrid-Wechselrichter', cat: 'Wechselrichter', icon: '⚡', color: '#c0392b', w: 80, h: 80,
      fields: [
        { id: 'batV', label: 'Batteriespannung (nominal)', type: 'number', unit: 'V', def: 48, required: true },
        { id: 'maxVoc', label: 'max. PV-Eingangsspannung', type: 'number', unit: 'V', def: 500, required: true },
        { id: 'mpptMin', label: 'MPP-Bereich von', type: 'number', unit: 'V', def: 120 },
        { id: 'mpptMax', label: 'MPP-Bereich bis', type: 'number', unit: 'V', def: 450 },
        { id: 'maxIsc', label: 'max. PV-Strom', type: 'number', unit: 'A', def: 18 },
        { id: 'maxPv', label: 'max. PV-Leistung', type: 'number', unit: 'Wp', def: 6500 },
        { id: 'pAc', label: 'AC-Nennleistung', type: 'number', unit: 'W', def: 5000, required: true },
        { id: 'maxBatW', label: 'max. Lade-/Entladeleistung Batterie', type: 'number', unit: 'W', def: 5000 },
        { id: 'eta', label: 'Wirkungsgrad', type: 'number', unit: '%', def: 97, min: 50, max: 100 },
        { id: 'idle', label: 'Eigenverbrauch', type: 'number', unit: 'W', def: 25 },
      ],
      ports: () => [
        P('pv+', 'PV+', 'l', 0.42, 'dc', '+', 'pvin'), P('pv-', 'PV−', 'l', 0.56, 'dc', '-', 'pvin'),
        P('bat+', 'B+', 'l', 0.74, 'dc', '+', 'bat'), P('bat-', 'B−', 'l', 0.88, 'dc', '-', 'bat'),
        P('ac', 'AC', 'r', 0.65, 'ac', null, 'acgrid'),
      ],
      spec: (p) => `${fmt(p.pAc)} W · Batt. ${fmt(p.batV)} V`,
    },
    batinv: {
      label: 'Batterie-Wechselrichter (AC-Kopplung)', cat: 'Wechselrichter', icon: '🔁', color: '#9b59b6', w: 70, h: 60,
      fields: [
        { id: 'batV', label: 'Batteriespannung (nominal)', type: 'number', unit: 'V', def: 48, required: true },
        { id: 'pAc', label: 'Lade-/Entladeleistung AC', type: 'number', unit: 'W', def: 2500, required: true },
        { id: 'eta', label: 'Wirkungsgrad je Richtung', type: 'number', unit: '%', def: 95, min: 50, max: 100 },
        { id: 'idle', label: 'Eigenverbrauch', type: 'number', unit: 'W', def: 10 },
      ],
      ports: () => [P('bat+', 'B+', 'l', 0.58, 'dc', '+', 'bat'), P('bat-', 'B−', 'l', 0.85, 'dc', '-', 'bat'), P('ac', 'AC', 'r', 0.71, 'ac', null, 'acgrid')],
      spec: (p) => `${fmt(p.pAc)} W · Batt. ${fmt(p.batV)} V`,
    },
    load_ac: {
      label: 'Verbraucher 230 V', cat: 'Verbraucher', icon: '💡', color: '#7f8c8d', w: 56, h: 44,
      fields: [
        { id: 'p', label: 'Leistung', type: 'number', unit: 'W', def: 60, min: 0, required: true },
        { id: 'start', label: 'Anlauffaktor', type: 'number', def: 1, min: 1, max: 10, step: 0.5, hint: 'Motoren/Kompressoren 3–6' },
        { id: 'hoursDef', label: 'Übliche Laufzeit', type: 'number', unit: 'h/Tag', def: 2, min: 0, max: 24, step: 0.25, hint: 'Vorgabe beim Platzieren; Kühlgeräte: reine Kompressor-Laufzeit' },
        { id: 'windowDef', label: 'Übliche Nutzungszeit', type: 'select', def: 'abend', options: WINDOWS },
      ],
      inst: [
        { id: 'hours', label: 'Laufzeit', type: 'number', unit: 'h/Tag', def: 4, min: 0, max: 24, step: 0.25 },
        { id: 'window', label: 'Nutzungszeit', type: 'select', def: 'abend', options: WINDOWS },
      ],
      ports: () => [P('ac', 'AC', 'l', 0.75, 'ac', null, 'load')],
      spec: (p) => `${fmt(p.p)} W`,
    },
    load_dc: {
      label: 'Verbraucher DC', cat: 'Verbraucher', icon: '🔦', color: '#95a5a6', w: 56, h: 50,
      fields: [
        { id: 'vdc', label: 'Spannung', type: 'select', def: '12', options: VOLTS },
        { id: 'p', label: 'Leistung', type: 'number', unit: 'W', def: 20, min: 0, required: true },
        { id: 'hoursDef', label: 'Übliche Laufzeit', type: 'number', unit: 'h/Tag', def: 2, min: 0, max: 24, step: 0.25, hint: 'Vorgabe beim Platzieren' },
        { id: 'windowDef', label: 'Übliche Nutzungszeit', type: 'select', def: 'abend', options: WINDOWS },
      ],
      inst: [
        { id: 'hours', label: 'Laufzeit', type: 'number', unit: 'h/Tag', def: 4, min: 0, max: 24, step: 0.25 },
        { id: 'window', label: 'Nutzungszeit', type: 'select', def: 'abend', options: WINDOWS },
      ],
      ports: () => [P('+', '+', 'l', 0.68, 'dc', '+', 'bat'), P('-', '−', 'l', 0.88, 'dc', '-', 'bat')],
      spec: (p) => `${p.vdc} V · ${fmt(p.p)} W`,
    },
    grid: {
      label: 'Hausnetz / Netzanschluss', cat: 'Netz', icon: '🏘️', color: '#34495e', w: 60, h: 44,
      fields: [],
      inst: [
        { id: 'yearKwh', label: 'Hausverbrauch (ohne eingezeichnete Verbraucher)', type: 'number', unit: 'kWh/Jahr', def: 3000, min: 0 },
        { id: 'profile', label: 'Verbrauchsprofil', type: 'select', def: 'haushalt', options: [{ v: 'haushalt', l: 'Haushalt' }, { v: 'gewerbe', l: 'Gewerbe (tagsüber)' }, { v: 'konstant', l: 'gleichmäßig' }] },
        { id: 'price', label: 'Strompreis Bezug', type: 'number', unit: 'ct/kWh', def: 35, min: 0, step: 0.1 },
        { id: 'feedIn', label: 'Einspeisevergütung', type: 'number', unit: 'ct/kWh', def: 7.9, min: 0, step: 0.1 },
      ],
      ports: () => [P('ac', 'AC', 'l', 0.75, 'ac', null, 'grid')],
      spec: () => '230 V / 50 Hz',
    },
    fuse: {
      label: 'Sicherung', cat: 'Verteilung & Schutz', icon: '🛡️', color: '#b8860b', w: 34, h: 18, passive: 'fuse',
      fields: [
        kindSel,
        { id: 'rated', label: 'Nennstrom', type: 'number', unit: 'A', def: 100, required: true },
        { id: 'maxV', label: 'max. Spannung', type: 'number', unit: 'V', def: 58 },
        { id: 'ftype', label: 'Bauart', type: 'select', def: 'anl', options: [
          { v: 'anl', l: 'ANL' }, { v: 'mega', l: 'MEGA' }, { v: 'midi', l: 'MIDI' }, { v: 'flach', l: 'Flachsicherung' },
          { v: 'mc4', l: 'MC4-Inline' }, { v: 'pvfuse', l: 'PV-Sicherung (gPV)' }, { v: 'nh', l: 'NH' },
          { v: 'lsdc', l: 'DC-Leitungsschutzschalter' }, { v: 'ls', l: 'LS-Schalter (AC)' }] },
      ],
      ports: (p) => [P('a', '', 'l', 0.5, p.kind || 'dc', null, 'pass'), P('b', '', 'r', 0.5, p.kind || 'dc', null, 'pass')],
      spec: (p) => `${fmt(p.rated)} A`,
    },
    switch: {
      label: 'Trennschalter', cat: 'Verteilung & Schutz', icon: '⏻', color: '#a0522d', w: 34, h: 18, passive: 'switch',
      fields: [kindSel,
        { id: 'rated', label: 'Nennstrom', type: 'number', unit: 'A', def: 250 },
        { id: 'maxV', label: 'max. Spannung', type: 'number', unit: 'V', def: 48 }],
      ports: (p) => [P('a', '', 'l', 0.5, p.kind || 'dc', null, 'pass'), P('b', '', 'r', 0.5, p.kind || 'dc', null, 'pass')],
      spec: (p) => `${fmt(p.rated)} A`,
    },
    shunt: {
      label: 'Batteriewächter (Shunt)', cat: 'Verteilung & Schutz', icon: '📟', color: '#607d8b', w: 34, h: 18, passive: 'shunt',
      fields: [{ id: 'rated', label: 'Nennstrom', type: 'number', unit: 'A', def: 500 }],
      ports: () => [P('a', '', 'l', 0.5, 'dc', null, 'pass'), P('b', '', 'r', 0.5, 'dc', null, 'pass')],
      spec: (p) => `${fmt(p.rated)} A`,
    },
    busbar: {
      label: 'Sammelschiene', cat: 'Verteilung & Schutz', icon: '▬', color: '#8d6e63', w: 80, h: 14, passive: 'bus',
      fields: [kindSel, { id: 'rated', label: 'Nennstrom', type: 'number', unit: 'A', def: 250 }],
      ports: (p) => [0.15, 0.38, 0.62, 0.85].flatMap((x, i) => [
        P('t' + i, '', 't', x, p.kind || 'dc', null, 'pass'), P('b' + i, '', 'b', x, p.kind || 'dc', null, 'pass')]),
      spec: (p) => `${fmt(p.rated)} A`,
    },
    cable: {
      label: 'Kabel', cat: 'Kabel', icon: '〽️', color: '#555', cable: true,
      fields: [
        { id: 'ctype', label: 'Kabeltyp', type: 'select', def: 'batt', options: [
          { v: 'solar', l: 'Solarkabel (H1Z2Z2-K)' }, { v: 'batt', l: 'Batteriekabel / Einzelader (H07V-K)' },
          { v: 'gummi', l: 'Gummischlauchleitung (H07RN-F)' }, { v: 'nym', l: 'Mantelleitung (NYM-J)' }, { v: 'erd', l: 'Erdkabel (NYY-J / NAYY)' }] },
        { id: 'material', label: 'Leitermaterial', type: 'select', def: 'cu', options: [{ v: 'cu', l: 'Kupfer' }, { v: 'al', l: 'Aluminium' }] },
        { id: 'area', label: 'Querschnitt', type: 'number', unit: 'mm²', def: 6, min: 0.5, step: 0.5, required: true },
        { id: 'cores', label: 'Adern', type: 'select', def: '1', options: [{ v: '1', l: '1 (Einzelader)' }, { v: '2', l: '2' }, { v: '3', l: '3' }, { v: '5', l: '5' }],
          hint: 'Einzelader: Plus und Minus werden einzeln gezeichnet. Mehradrig: eine Leitung mit Hin- und Rückleiter' },
        { id: 'ampacity', label: 'Belastbarkeit', type: 'number', unit: 'A', hint: 'leer = aus Querschnitt, Material und Kabeltyp berechnet' },
        { id: 'pricePerM', label: 'Preis pro Meter', type: 'number', unit: '€/m', step: 0.01 },
      ],
      spec: (p) => `${p.cores !== '1' ? p.cores + '×' : ''}${fmt(p.area)} mm² ${p.material === 'al' ? 'Al' : 'Cu'}`,
    },
  };

  for (const t of Object.values(types)) t.inst = t.inst || [];

  const CATEGORIES = ['Erzeugung', 'Laderegler & Wandler', 'Speicher', 'Wechselrichter', 'Verbraucher', 'Netz', 'Verteilung & Schutz', 'Kabel'];

  function fmt(n, d) {
    if (n === undefined || n === null || n === '' || Number.isNaN(Number(n))) return '–';
    const v = Number(n);
    const digits = d !== undefined ? d : Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
    return v.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  }
  function chemLabel(c) {
    const x = CHEM.find((o) => o.v === c);
    return x ? x.l.replace(/ \(.*\)/, '') : c;
  }

  // Belastbarkeit eines Kabels (A)
  function ampacity(cab) {
    if (Number(cab.ampacity) > 0) return Number(cab.ampacity);
    const a = Number(cab.area) || 1.5;
    let base;
    if (AMPACITY_CU[a]) base = AMPACITY_CU[a];
    else {
      // interpolieren
      const keys = Object.keys(AMPACITY_CU).map(Number);
      const lo = keys.filter((k) => k <= a).pop() || keys[0];
      const hi = keys.find((k) => k >= a) || keys[keys.length - 1];
      base = lo === hi ? AMPACITY_CU[lo] : AMPACITY_CU[lo] + (AMPACITY_CU[hi] - AMPACITY_CU[lo]) * (a - lo) / (hi - lo);
    }
    if (cab.ctype === 'solar') base *= 1.4;
    if (cab.ctype === 'nym' || cab.ctype === 'erd' || (cab.cores && cab.cores !== '1')) base *= 0.85;
    if (cab.material === 'al') base *= 0.78;
    return Math.round(base);
  }

  // Produkt bereinigen: nur bekannte Felder, Zahlen als Zahlen
  function sanitizeProduct(p) {
    const t = types[p && p.type];
    if (!t) throw new Error('Unbekannter Bauteiltyp');
    const out = { id: String(p.id || ''), type: p.type };
    for (const f of common.concat(t.fields, tail)) {
      let v = p[f.id];
      if (v === undefined || v === null || v === '') { if (f.def !== undefined) out[f.id] = f.def; continue; }
      if (f.type === 'number') { v = Number(v); if (!Number.isFinite(v)) continue; }
      else if (f.type === 'select') { if (!f.options.some((o) => o.v === String(v))) v = f.def; else v = String(v); }
      else if (f.type === 'url') { v = String(v).trim().slice(0, 1000); if (!/^https?:\/\//i.test(v)) continue; }
      else v = String(v).slice(0, f.type === 'textarea' ? 2000 : 200);
      out[f.id] = v;
    }
    if (!out.name) out.name = t.label;
    return out;
  }

  function instDefaults(type, product) {
    const o = {};
    for (const f of types[type].inst) o[f.id] = f.def;
    if (product && (type === 'load_ac' || type === 'load_dc')) {
      const std = defaultLibrary.find((x) => x.id === product.id) || {};
      const h = product.hoursDef !== undefined && product.hoursDef !== '' ? product.hoursDef : std.hoursDef;
      const w = product.windowDef || std.windowDef;
      if (h !== undefined) o.hours = Number(h);
      if (w) o.window = w;
    }
    return o;
  }

  // ---------- Start-Bibliothek (allgemeine Beispielwerte, keine echten Markenprodukte) ----------
  let n = 0;
  const L = (type, name, vals) => ({ id: 'std-' + type + '-' + (++n), type, name, ...vals });
  const defaultLibrary = [
    L('pv', 'Solarmodul 400 Wp (Beispiel)', { pmax: 400, voc: 37.1, vmp: 31.0, isc: 13.8, imp: 12.9, tkVoc: -0.27, tkP: -0.35, dims: '1722 × 1134 mm', weight: 21, price: 110 }),
    L('pv', 'Solarmodul 450 Wp bifazial (Beispiel)', { pmax: 450, voc: 41.5, vmp: 34.6, isc: 13.9, imp: 13.0, tkVoc: -0.25, tkP: -0.30, dims: '1903 × 1134 mm', weight: 24, price: 130 }),
    L('pv', 'Solarmodul 200 Wp 12-V-Panel (Beispiel)', { pmax: 200, voc: 24.3, vmp: 20.4, isc: 10.4, imp: 9.8, tkVoc: -0.3, tkP: -0.38, dims: '1480 × 680 mm', weight: 11, price: 120 }),
    L('pv', 'Solarmodul 100 Wp 12-V-Panel (Beispiel)', { pmax: 100, voc: 22.6, vmp: 18.6, isc: 5.9, imp: 5.4, tkVoc: -0.3, tkP: -0.4, dims: '1010 × 530 mm', weight: 6.5, price: 75 }),
    L('wind', 'Windgenerator 400 W 12 V (Beispiel)', { vdc: '12', prated: 400, kwhDay: 0.4, maxA: 30, price: 350 }),
    L('generator', 'Stromerzeuger 2 kW Inverter (Beispiel)', { p: 1800, fuel: 1.0, fuelPrice: 1.85, price: 600 }),
    L('shore', 'Landstrom 16 A', { maxA: 16 }),
    L('mppt', 'MPPT-Laderegler 75 V / 15 A (Beispiel)', { ctype: 'mppt', maxVoc: 75, maxA: 15, maxIsc: 15, volts: '12/24', eta: 97, price: 80 }),
    L('mppt', 'MPPT-Laderegler 100 V / 30 A (Beispiel)', { ctype: 'mppt', maxVoc: 100, maxA: 30, maxIsc: 35, volts: '12/24', eta: 97, price: 150 }),
    L('mppt', 'MPPT-Laderegler 100 V / 50 A (Beispiel)', { ctype: 'mppt', maxVoc: 100, maxA: 50, maxIsc: 60, volts: '12/24', eta: 97, price: 230 }),
    L('mppt', 'MPPT-Laderegler 150 V / 45 A (Beispiel)', { ctype: 'mppt', maxVoc: 150, maxA: 45, maxIsc: 50, volts: '12/24/48', eta: 97.5, price: 300 }),
    L('mppt', 'MPPT-Laderegler 150 V / 70 A (Beispiel)', { ctype: 'mppt', maxVoc: 150, maxA: 70, maxIsc: 50, volts: '12/24/48', eta: 98, price: 500 }),
    L('mppt', 'MPPT-Laderegler 250 V / 100 A (Beispiel)', { ctype: 'mppt', maxVoc: 250, maxA: 100, maxIsc: 70, volts: '12/24/48', eta: 98, price: 900 }),
    L('mppt', 'PWM-Laderegler 30 A (Beispiel)', { ctype: 'pwm', maxVoc: 50, maxA: 30, maxIsc: 30, volts: '12/24', eta: 98, price: 30 }),
    L('dcdc', 'Ladebooster 12 V / 30 A (Beispiel)', { vdc: '12', maxA: 30, price: 180 }),
    L('charger', 'Ladegerät 12 V / 30 A (Beispiel)', { vdc: '12', maxA: 30, eta: 88, price: 200 }),
    L('charger', 'Ladegerät 24 V / 25 A (Beispiel)', { vdc: '24', maxA: 25, eta: 90, price: 250 }),
    L('battery', 'Gel-Batterie 12 V / 100 Ah (Beispiel)', { chem: 'gel', v: 12, ah: 100, weight: 30, price: 230 }),
    L('battery', 'Gel-Batterie 12 V / 200 Ah (Beispiel)', { chem: 'gel', v: 12, ah: 200, weight: 60, price: 420 }),
    L('battery', 'AGM-Batterie 12 V / 100 Ah (Beispiel)', { chem: 'agm', v: 12, ah: 100, weight: 29, price: 200 }),
    L('battery', 'LiFePO4 12,8 V / 100 Ah (Beispiel)', { chem: 'lifepo4', v: 12.8, ah: 100, maxChg: 100, maxDis: 100, weight: 11, price: 350 }),
    L('battery', 'LiFePO4 12,8 V / 200 Ah (Beispiel)', { chem: 'lifepo4', v: 12.8, ah: 200, maxChg: 100, maxDis: 200, weight: 21, price: 600 }),
    L('battery', 'LiFePO4 25,6 V / 100 Ah (Beispiel)', { chem: 'lifepo4', v: 25.6, ah: 100, maxChg: 100, maxDis: 100, weight: 21, price: 700 }),
    L('battery', 'LiFePO4 51,2 V / 100 Ah Rack (Beispiel)', { chem: 'lifepo4', v: 51.2, ah: 100, maxChg: 100, maxDis: 100, weight: 45, price: 1300 }),
    L('inverter', 'Wechselrichter 12 V / 1000 W Sinus (Beispiel)', { vdc: '12', pCont: 1000, pPeak: 2000, eta: 92, idle: 10, wave: 'sinus', price: 220 }),
    L('inverter', 'Wechselrichter 12 V / 2000 W Sinus (Beispiel)', { vdc: '12', pCont: 2000, pPeak: 4000, eta: 92, idle: 15, wave: 'sinus', price: 400 }),
    L('inverter', 'Wechselrichter 24 V / 3000 W Sinus (Beispiel)', { vdc: '24', pCont: 3000, pPeak: 6000, eta: 93, idle: 20, wave: 'sinus', price: 650 }),
    L('inverter', 'Wechselrichter 48 V / 5000 W Sinus (Beispiel)', { vdc: '48', pCont: 5000, pPeak: 10000, eta: 94, idle: 30, wave: 'sinus', price: 1200 }),
    L('micro', 'Mikro-Wechselrichter 800 W, 2 Eingänge (Beispiel)', { inputs: '2', maxInV: 60, mpptMin: 16, mpptMax: 60, maxInA: 14, pAc: 800, eta: 95.5, price: 180 }),
    L('micro', 'Mikro-Wechselrichter 1600 W, 4 Eingänge (Beispiel)', { inputs: '4', maxInV: 60, mpptMin: 16, mpptMax: 60, maxInA: 16, pAc: 1600, eta: 96, price: 350 }),
    L('hybrid', 'Hybrid-Wechselrichter 5 kW / 48 V (Beispiel)', { batV: 48, maxVoc: 500, mpptMin: 120, mpptMax: 450, maxIsc: 18, maxPv: 6500, pAc: 5000, maxBatW: 5000, eta: 97, idle: 25, price: 1400 }),
    L('batinv', 'Batterie-Wechselrichter 2,5 kW / 48 V (Beispiel)', { batV: 48, pAc: 2500, eta: 95, idle: 10, price: 1100 }),
    L('load_ac', 'Kühlschrank (Beispiel)', { p: 80, start: 4, hoursDef: 8, windowDef: 'ganztags' }),
    L('load_ac', 'Gefriertruhe (Beispiel)', { p: 100, start: 4, hoursDef: 10, windowDef: 'ganztags' }),
    L('load_ac', 'LED-Beleuchtung (Beispiel)', { p: 30, start: 1, hoursDef: 5, windowDef: 'abend' }),
    L('load_ac', 'Laptop (Beispiel)', { p: 60, start: 1, hoursDef: 4, windowDef: 'tag' }),
    L('load_ac', 'Fernseher (Beispiel)', { p: 80, start: 1, hoursDef: 3, windowDef: 'abend' }),
    L('load_ac', 'Router / WLAN (Beispiel)', { p: 12, start: 1, hoursDef: 24, windowDef: 'ganztags' }),
    L('load_ac', 'Kaffeemaschine (Beispiel)', { p: 1200, start: 1, hoursDef: 0.3, windowDef: 'morgen' }),
    L('load_ac', 'Wasserkocher (Beispiel)', { p: 2000, start: 1, hoursDef: 0.2, windowDef: 'morgen' }),
    L('load_ac', 'Mikrowelle (Beispiel)', { p: 1000, start: 1.5, hoursDef: 0.25, windowDef: 'mittag' }),
    L('load_ac', 'Waschmaschine (Beispiel)', { p: 2000, start: 2, hoursDef: 1.5, windowDef: 'mittag' }),
    L('load_ac', 'Hauswasserpumpe (Beispiel)', { p: 800, start: 3, hoursDef: 0.5, windowDef: 'tag' }),
    L('load_ac', 'Werkzeug / Kreissäge (Beispiel)', { p: 1400, start: 3, hoursDef: 1, windowDef: 'tag' }),
    L('load_dc', 'Kompressor-Kühlbox 12 V (Beispiel)', { vdc: '12', p: 45, hoursDef: 10, windowDef: 'ganztags' }),
    L('load_dc', 'LED-Licht 12 V (Beispiel)', { vdc: '12', p: 10, hoursDef: 5, windowDef: 'abend' }),
    L('load_dc', 'USB-Ladegerät 12 V (Beispiel)', { vdc: '12', p: 20, hoursDef: 3, windowDef: 'abend' }),
    L('load_dc', 'Wasserpumpe 12 V (Beispiel)', { vdc: '12', p: 60, hoursDef: 0.3, windowDef: 'tag' }),
    L('load_dc', 'Standheizung 12 V (Beispiel)', { vdc: '12', p: 25, hoursDef: 6, windowDef: 'nacht' }),
    L('grid', 'Hausnetz 230 V', {}),
    L('fuse', 'ANL-Sicherung 150 A', { kind: 'dc', rated: 150, maxV: 58, ftype: 'anl', price: 8 }),
    L('fuse', 'ANL-Sicherung 250 A', { kind: 'dc', rated: 250, maxV: 58, ftype: 'anl', price: 8 }),
    L('fuse', 'MEGA-Sicherung 100 A', { kind: 'dc', rated: 100, maxV: 58, ftype: 'mega', price: 6 }),
    L('fuse', 'MIDI-Sicherung 60 A', { kind: 'dc', rated: 60, maxV: 58, ftype: 'midi', price: 5 }),
    L('fuse', 'Flachsicherung 30 A', { kind: 'dc', rated: 30, maxV: 32, ftype: 'flach', price: 1 }),
    L('fuse', 'PV-Sicherung 15 A / 1000 V', { kind: 'dc', rated: 15, maxV: 1000, ftype: 'pvfuse', price: 6 }),
    L('fuse', 'LS-Schalter B16 (230 V)', { kind: 'ac', rated: 16, maxV: 400, ftype: 'ls', price: 6 }),
    L('switch', 'Batterie-Hauptschalter 300 A', { kind: 'dc', rated: 300, maxV: 48, price: 25 }),
    L('switch', 'PV-Trennschalter 32 A / 1000 V', { kind: 'dc', rated: 32, maxV: 1000, price: 40 }),
    L('shunt', 'Batteriewächter mit Shunt 500 A', { rated: 500, price: 90 }),
    L('busbar', 'Sammelschiene 250 A', { kind: 'dc', rated: 250, price: 20 }),
    L('cable', 'Solarkabel 4 mm²', { ctype: 'solar', material: 'cu', area: 4, cores: '1', pricePerM: 1.0 }),
    L('cable', 'Solarkabel 6 mm²', { ctype: 'solar', material: 'cu', area: 6, cores: '1', pricePerM: 1.4 }),
    L('cable', 'Solarkabel 10 mm²', { ctype: 'solar', material: 'cu', area: 10, cores: '1', pricePerM: 2.4 }),
    L('cable', 'Batteriekabel 10 mm²', { ctype: 'batt', material: 'cu', area: 10, cores: '1', pricePerM: 2.5 }),
    L('cable', 'Batteriekabel 16 mm²', { ctype: 'batt', material: 'cu', area: 16, cores: '1', pricePerM: 3.5 }),
    L('cable', 'Batteriekabel 25 mm²', { ctype: 'batt', material: 'cu', area: 25, cores: '1', pricePerM: 5 }),
    L('cable', 'Batteriekabel 35 mm²', { ctype: 'batt', material: 'cu', area: 35, cores: '1', pricePerM: 7 }),
    L('cable', 'Batteriekabel 50 mm²', { ctype: 'batt', material: 'cu', area: 50, cores: '1', pricePerM: 10 }),
    L('cable', 'Batteriekabel 70 mm²', { ctype: 'batt', material: 'cu', area: 70, cores: '1', pricePerM: 14 }),
    L('cable', 'Batteriekabel 95 mm²', { ctype: 'batt', material: 'cu', area: 95, cores: '1', pricePerM: 19 }),
    L('cable', 'NYM-J 3 × 1,5 mm²', { ctype: 'nym', material: 'cu', area: 1.5, cores: '3', pricePerM: 0.9 }),
    L('cable', 'NYM-J 3 × 2,5 mm²', { ctype: 'nym', material: 'cu', area: 2.5, cores: '3', pricePerM: 1.3 }),
    L('cable', 'H07RN-F 3 × 2,5 mm²', { ctype: 'gummi', material: 'cu', area: 2.5, cores: '3', pricePerM: 2.2 }),
    L('cable', 'NAYY 4 × 25 mm² Alu', { ctype: 'erd', material: 'al', area: 25, cores: '5', pricePerM: 4.5 }),
    // Ergänzungen (immer hinten anfügen – die IDs ergeben sich aus der Reihenfolge)
    L('inverter', 'Wechselrichter 12 V / 3000 W Sinus (Beispiel)', { vdc: '12', pCont: 3000, pPeak: 6000, eta: 91, idle: 20, wave: 'sinus', price: 550 }),
    L('inverter', 'Wechselrichter 24 V / 2000 W Sinus (Beispiel)', { vdc: '24', pCont: 2000, pPeak: 4000, eta: 93, idle: 15, wave: 'sinus', price: 450 }),
    L('inverter', 'Wechselrichter 48 V / 3000 W Sinus (Beispiel)', { vdc: '48', pCont: 3000, pPeak: 6000, eta: 94, idle: 20, wave: 'sinus', price: 750 }),
    L('inverter', 'Wechselrichter 48 V / 8000 W Sinus (Beispiel)', { vdc: '48', pCont: 8000, pPeak: 16000, eta: 94, idle: 40, wave: 'sinus', price: 2000 }),
    L('mppt', 'MPPT-Laderegler 150 V / 35 A (Beispiel)', { ctype: 'mppt', maxVoc: 150, maxA: 35, maxIsc: 40, volts: '12/24/48', eta: 98, price: 270 }),
    L('mppt', 'MPPT-Laderegler 150 V / 100 A (Beispiel)', { ctype: 'mppt', maxVoc: 150, maxA: 100, maxIsc: 70, volts: '12/24/48', eta: 98, price: 800 }),
    L('mppt', 'MPPT-Laderegler 250 V / 60 A (Beispiel)', { ctype: 'mppt', maxVoc: 250, maxA: 60, maxIsc: 35, volts: '12/24/48', eta: 98, price: 600 }),
    L('inverter', 'Wechselrichter 24 V / 5000 W Sinus (Beispiel)', { vdc: '24', pCont: 5000, pPeak: 10000, eta: 93, idle: 30, wave: 'sinus', price: 1100 }),
    L('dcconv', 'DC-Spannungswandler 48 V → 12 V / 180 W (Beispiel)', { vIn: '48', vOut: '12', maxW: 180, eta: 90, price: 60 }),
    L('dcconv', 'DC-Spannungswandler 24 V → 12 V / 180 W (Beispiel)', { vIn: '24', vOut: '12', maxW: 180, eta: 91, price: 45 }),
  ];

  return {
    types, CATEGORIES, common, tail, CHEM, CHEM_DEFAULTS, AREAS, RHO, DIRS, WINDOWS, VOLTS,
    fmt, chemLabel, ampacity, sanitizeProduct, instDefaults, defaultLibrary,
  };
});
