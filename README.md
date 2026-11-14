# 3D Edit — projektowanie brył pod druk 3D

Aplikacja webowa (PWA) do modelowania brył pod druk 3D, działająca na telefonie i komputerze
(Android, iOS, Windows, macOS, Linux), offline po pierwszym załadowaniu. Interfejs po polsku,
jednostka: **1 jednostka modelu = 1 mm** (także w eksportowanych plikach).

- Wersja online: `https://<użytkownik>.github.io/<repozytorium>/` (GitHub Pages, wdrażana z gałęzi `main`)
- Plan architektury i etapów: [docs/PLAN.md](docs/PLAN.md)

## Uruchomienie lokalne

```bash
npm ci
npm run dev        # serwer deweloperski
npm test           # testy jednostkowe geometrii i formatów (Vitest, Node)
npm run build      # build produkcyjny do dist/
npm run e2e        # testy w przeglądarce (Playwright) na zbudowanej wersji
```

## Wybór jądra geometrii (B-rep)

Sprawdzone (listopad 2026):

| Biblioteka | Jądro | Licencja | Uwagi |
|---|---|---|---|
| **occt-wasm 5.17** (wybrana) | OpenCascade **8.0.1** | narzędzia MIT/Apache-2.0, plik `.wasm` LGPL-2.1 | aktywnie rozwijana, czyste API z uchwytami (arena), działa w workerze i w Node, zaokrąglenia/fazowania per krawędź z listą błędnych krawędzi, STEP (wybór jednostki), STL, BREP, ogólne przekształcenia (skala nierównomierna), ~4,5 MB brotli |
| replicad 1.2 + replicad-opencascadejs | OpenCascade 7.x/8 | MIT + LGPL-2.1 | dojrzałe API szkiców, ale build nie zawiera `BRepBuilderAPI_GTransform` (brak skalowania nierównomiernego brył) ani IGES |
| brepjs 20.x | (nakładka na occt-wasm) | Apache-2.0 | bardzo częste zmiany wersji głównej; wysoki poziom abstrakcji niepotrzebny przy własnym modelu historii |
| opencascade.js 1.1.1 / 2.0-beta | OpenCascade 7.5–7.6 | LGPL-2.1 | nierozwijane od 2023 r. |
| manifold-3d 3.5 | siatki (nie B-rep) | Apache-2.0 | użyte tylko do operacji logicznych na zaimportowanych siatkach |

**Dlaczego occt-wasm:** prawdziwe jądro B-rep (wymagane do poprawnych zaokrągleń i eksportu STEP),
najnowsze OCCT, komplet potrzebnych operacji w jednym, niezbyt dużym module, wygodne zarządzanie
pamięcią (punkty kontrolne + zwalnianie hurtowe — wykorzystane w pamięci podręcznej przebudowy)
i możliwość testowania tej samej logiki w Node (CI).

**IGES:** żaden lekki build nie zawiera modułu IGES (occt-wasm świadomie go pomija). Dlatego IGES
obsługuje pełny build **@taucad/opencascade.js 3.0.0-beta.1** (OCCT 8.0, LGPL-2.1), ładowany
**dopiero przy pierwszym imporcie/eksporcie IGES** (~37 MB, ~11 MB gzip), a potem trzymany w pamięci
podręcznej przeglądarki. Wymiana z głównym jądrem przez format BREP. Eksport IGES zapisuje bryły jako
encje 186 (MSBO) w milimetrach; test sprawdza, że sześcian z zaokrągleniami wraca z tą samą objętością.

**Licencje:** pliki `.wasm` OpenCascade są na LGPL-2.1 i są ładowane jako osobne, niezmodyfikowane pliki
z adresu URL (użytkownik może je podmienić), co spełnia wymóg możliwości zastąpienia biblioteki.

## Decyzje projektowe (nieopisane w wymaganiach)

- **Oś Z do góry**, początek układu w środku stołu drukarki (jak w slicerach). Bryły gotowe stawiane są
  na stole (spód w Z=0).
- **Model historii:** liniowa oś czasu operacji (jak drzewo w Inventorze). Każda zmiana parametru
  przebudowuje geometrię od tej operacji; worker trzyma wyniki pośrednie i przelicza tylko to, co się zmieniło.
- **Odwołania do ścian i krawędzi** (otwór, zaokrąglenie, wyciągnięcie ściany) zapisywane są jako
  sygnatury geometryczne (środek + normalna/kierunek + typ) i dopasowywane po przebudowie do najbliższego
  elementu. Działa przy typowych zmianach wymiarów; przy dużej zmianie topologii operacja może trafić
  w sąsiednią ścianę albo zgłosić błąd (widoczny na czerwono w historii).
- **Przesuwanie/obrót** bryły gotowej zmienia jej położenie bezpośrednio; skalowanie (i przekształcenia
  brył po innych operacjach) dopisywane są jako operacja „Przekształcenie”.
- **Skalowanie** odbywa się względem środka podstawy bryły (bryła zostaje na stole). Obrót — względem
  środka prostopadłościanu otaczającego.
- **Przyciąganie** manipulatora: przesuw do kroku siatki (domyślnie 1 mm), obrót co 5° (Shift = bez przyciągania);
  przyciąganie można wyłączyć przyciskiem „Siatka” lub klawiszem G.
- **Pola liczbowe** przyjmują przecinek lub kropkę oraz proste działania (`20/2+3`); dokładność wewnętrzna
  to pełna precyzja double, wyświetlanie z dokładnością 0,01 mm.
- **Autozapis** w IndexedDB przeglądarki (projekt + zaimportowane pliki), cofnij/ponów do 200 kroków.
- **Domyślna drukarka** 256 × 256 × 256 mm (Bambu Lab X1/P1/A1); inne wymiary w oknie „Drukarka”.
- Stan i interfejs: React 19 + zustand; widok: Three.js (bez React Three Fiber — narzędzia CAD wymagają
  bezpośredniej kontroli zdarzeń wskaźnika).

## Stan etapów

### Etap 1 — widok 3D, bryły, przekształcenia ✅
Działa: widok 3D z oświetleniem i krawędziami, stół drukarki z siatką i ramką obszaru roboczego (czerwona +
ostrzeżenie, gdy model się nie mieści), kostka widoków (ściany, krawędzie, narożniki), dopasowanie widoku (F),
bryły gotowe (prostopadłościan, walec, kula, stożek, torus, graniastosłup, klin) z edytowalnymi wymiarami,
manipulator (strzałki X/Y/Z + pierścienie obrotu) z podglądem na żywo i wartością przy kursorze, obrót o dowolny
kąt i przyciski 90°, skalowanie równomierne/osiowe, procentowo i do wymiaru w mm, pozycja w polach,
„Połóż na stole”, cofnij/ponów (Ctrl+Z / Ctrl+Y), autozapis, PWA z pracą offline, CI z testami i wdrożeniem.

### Etap 2 — szkic i wyciągnięcie ✅
Działa: szkic na płaszczyźnie XY/XZ/YZ lub na płaskiej ścianie bryły (kamera ustawia się prostopadle),
linia (łańcuchowo), prostokąt, okrąg, wielokąt foremny, łuk przez 3 punkty i łuk środek–początek–koniec;
pole wymiarów w trakcie rysowania (długość/kąt, szerokość/wysokość, promień/średnica, liczba boków, kąt łuku),
przyciąganie do punktów końcowych, środków odcinków, środków okręgów i siatki; przeciąganie punktów
(upuszczony na inny punkt łączy się z nim we wspólny wierzchołek), prostokąt i wielokąt zachowują kształt przy
przeciąganiu; edycja wymiarów zaznaczonego elementu (długość, kąt, promień, współrzędne punktów, szerokość/wysokość
prostokąta, liczba boków); zaokrąglanie narożników podanym promieniem; wypełnianie konturu jednym kliknięciem
(także kontury z otworami i obszary ze wspólnymi krawędziami) i „Wypełnij wszystko”; niedomknięte końce
i przerwy zaznaczane na czerwono, z komunikatem o położeniu i długości przerwy; wyciągnięcie konturu lub płaskiej
ściany: przeciąganie strzałki albo wpisanie wysokości, tryby „dodaj materiał”, „wytnij”, „nowa bryła”,
symetrycznie; przy „wytnij” kierunek automatycznie w głąb bryły; gumka (odcinek, wypełnienie, bryła).

Ograniczenia: szkic narysowany na ścianie nie podąża za bryłą, gdy ta zostanie później przesunięta (płaszczyzna
szkicu jest zapamiętywana w chwili jego utworzenia). Brak więzów geometrycznych (równoległość, styczność itp.) —
wymiary ustawia się bezpośrednio liczbami.

### Etap 3 — otwory, operacje logiczne, zaokrąglenia ✅
Działa: otwór — klik w płaską ścianę, średnica, głębokość lub „na wylot”, odległości środka od dwóch krawędzi
(krawędzie odniesienia podświetlone na czerwono i zielono, przycisk zmiany pary krawędzi; dla ścian bez dwóch
nierównoległych krawędzi prostych — przesunięcie od środka ściany); suma, różnica i część wspólna (wybór bryły głównej
i narzędzi kliknięciem); zaokrąglanie i fazowanie wybranych krawędzi, narożników (klik w wierzchołek zaznacza wszystkie
wychodzące z niego krawędzie) albo wszystkich krawędzi bryły, z podglądem wyniku i czytelnym błędem przy zbyt dużym
promieniu; gumka; pomiar odległości między dwoma punktami (przyciąganie do wierzchołków i środków okręgów, ΔX/ΔY/ΔZ).
Każdy parametr operacji można zmienić później w historii — geometria przebudowuje się od razu.

Ograniczenia: zaokrąglenie „narożnika” zaokrągla całe krawędzie wychodzące z wierzchołka (OCCT nie ma osobnej
operacji „zaokrąglij tylko róg”). Otwór ma prosty kształt walcowy (bez pogłębień i gwintów).
