import { useRef, useState } from 'react';
import { useApp } from '../state/store';
import { Dialog } from './Dialog';
import { exportAndDownload, exportBodyIds, importFile, IMPORT_ACCEPT, QUALITY, type ExportFormat, type Quality } from '../io/fileOps';

const PROGRAM_HINTS: { program: string; closed: string; use: string }[] = [
  { program: 'Autodesk Inventor', closed: 'IPT / IAM', use: 'STEP (zalecany) lub IGES' },
  { program: 'Autodesk Fusion', closed: 'F3D', use: 'STEP (zalecany) lub IGES' },
  { program: 'AutoCAD (3D)', closed: 'DWG', use: 'STEP lub IGES dla brył, DXF dla szkiców 2D' },
  { program: 'Blender', closed: '.blend', use: 'OBJ, glTF/GLB lub PLY (STL także działa)' },
  { program: 'Bambu Studio, Orca, PrusaSlicer, Cura', closed: '—', use: '3MF (zalecany) lub STL' },
];

function ProgramTable({ mode }: { mode: 'import' | 'export' }) {
  return (
    <table className="format-table" data-testid="program-hints">
      <thead>
        <tr>
          <th>Program</th>
          <th>Format zamknięty (nieobsługiwany)</th>
          <th>{mode === 'export' ? 'Eksportuj jako' : 'Zapisz w programie jako'}</th>
        </tr>
      </thead>
      <tbody>
        {PROGRAM_HINTS.map((h) => (
          <tr key={h.program}>
            <td>{h.program}</td>
            <td>{h.closed}</td>
            <td>{h.use}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const FORMATS: { id: ExportFormat; label: string; group: string; desc: string; mesh?: boolean }[] = [
  { id: '3mf', label: '3MF', group: 'Druk 3D', desc: 'Zalecany do slicerów (Bambu Studio, Orca, PrusaSlicer). Zapisuje jednostkę mm.', mesh: true },
  { id: 'stl', label: 'STL binarny', group: 'Druk 3D', desc: 'Uniwersalny, mały plik. Bez jednostek – przyjmuje się mm.', mesh: true },
  { id: 'stl-ascii', label: 'STL ASCII', group: 'Druk 3D', desc: 'Tekstowy STL (większy plik).', mesh: true },
  { id: 'obj', label: 'OBJ', group: 'Druk 3D / Blender', desc: 'Siatka tekstowa, czytana przez Blendera i slicery.', mesh: true },
  { id: 'step', label: 'STEP', group: 'CAD', desc: 'Dokładna bryła B-rep w mm – Inventor, Fusion, AutoCAD 3D, SolidWorks, FreeCAD.' },
  { id: 'iges', label: 'IGES', group: 'CAD', desc: 'Starszy format wymiany CAD (bryły jako encje 186). Pierwsze użycie pobiera moduł ~11 MB.' },
  { id: 'dxf', label: 'DXF (szkice 2D)', group: 'CAD', desc: 'Szkic aktywny (lub widoczne szkice) jako linie, łuki i okręgi w mm.' },
  { id: 'glb', label: 'glTF (GLB)', group: 'Blender', desc: 'Binarny glTF – dobry dla Blendera i przeglądarek 3D.', mesh: true },
  { id: 'ply', label: 'PLY', group: 'Blender', desc: 'Binarna siatka PLY.', mesh: true },
  { id: 'project', label: 'Projekt 3D Edit (.3dedit)', group: 'Projekt', desc: 'Pełna historia operacji i szkice – do dalszej edycji w tej aplikacji.' },
];

export function ExportDialog() {
  const [format, setFormat] = useState<ExportFormat>('3mf');
  const [quality, setQuality] = useState<Quality>('normal');
  const [onlySel, setOnlySel] = useState(false);
  const [meters, setMeters] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasSel = useApp((s) => !!s.selection && 'bodyId' in s.selection);
  const f = FORMATS.find((x) => x.id === format)!;
  const close = () => useApp.getState().setDialog(null);
  return (
    <Dialog title="Eksport" onClose={close} wide>
      <div className="export-grid">
        {FORMATS.map((x) => (
          <button key={x.id} className={format === x.id ? 'on' : ''} data-testid={`fmt-${x.id}`} onClick={() => setFormat(x.id)}>
            <b>{x.label}</b>
            <span className="muted">{x.group}</span>
          </button>
        ))}
      </div>
      <div className="note">{f.desc}</div>
      {f.mesh && (
        <label className="nf">
          <span className="nf-label">Dokładność siatki</span>
          <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
            {(Object.keys(QUALITY) as Quality[]).map((q) => (
              <option key={q} value={q}>
                {QUALITY[q].label} – odchyłka {QUALITY[q].deflection} mm
              </option>
            ))}
          </select>
        </label>
      )}
      {format === 'glb' && (
        <label className="check">
          <input type="checkbox" checked={meters} onChange={(e) => setMeters(e.target.checked)} /> Zapisz w metrach (specyfikacja glTF; Blender pokaże wtedy rzeczywisty
          rozmiar). Domyślnie 1 jednostka = 1 mm.
        </label>
      )}
      {(format === 'obj' || format === 'ply' || format === 'stl' || format === 'stl-ascii') && (
        <div className="muted">Blender przyjmuje 1 jednostkę jako 1 m – w oknie importu ustaw skalę 0,001 albo w scenie jednostki „mm” ze skalą 0,001.</div>
      )}
      {format !== 'project' && format !== 'dxf' && (
        <label className="check">
          <input type="checkbox" checked={onlySel} disabled={!hasSel} onChange={(e) => setOnlySel(e.target.checked)} /> Tylko zaznaczona bryła (inaczej wszystkie widoczne)
        </label>
      )}
      <button
        className="primary"
        data-testid="do-export"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await exportAndDownload(format, { bodyIds: exportBodyIds(onlySel), quality, gltfMeters: meters });
            close();
          } catch {
            /* komunikat już pokazany */
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Przygotowywanie…' : `Zapisz ${f.label}`}
      </button>
      <h3>Którego formatu użyć?</h3>
      <ProgramTable mode="export" />
      <div className="muted">Formaty zamknięte (IPT/IAM, DWG, F3D, .blend) nie są zapisywane – użyj otwartego odpowiednika z tabeli.</div>
    </Dialog>
  );
}

export function ImportDialog() {
  const input = useRef<HTMLInputElement>(null);
  const [placeOnBed, setPlace] = useState(true);
  const [meters, setMeters] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => useApp.getState().setDialog(null);
  const run = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of Array.from(files)) await importFile(f, { placeOnBed, gltfMeters: meters });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Import" onClose={close} wide>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          run(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Wczytywanie…' : 'Kliknij, aby wybrać plik, albo upuść go tutaj'}
        <div className="muted">STL, 3MF, OBJ, PLY, GLB/glTF, STEP, IGES, BREP, DXF (szkic), projekt .3dedit</div>
      </div>
      <input ref={input} type="file" accept={IMPORT_ACCEPT} multiple hidden data-testid="import-input" onChange={(e) => run(e.target.files)} />
      <label className="check">
        <input type="checkbox" checked={placeOnBed} onChange={(e) => setPlace(e.target.checked)} /> Ułóż na środku stołu (spód w Z=0)
      </label>
      <label className="check">
        <input type="checkbox" checked={meters} onChange={(e) => setMeters(e.target.checked)} /> Pliki glTF/GLB są w metrach (przelicz ×1000)
      </label>
      {error && <div className="error-box" data-testid="import-error">⚠ {error}</div>}
      <div className="note">
        <b>Siatki (STL, 3MF, OBJ, PLY, glTF)</b> można przesuwać, obracać, skalować i łączyć z bryłami operacjami logicznymi (wynik jest wtedy siatką). Siatka to zbiór trójkątów,
        a nie dokładna bryła: nie da się na niej zaokrąglać ani fazować krawędzi, wiercić otworów narzędziem „Otwór”, wyciągać ścian ani rysować szkicu na jej ścianie, a eksport do
        STEP/IGES zapisze ją jako wiele małych płaskich ścian (maks. 20 000 trójkątów). Operacje logiczne wymagają siatki zamkniętej (wodoszczelnej). <b>STEP i IGES</b> importowane są
        jako dokładne bryły B-rep – działają na nich wszystkie narzędzia.
      </div>
      <h3>Pliki z innych programów</h3>
      <ProgramTable mode="import" />
    </Dialog>
  );
}
