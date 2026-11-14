import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';
import { Viewport, bedProblems, viewerInstance } from './Viewport';
import { Toolbar } from './Toolbar';
import { PropertiesPanel } from './PropertiesPanel';
import { FeatureTree } from './FeatureTree';
import { Icon } from './icons';
import { PrinterDialog } from './PrinterDialog';
import { deleteBody, clone } from '../state/actions';
import { emptyDoc } from '../model/types';
import { NumberField } from './NumberField';
import { SketchBar, DimBox } from './SketchPanels';
import { ExportDialog, ImportDialog } from './FileDialogs';
import { BambuDialog } from './BambuDialog';
import { ErrorBoundary } from './ErrorBoundary';
import { exportAndDownload, importFile, IMPORT_ACCEPT } from '../io/fileOps';

export function App() {
  const message = useApp((s) => s.message);
  const dragInfo = useApp((s) => s.dragInfo);
  const building = useApp((s) => s.building);
  const kernelReady = useApp((s) => s.kernelReady);
  const kernelError = useApp((s) => s.kernelError);
  const past = useApp((s) => s.past.length);
  const future = useApp((s) => s.future.length);
  const dialog = useApp((s) => s.dialog);
  const settings = useApp((s) => s.settings);
  const problems = useApp((s) => bedProblems(s).join('; '));
  const [panelOpen, setPanelOpen] = useState(true);
  const [treeOpen, setTreeOpen] = useState(false);
  const openInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const st = useApp.getState();
      if (viewerInstance?.tool?.key?.(e)) {
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        st.undo();
      } else if ((e.ctrlKey || e.metaKey) && k === 's') {
        e.preventDefault();
        exportAndDownload('project').catch(() => {});
      } else if ((e.ctrlKey || e.metaKey) && k === 'o') {
        e.preventDefault();
        openInput.current?.click();
      } else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        st.redo();
      } else if (e.key === 'Escape') {
        if (st.tool !== 'select') st.setTool('select');
        else st.setSelection(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = st.selection;
        if (sel?.kind === 'body') {
          st.commit(deleteBody(st.doc, sel.bodyId));
          st.setSelection(null);
        }
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const map = shortcutMap();
        if (k === 'f') viewerInstance?.fitAll();
        else if (k === 'g') st.setSettings({ gridSnap: !st.settings.gridSnap });
        else if (e.shiftKey && k === 'a' && st.activeSketchId) st.setTool('arcc');
        else if (e.shiftKey && k === 'f' && st.activeSketchId) st.setTool('sketchFillet');
        else if (map[k]) map[k]();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className={'app' + (panelOpen ? '' : ' panel-closed') + (dragOver ? ' drag-over' : '')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        if (useApp.getState().dialog === 'import') return;
        for (const f of Array.from(e.dataTransfer.files))
          await importFile(f, { placeOnBed: true, gltfMeters: false }).catch((err) => useApp.getState().notify(String(err.message ?? err), 'error'));
      }}
    >
      <header className="topbar">
        <div className="brand">
          <Icon name="box" /> <b>3D Edit</b>
        </div>
        <button
          className="tb"
          title="Nowy projekt"
          data-testid="new-project"
          onClick={() => {
            if (!confirm('Utworzyć nowy, pusty projekt? Bieżący można cofnąć przyciskiem „Cofnij”.')) return;
            const st = useApp.getState();
            st.commit({ ...emptyDoc(), printer: clone(st.doc.printer) });
            st.setSelection(null);
          }}
        >
          <Icon name="new" />
          <span>Nowy</span>
        </button>
        <button className="tb" title="Otwórz projekt lub plik (Ctrl+O)" data-testid="open-file" onClick={() => openInput.current?.click()}>
          <Icon name="open" />
          <span>Otwórz</span>
        </button>
        <input
          ref={openInput}
          type="file"
          hidden
          accept={IMPORT_ACCEPT}
          data-testid="open-input"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) await importFile(f, { placeOnBed: true, gltfMeters: false }).catch((err) => useApp.getState().notify(String(err.message ?? err), 'error'));
          }}
        />
        <button className="tb" title="Zapisz projekt z historią operacji (Ctrl+S)" data-testid="save-project" onClick={() => exportAndDownload('project').catch(() => {})}>
          <Icon name="save" />
          <span>Zapisz</span>
        </button>
        <button className="tb" title="Import STL, 3MF, OBJ, STEP, IGES, DXF…" data-testid="import" onClick={() => useApp.getState().setDialog('import')}>
          <Icon name="import" />
          <span>Import</span>
        </button>
        <button className="tb" title="Eksport do druku 3D, CAD i Blendera" data-testid="export" onClick={() => useApp.getState().setDialog('export')}>
          <Icon name="export" />
          <span>Eksport</span>
        </button>
        <button className="tb accent" title="Zapisz 3MF ułożony na stole i otwórz w Bambu Studio" data-testid="bambu" onClick={() => useApp.getState().setDialog('bambu')}>
          <Icon name="bambu" />
          <span>Otwórz w Bambu Studio</span>
        </button>
        <div className="sep" />
        <button className="tb" title="Cofnij (Ctrl+Z)" data-testid="undo" disabled={!past} onClick={() => useApp.getState().undo()}>
          <Icon name="undo" />
          <span>Cofnij</span>
        </button>
        <button className="tb" title="Ponów (Ctrl+Y)" data-testid="redo" disabled={!future} onClick={() => useApp.getState().redo()}>
          <Icon name="redo" />
          <span>Ponów</span>
        </button>
        <div className="sep" />
        <button
          className={'tb' + (settings.gridSnap ? ' on' : '')}
          title="Przyciąganie do siatki (G)"
          data-testid="grid-snap"
          onClick={() => useApp.getState().setSettings({ gridSnap: !settings.gridSnap })}
        >
          <Icon name="grid" />
          <span>Siatka</span>
        </button>
        <div className="grid-step">
          <NumberField value={settings.gridStep} min={0.01} unit="mm" title="Krok siatki" onChange={(v) => useApp.getState().setSettings({ gridStep: v })} />
        </div>
        <button className="tb" title="Obszar roboczy drukarki" data-testid="printer" onClick={() => useApp.getState().setDialog('printer')}>
          <Icon name="settings" />
          <span>Drukarka</span>
        </button>
        <div className="grow" />
        <button className="tb mobile-only" onClick={() => setTreeOpen(!treeOpen)} title="Bryły i historia">
          <Icon name="layers" />
        </button>
        <button className="tb mobile-only" onClick={() => setPanelOpen(!panelOpen)} title="Panel właściwości">
          <Icon name="menu" />
        </button>
      </header>
      <div className="main">
        <Toolbar />
        <div className="viewport-wrap">
          <Viewport />
          <SketchBar />
          <DimBox />
          {dragInfo && (
            <div className="drag-info" style={{ left: dragInfo.x + 18, top: dragInfo.y + 18 }}>
              {dragInfo.text}
            </div>
          )}
          {message && (
            <div className={'toast ' + message.kind} data-testid="toast">
              {message.text}
            </div>
          )}
          {problems && (
            <div className="bed-warn" data-testid="bed-warning">
              ⚠ Model nie mieści się w obszarze roboczym drukarki: {problems}
            </div>
          )}
          {!kernelReady && !kernelError && <div className="loading">Ładowanie jądra geometrii (OpenCascade)…</div>}
          {kernelError && <div className="error-box floating">Błąd jądra geometrii: {kernelError}</div>}
        </div>
        <aside className={'side' + (treeOpen ? ' tree-open' : '')}>
          <ErrorBoundary label="panel właściwości">
            <PropertiesPanel />
          </ErrorBoundary>
          <ErrorBoundary label="historia">
            <FeatureTree />
          </ErrorBoundary>
        </aside>
      </div>
      <footer className="status">
        <span data-testid="status">{building ? 'Przeliczanie…' : kernelReady ? 'Gotowe' : 'Start…'}</span>
        <span className="muted">1 jednostka = 1 mm · oś Z do góry</span>
      </footer>
      <ErrorBoundary label="okno dialogowe">
        {dialog === 'printer' && <PrinterDialog />}
        {dialog === 'import' && <ImportDialog />}
        {dialog === 'export' && <ExportDialog />}
        {dialog === 'bambu' && <BambuDialog />}
      </ErrorBoundary>
    </div>
  );
}

/** Skróty klawiszowe narzędzi (uzupełniane w kolejnych etapach). */
export const shortcutHandlers: Record<string, () => void> = {};
function shortcutMap(): Record<string, () => void> {
  const st = useApp.getState();
  const inSketch = !!st.activeSketchId;
  const t = (id: Parameters<typeof st.setTool>[0]) => () => st.setTool(id);
  const base: Record<string, () => void> = { e: t('extrude'), x: t('erase'), h: t('hole'), o: t('fillet'), k: t('chamfer'), m: t('measure'), u: () => st.setTool('boolean', { op: 'union' }), s: () => !inSketch && st.setTool('sketchPlane'), ...shortcutHandlers };
  if (inSketch) Object.assign(base, { l: t('line'), r: t('rect'), c: t('circle'), p: t('polygon'), a: t('arc3'), w: t('fill') });
  return base;
}
