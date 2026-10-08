# Energiemanagement

Baukasten für Energiesysteme: Solarmodule, Laderegler, Batterien, Wechselrichter, Verbraucher,
Sicherungen und Kabel per Drag & Drop zusammenstellen. Die App rechnet laufend nach, was
funktioniert, was nicht – und begründet jeden Hinweis („Warum" / „Was tun").

## Start

`start.bat` doppelklicken → Browser öffnet http://localhost:3490/.
Das schwarze Konsolenfenster ist der Server – offen lassen, solange die App genutzt wird.

## Portabel

Den Ordner `Energiemanagement` komplett kopieren (USB-Stick usw.) und dort `start.bat` starten.
`runtime\node.exe` ist enthalten, es muss nichts installiert werden. Daten liegen in `data\`:

- `data\library.json` – Bauteil-Bibliothek (eigene Bauteile mit Link zum Produkt)
- `data\projects\*.json` – gespeicherte Systeme

## Was berechnet wird

- **Verschaltung:** Reihen- und Parallelschaltung von Modulen und Batterien wird automatisch
  erkannt (z. B. 2S2P), inkl. Verpolung, Kurzschluss, gemischter Batterietypen.
- **Solarfeld ↔ Regler/Wechselrichter:** Leerlaufspannung bei Kälte, MPP-Spannung bei Hitze,
  Ströme, PWM-Verluste, Reglergröße, Verschaltungsvorschläge.
- **DC/AC-Verhältnis (ILR)** bzw. PV/Regler-Verhältnis, **Kopplung** (DC/AC/gemischt),
  Speicherverhältnis.
- **Kabel:** Strom je Kabel aus der Schaltung, Spannungsfall, Verlust, Belastbarkeit
  (Kupfer/Alu, Kabeltyp), empfohlener Querschnitt. Länge aus der Zeichnung (Raster in cm)
  oder eigene Angabe.
- **Sicherungen:** fehlende Batteriesicherung, Nennstrom vs. Kabel, Spannungsfestigkeit, AC/DC.
- **Energiebilanz:** typischer Tag je Monat, stündlich – Ertrag nach PLZ-Region, Neigung,
  Ausrichtung, Verschattung; Verbraucher mit Laufzeit und Nutzungszeit; Batterie mit
  Entladetiefe und Wirkungsgrad; Insel (Deckung, Autonomie, Generator), Netz (Eigenverbrauch,
  Autarkie, Ersparnis), Hybrid (DC-gekoppelt) und Batterie-Wechselrichter (AC-gekoppelt).
- **Stückliste** mit Preisen und Links, Amortisation.

Hinweis: Planungshilfe mit Näherungswerten, ersetzt keine Elektrofachkraft.

## Tests der Rechenlogik

`public/js/engine.js` läuft auch ohne Browser:
`node -e "const E=require('./public/js/engine.js'); ..."`.

## Konfiguration

Umgebungsvariable `PORT` (Standard 3490).

## Neu (2026-10-07)

- **Istbestand:** Häkchen im Eigenschaften-Panel eines Bauteils (Schloss-Symbol auf der Fläche). Solche Teile
  tauscht oder ergänzt die Automatik nie – alles andere wird passend dazu ausgelegt (z. B. Systemspannung nach
  einem vorhandenen Wechselrichter).
- **Autom. Fertigstellen** ergänzt bei zu kleiner Bank Batterien **gleichen Typs** (bewertet mit derselben
  Prüfung wie die Hinweise), setzt Strangsicherungen ab 3 parallelen Strängen, begrenzt den Ladestrom im Regler
  und plant Sicherungen jedes Mal neu (alte bleiben nicht mehr liegen). Module ergänzt es nie von selbst –
  dafür gibt es beim Hinweis „Energie reicht nicht" einen Knopf.
- **Standort-Koordinaten** (Reiter Projekt): Tageslängen, Ausrichtung nach Breitengrad, Neigungsempfehlung
  (Insel: auf den Winter optimiert, Netz: aufs Jahr).
- **Bauplan im Hintergrund** (Reiter Projekt): PDF/PNG/JPG laden, Maßstab 1:x (PDF) oder über zwei Punkte,
  Deckkraft, sperren. PDFs rendert pdf.js lokal (`public/vendor/pdfjs`, Apache-2.0), Bilder liegen in `data\plans\`.
- **PDF-Export** (Knopf „PDF" oben): Plan + Eckdaten, Teileliste mit Preisen, offene Hinweise.
  Im Druckdialog „Als PDF speichern" wählen.
- **Verknüpfung mit Blitz-Symbol:** `Verknuepfung anlegen.bat` einmal ausführen (Programmordner + Desktop).
