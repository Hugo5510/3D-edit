import { useApp } from '../state/store';
import { featureLabel, updateFeature } from '../state/actions';
import { NumberField } from './NumberField';
import type { Feature } from '../model/types';
import { BodyPanel } from './BodyPanel';

/** Edycja parametrów dowolnej operacji z historii – zmiana od razu przebudowuje geometrię. */
export function FeaturePanel({ featureId }: { featureId: string }) {
  const doc = useApp((s) => s.doc);
  const error = useApp((s) => s.build?.errors[featureId]);
  const commit = useApp((s) => s.commit);
  const f = doc.features.find((x) => x.id === featureId);
  if (!f) return null;
  const up = (fn: (f: Feature) => void) => commit(updateFeature(useApp.getState().doc, featureId, fn));
  let body: React.ReactNode = null;
  switch (f.type) {
    case 'primitive':
      return <BodyPanel bodyId={f.bodyId} />;
    case 'extrude':
      body = (
        <>
          <NumberField label="Wysokość" testId="feat-distance" value={f.distance} onChange={(v) => up((x) => ((x as typeof f).distance = v))} />
          <label className="check">
            <input type="checkbox" checked={!!f.symmetric} onChange={(e) => up((x) => ((x as typeof f).symmetric = e.target.checked))} /> Symetrycznie
          </label>
          <ModeSelect value={f.mode} onChange={(m) => up((x) => ((x as typeof f).mode = m))} />
        </>
      );
      break;
    case 'hole':
      body = (
        <>
          <NumberField label="Średnica" testId="feat-diameter" value={f.diameter} min={0.01} onChange={(v) => up((x) => ((x as typeof f).diameter = v))} />
          <label className="check">
            <input type="checkbox" checked={f.through} onChange={(e) => up((x) => ((x as typeof f).through = e.target.checked))} /> Na wylot
          </label>
          {!f.through && <NumberField label="Głębokość" value={f.depth} min={0.01} onChange={(v) => up((x) => ((x as typeof f).depth = v))} />}
          <NumberField label={f.edges ? 'Od krawędzi 1' : 'Przesunięcie X'} value={f.offsets[0]} onChange={(v) => up((x) => ((x as typeof f).offsets[0] = v))} />
          <NumberField label={f.edges ? 'Od krawędzi 2' : 'Przesunięcie Y'} value={f.offsets[1]} onChange={(v) => up((x) => ((x as typeof f).offsets[1] = v))} />
        </>
      );
      break;
    case 'fillet':
    case 'chamfer':
      body = (
        <NumberField
          label={f.type === 'fillet' ? 'Promień' : 'Odległość fazy'}
          testId="feat-radius"
          value={f.radius}
          min={0.01}
          onChange={(v) => up((x) => ((x as typeof f).radius = v))}
        />
      );
      break;
    case 'boolean':
      body = (
        <div className="seg">
          {(
            [
              ['union', 'Suma'],
              ['subtract', 'Różnica'],
              ['intersect', 'Część wspólna'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={f.op === k ? 'on' : ''} onClick={() => up((x) => ((x as typeof f).op = k))}>
              {l}
            </button>
          ))}
        </div>
      );
      break;
    case 'transform': {
      const m = f.matrix;
      body = (
        <>
          <div className="muted">Przesunięcie zawarte w przekształceniu:</div>
          <div className="grid3">
            {(['X', 'Y', 'Z'] as const).map((ax, i) => (
              <NumberField key={ax} label={ax} value={m[12 + i]} onChange={(v) => up((x) => ((x as typeof f).matrix[12 + i] = v))} />
            ))}
          </div>
          <div className="muted">Obrót i skalę zmienisz, zaznaczając bryłę.</div>
        </>
      );
      break;
    }
    default:
      body = null;
  }
  return (
    <div className="panel-section">
      <h3>{featureLabel(f, doc)}</h3>
      {error && <div className="error-box">⚠ {error}</div>}
      {body}
    </div>
  );
}

export function ModeSelect({ value, onChange }: { value: 'new' | 'join' | 'cut'; onChange: (m: 'new' | 'join' | 'cut') => void }) {
  return (
    <div className="seg" role="group" aria-label="Tryb">
      {(
        [
          ['join', 'Dodaj materiał'],
          ['cut', 'Wytnij'],
          ['new', 'Nowa bryła'],
        ] as const
      ).map(([k, l]) => (
        <button key={k} data-testid={`mode-${k}`} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}
