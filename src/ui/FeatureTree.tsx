import { useApp } from '../state/store';
import { clone, featureLabel, removeFeature, updateFeature } from '../state/actions';
import { editSketch } from '../viewer/tools/sketchMode';

const NO_ERRORS: Record<string, string> = {};

export function FeatureTree() {
  const doc = useApp((s) => s.doc);
  const errors = useApp((s) => s.build?.errors ?? NO_ERRORS);
  const selection = useApp((s) => s.selection);
  const bodies = useApp((s) => s.bodies);
  const commit = useApp((s) => s.commit);
  const setSel = useApp((s) => s.setSelection);
  const activeSketch = useApp((s) => s.activeSketchId);

  return (
    <div className="tree" data-testid="feature-tree">
      <h3>Bryły</h3>
      {doc.bodies.filter((b) => bodies[b.id]).length === 0 && <div className="muted">Brak brył – dodaj bryłę gotową albo narysuj szkic.</div>}
      {doc.bodies
        .filter((b) => bodies[b.id])
        .map((b) => (
          <div
            key={b.id}
            className={'tree-item' + (selection && 'bodyId' in selection && selection.bodyId === b.id ? ' sel' : '')}
            onClick={() => setSel({ kind: 'body', bodyId: b.id })}
          >
            <span className="swatch" style={{ background: b.color }} />
            <span className="grow">{b.name}</span>
            <button
              className="icon"
              title={b.visible ? 'Ukryj' : 'Pokaż'}
              onClick={(e) => {
                e.stopPropagation();
                const d = clone(doc);
                const m = d.bodies.find((x) => x.id === b.id)!;
                m.visible = !m.visible;
                commit(d);
              }}
            >
              {b.visible ? '👁' : '—'}
            </button>
          </div>
        ))}
      {doc.sketches.length > 0 && <h3>Szkice</h3>}
      {doc.sketches.map((s) => (
        <div key={s.id} className={'tree-item' + (activeSketch === s.id ? ' sel' : '')}>
          <span className="grow" onClick={() => editSketch(s.id)} title="Edytuj szkic">
            ✎ {s.name} <span className="muted">({s.entities.length} el., {s.profiles.length} wypełn.)</span>
          </span>
          <button
            className="icon"
            title={s.visible ? 'Ukryj' : 'Pokaż'}
            onClick={() => {
              const d = clone(doc);
              const m = d.sketches.find((x) => x.id === s.id)!;
              m.visible = !m.visible;
              commit(d);
            }}
          >
            {s.visible ? '👁' : '—'}
          </button>
        </div>
      ))}
      <h3>Historia operacji</h3>
      {doc.features.length === 0 && <div className="muted">Pusta</div>}
      <ol className="history">
        {doc.features.map((f) => (
          <li
            key={f.id}
            className={'tree-item' + (errors[f.id] ? ' error' : '') + (f.suppressed ? ' suppressed' : '') + (selection?.kind === 'feature' && selection.featureId === f.id ? ' sel' : '')}
            title={errors[f.id] ?? ''}
            onClick={() => setSel({ kind: 'feature', featureId: f.id })}
          >
            <span className="grow">
              {featureLabel(f, doc)}
              {errors[f.id] && <div className="err-text">⚠ {errors[f.id]}</div>}
            </span>
            <button
              className="icon"
              title={f.suppressed ? 'Włącz operację' : 'Wyłącz operację (wygaś)'}
              onClick={(e) => {
                e.stopPropagation();
                commit(updateFeature(doc, f.id, (x) => (x.suppressed = !x.suppressed)));
              }}
            >
              {f.suppressed ? '○' : '●'}
            </button>
            <button
              className="icon"
              title="Usuń operację"
              onClick={(e) => {
                e.stopPropagation();
                commit(removeFeature(doc, f.id));
                setSel(null);
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
