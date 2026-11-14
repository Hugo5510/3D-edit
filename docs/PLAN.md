# Plan architektury i etapów

## Cel
Aplikacja do projektowania brył pod druk 3D, działająca w przeglądarce (PWA) na telefonie i komputerze,
z dokładnym jądrem B-rep (OpenCascade w WebAssembly) i eksportem do formatów druku 3D, CAD i Blendera.

## Architektura (warstwy)

```
┌───────────────────────────── wątek główny ─────────────────────────────┐
│ React UI (src/ui)        – pasek narzędzi, panel właściwości, drzewo   │
│                            operacji, okna importu/eksportu, pola wymiarów│
│ Stan (src/state)         – dokument + zaznaczenie + narzędzie, zustand,  │
│                            historia cofnij/ponów, autozapis (IndexedDB)  │
│ Widok (src/viewer)       – Three.js: scena, kamera, OrbitControls,       │
│                            manipulator, kostka widoków, siatka, stół,    │
│                            szkicownik 2D, wybieranie ścian/krawędzi      │
│ Model (src/model)        – czyste TS: typy dokumentu, geometria szkicu   │
│                            (przyciąganie, łączenie punktów, kontury,     │
│                            zaokrąglenia narożników), macierze            │
│ Formaty (src/io)         – STL, 3MF, OBJ, PLY, GLB, DXF, plik projektu   │
└───────────────┬─────────────────────────────────────────────────────────┘
                │ postMessage (RPC z obietnicami, src/kernel/client.ts)
┌───────────────▼──────────────── Web Worker ────────────────────────────┐
│ src/kernel/worker.ts → build.ts: odtworzenie dokumentu operacja po     │
│ operacji w occt-wasm (OCCT 8.0.1). Wynik: siatki do wyświetlania +     │
│ mapa trójkąt→ściana, polilinie krawędzi, metadane ścian/krawędzi,      │
│ bbox, objętość, błędy operacji.                                        │
│ meshOps.ts – manifold-3d dla zaimportowanych siatek (operacje logiczne)│
│ iges.ts    – pełny build OpenCascade ładowany dopiero przy IGES        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Model dokumentu (historia operacji)
Dokument to lista szkiców i **liniowa oś czasu operacji** (`features`), jak drzewo w Inventorze.
Każda operacja tworzy lub modyfikuje bryłę o danym `bodyId`. Przebudowa = odtworzenie osi czasu
od początku (z pamięcią podręczną wyników kolejnych prefiksów w workerze). Zmiana dowolnego
parametru przebudowuje geometrię od tej operacji.

Operacje: `primitive`, `extrude`, `hole`, `boolean`, `fillet`, `chamfer`, `transform`,
`import` (STEP/IGES → B-rep, STL/OBJ/3MF/… → siatka), `delete`.

Odwołania do ścian/krawędzi (np. otwór na ścianie, zaokrąglenie krawędzi) zapisywane są jako
**sygnatury geometryczne** (środek, normalna/kierunek, typ), a przy przebudowie dopasowywane
do najbliższego elementu. To pragmatyczne rozwiązanie problemu nazewnictwa topologicznego —
działa przy typowych zmianach wymiarów, ale przy dużych zmianach topologii odwołanie może
trafić na inną ścianę (operacja zostanie wtedy oznaczona jako błędna albo wskaże najbliższą).

### Układ współrzędnych i jednostki
Oś Z do góry (jak w drukarkach i Bambu Studio), 1 jednostka = 1 mm. Początek układu w środku stołu.
Eksport 3MF do Bambu przesuwa model tak, by leżał na stole (z=0) w środku płyty.

## Etapy
1. **Widok 3D i bryły z przekształceniami** — szkielet Vite/React/PWA, CI i GitHub Pages, worker
   OCCT, bryły gotowe z edytowalnymi wymiarami, manipulator (przesuw/obrót), skalowanie,
   cofnij/ponów, autozapis, kostka widoków, siatka, obszar roboczy drukarki.
2. **Szkic i wyciągnięcie** — linia, prostokąt, okrąg, wielokąt, łuki, przeciąganie i łączenie
   punktów, przyciąganie, zaokrąglanie narożników, wypełnianie, wykrywanie przerw, wyciągnięcie
   (dodaj/wytnij/nowa bryła) z konturu lub płaskiej ściany.
3. **Otwory, operacje logiczne, zaokrąglenia** — otwór z pozycją od krawędzi, suma/różnica/część
   wspólna, zaokrąglenie i fazowanie krawędzi/rogów, gumka, pomiar.
4. **Import i eksport** — STL (bin/ASCII), 3MF, OBJ, PLY, GLB, STEP, IGES, DXF, plik projektu;
   siatki importowane z operacjami logicznymi (manifold-3d); testy formatów.
5. **Bambu Studio** — eksport 3MF ułożonego na stole + instrukcja; ostrzeżenie o wymiarach.
6. **Wersja mobilna** — gesty, duże przyciski, klawiatura numeryczna, układ dolnego panelu.

Każdy etap: build + testy w CI, wdrożenie na GitHub Pages z gałęzi `main`, test w przeglądarce.
