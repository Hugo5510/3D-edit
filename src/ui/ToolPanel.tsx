import { useApp } from '../state/store';
import { NumberField } from './NumberField';
import { ModeSelect } from './FeaturePanel';
import { refs } from '../viewer/ref';
import { BASE_PLANES, startSketch, type ExtrudeTool } from '../viewer/tools/ModelTools';
import type { ExtrudeFeature } from '../model/types';
import { toolPanels } from './toolPanels';

/** Panel parametrów aktywnego narzędzia. */
export function ToolPanel() {
  const tool = useApp((s) => s.tool);
  const ts = useApp((s) => s.toolState);
  const doc = useApp((s) => s.doc);
  const bodies = useApp((s) => s.bodies);
  const error = useApp((s) => {
    const ex = s.toolState.extrude as { featureId: string } | null | undefined;
    return ex ? s.build?.errors[ex.featureId] : undefined;
  });

  if (tool === 'sketchPlane') {
    return (
      <div className="panel-section" data-testid="sketch-plane-panel">
        <h3>Nowy szkic</h3>
        <div className="muted">Wybierz płaszczyznę bazową albo kliknij płaską ścianę bryły w widoku.</div>
        {BASE_PLANES.map((p) => (
          <button key={p.name} data-testid={`plane-${p.name.slice(0, 2)}`} onClick={() => startSketch(p.plane)}>
            Płaszczyzna {p.name}
          </button>
        ))}
      </div>
    );
  }

  if (tool === 'extrude') {
    const ex = ts.extrude as { featureId: string } | null | undefined;
    const f = ex ? (doc.features.find((x) => x.id === ex.featureId) as ExtrudeFeature | undefined) : undefined;
    const t = refs.viewer?.tool as ExtrudeTool | undefined;
    if (!f || !t) return <div className="panel-section"><h3>Wyciągnięcie</h3><div className="muted">{(ts.hint as string) ?? ''}</div></div>;
    const target = ts.target as string | null;
    return (
      <div className="panel-section" data-testid="extrude-panel">
        <h3>Wyciągnięcie</h3>
        <NumberField label="Wysokość" testId="extrude-distance" value={f.distance} autoFocus onChange={(v) => v !== 0 && t.update({ distance: v })} />
        <label className="check">
          <input type="checkbox" checked={!!f.symmetric} onChange={(e) => t.update({ symmetric: e.target.checked })} /> Symetrycznie w obie strony
        </label>
        <ModeSelect value={f.mode} onChange={(m) => t.update({ mode: m })} />
        {f.mode !== 'new' && (
          <label className="nf">
            <span className="nf-label">{f.mode === 'cut' ? 'Wytnij z bryły' : 'Dodaj do bryły'}</span>
            <select value={target ?? ''} onChange={(e) => t.update({ target: e.target.value })} data-testid="extrude-target">
              {doc.bodies
                .filter((b) => bodies[b.id] || b.id === target)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {error && <div className="error-box">⚠ {error}</div>}
        <div className="btnrow">
          <button className="primary" data-testid="extrude-ok" onClick={() => t.confirm()}>
            OK
          </button>
          <button
            onClick={() => {
              t.cancel();
              useApp.getState().setTool('select');
            }}
          >
            Anuluj
          </button>
        </div>
        <div className="muted">Ujemna wysokość wyciąga w przeciwną stronę. Strzałkę w widoku można przeciągać.</div>
      </div>
    );
  }
  const extra = toolPanels[tool];
  if (extra) return extra();
  return null;
}
