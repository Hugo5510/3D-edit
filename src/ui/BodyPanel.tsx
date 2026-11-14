import { useState } from 'react';
import { useApp } from '../state/store';
import { NumberField } from './NumberField';
import { PRIMITIVE_NAMES, deleteBody, transformBody, updateFeature, clone } from '../state/actions';
import { about, fmt, rad, rotationAxis, scaling, translation } from '../model/math';
import type { PrimitiveFeature, Vec3 } from '../model/types';

const PARAM_LABELS: Record<string, Record<string, string>> = {
  box: { w: 'Szerokość (X)', d: 'Głębokość (Y)', h: 'Wysokość (Z)' },
  cylinder: { r: 'Promień', h: 'Wysokość' },
  sphere: { r: 'Promień' },
  cone: { r1: 'Promień dolny', r2: 'Promień górny', h: 'Wysokość' },
  torus: { R: 'Promień torusa', r: 'Promień przekroju' },
  prism: { n: 'Liczba boków', r: 'Promień opisany', h: 'Wysokość' },
  wedge: { w: 'Szerokość (X)', d: 'Głębokość (Y)', h: 'Wysokość (Z)', top: 'Górna krawędź (X)' },
};

export function BodyPanel({ bodyId }: { bodyId: string }) {
  const doc = useApp((s) => s.doc);
  const body = useApp((s) => s.bodies[bodyId]);
  const commit = useApp((s) => s.commit);
  const meta = doc.bodies.find((b) => b.id === bodyId);
  const [angle, setAngle] = useState(90);
  const [pct, setPct] = useState(100);
  const [uniform, setUniform] = useState(true);
  if (!meta) return null;
  const creator = doc.features.find((f) => f.bodyId === bodyId && (f.type === 'primitive' || f.type === 'import' || (f.type === 'extrude' && f.mode === 'new')));
  const prim = creator?.type === 'primitive' ? (creator as PrimitiveFeature) : null;
  const bb = body?.bbox;
  const size: Vec3 = bb ? [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]] : [0, 0, 0];
  const center: Vec3 = bb ? [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2] : [0, 0, 0];
  const pivot: Vec3 = bb ? [center[0], center[1], bb.min[2]] : [0, 0, 0];

  const move = (d: Vec3) => commit(transformBody(useApp.getState().doc, bodyId, translation(d), true));
  const rotate = (axis: 0 | 1 | 2, deg: number) => {
    const a: Vec3 = [0, 0, 0];
    a[axis] = 1;
    commit(transformBody(useApp.getState().doc, bodyId, about(rotationAxis(a, rad(deg)), center), true));
  };
  const scale = (s: Vec3) => {
    if (s.some((x) => !(x > 0))) return;
    commit(transformBody(useApp.getState().doc, bodyId, about(scaling(s), pivot), false));
  };
  const setSize = (axis: number, v: number) => {
    if (!(v > 0) || !(size[axis] > 0)) return;
    const f = v / size[axis];
    scale(uniform ? [f, f, f] : (([0, 1, 2].map((i) => (i === axis ? f : 1)) as unknown) as Vec3));
  };

  return (
    <div className="panel-section" data-testid="body-panel">
      <div className="row">
        <input
          className="name-input"
          value={meta.name}
          aria-label="Nazwa bryły"
          onChange={(e) => {
            const d = clone(useApp.getState().doc);
            d.bodies.find((b) => b.id === bodyId)!.name = e.target.value;
            useApp.getState().live(d);
          }}
        />
        <input
          type="color"
          value={meta.color}
          aria-label="Kolor"
          onChange={(e) => {
            const d = clone(useApp.getState().doc);
            d.bodies.find((b) => b.id === bodyId)!.color = e.target.value;
            commit(d);
          }}
        />
      </div>
      <div className="info">
        {body ? (
          <>
            {body.geometry === 'mesh' ? 'Siatka trójkątów' : 'Bryła B-rep'} · objętość {fmt(body.volume / 1000, 2)} cm³ ·{' '}
            {body.closed ? <span className="ok">zamknięta</span> : <span className="warn">niezamknięta!</span>}
          </>
        ) : (
          'Przeliczanie…'
        )}
      </div>
      {body?.geometry === 'mesh' && (
        <div className="note">
          Zaimportowana siatka: można ją przesuwać, obracać, skalować i łączyć operacjami logicznymi (wynik będzie siatką). Nie da się
          na niej zaokrąglać krawędzi, robić otworów narzędziem „Otwór” ani wyciągać jej ścian, a eksport STEP/IGES zapisze ją jako zbiór trójkątów.
        </div>
      )}

      {prim && (
        <fieldset>
          <legend>{PRIMITIVE_NAMES[prim.kind]} – wymiary</legend>
          {Object.entries(PARAM_LABELS[prim.kind]).map(([key, label]) => (
            <NumberField
              key={key}
              testId={`param-${key}`}
              label={label}
              value={prim.params[key] ?? 0}
              unit={key === 'n' ? '' : 'mm'}
              integer={key === 'n'}
              min={key === 'n' ? 3 : 0}
              onChange={(v) => commit(updateFeature(useApp.getState().doc, prim.id, (f) => ((f as PrimitiveFeature).params[key] = v)))}
            />
          ))}
          {'r' in prim.params && prim.kind !== 'torus' && prim.kind !== 'prism' && (
            <NumberField
              label="Średnica"
              testId="param-diameter"
              value={prim.params.r * 2}
              min={0}
              onChange={(v) => commit(updateFeature(useApp.getState().doc, prim.id, (f) => ((f as PrimitiveFeature).params.r = v / 2)))}
            />
          )}
        </fieldset>
      )}

      {bb && (
        <>
          <fieldset>
            <legend>Pozycja (środek X/Y, spód Z)</legend>
            <div className="grid3">
              {(['X', 'Y', 'Z'] as const).map((ax, i) => (
                <NumberField
                  key={ax}
                  testId={`pos-${ax}`}
                  label={ax}
                  value={i === 2 ? bb.min[2] : center[i]}
                  onChange={(v) => {
                    const d: Vec3 = [0, 0, 0];
                    d[i] = v - (i === 2 ? bb.min[2] : center[i]);
                    move(d);
                  }}
                />
              ))}
            </div>
            <div className="btnrow">
              <button onClick={() => move([0, 0, -bb.min[2]])} title="Opuść bryłę tak, by leżała na stole (Z=0)">
                Połóż na stole
              </button>
              <button onClick={() => move([-center[0], -center[1], 0])}>Wyśrodkuj</button>
            </div>
          </fieldset>
          <fieldset>
            <legend>Obrót (wokół środka bryły)</legend>
            <div className="row">
              <NumberField label="Kąt" testId="rot-angle" unit="°" value={angle} onChange={setAngle} />
              {(['X', 'Y', 'Z'] as const).map((ax, i) => (
                <button key={ax} data-testid={`rot-${ax}`} onClick={() => rotate(i as 0 | 1 | 2, angle)} title={`Obróć o podany kąt wokół osi ${ax}`}>
                  ↻ {ax}
                </button>
              ))}
            </div>
            <div className="btnrow">
              {(['X', 'Y', 'Z'] as const).map((ax, i) => (
                <button key={ax} data-testid={`rot90-${ax}`} onClick={() => rotate(i as 0 | 1 | 2, 90)}>
                  90° {ax}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Wymiary i skalowanie</legend>
            <label className="check">
              <input type="checkbox" checked={uniform} onChange={(e) => setUniform(e.target.checked)} /> Równomiernie (zachowaj proporcje)
            </label>
            <div className="grid3">
              {(['X', 'Y', 'Z'] as const).map((ax, i) => (
                <NumberField key={ax} testId={`size-${ax}`} label={ax} value={size[i]} min={0.01} onChange={(v) => setSize(i, v)} />
              ))}
            </div>
            <div className="row">
              <NumberField label="Skala" testId="scale-pct" unit="%" value={pct} min={0.1} onChange={setPct} />
              <button data-testid="scale-apply" onClick={() => scale([pct / 100, pct / 100, pct / 100])}>
                Skaluj
              </button>
            </div>
          </fieldset>
        </>
      )}
      <div className="btnrow">
        <button className="danger" data-testid="delete-body" onClick={() => {
          commit(deleteBody(useApp.getState().doc, bodyId));
          useApp.getState().setSelection(null);
        }}>
          Usuń bryłę
        </button>
      </div>
    </div>
  );
}
