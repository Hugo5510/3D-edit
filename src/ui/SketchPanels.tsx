import { useApp, type ToolId } from '../state/store';
import { updateSketch } from '../state/actions';
import { NumberField } from './NumberField';
import { Icon } from './icons';
import { refs } from '../viewer/ref';
import type { DimDef } from '../viewer/tools/SketchTools';
import { exitSketch } from '../viewer/tools/sketchMode';
import { fillAll, movePoint, rectSize, setArcRadius, setLineAngle, setLineLength, setPolygonSides, setRectSize, applyPolygon, getPoint, removeEntity } from '../model/sketchOps';
import { arcGeometry, gaps, loopPolygon, orderLoop, pointMap, polygonArea } from '../model/sketchGeom';
import { deg, fmt } from '../model/math';
import type { PolygonGroup, RectGroup, Sketch } from '../model/types';

export const SKETCH_TOOLS: { id: ToolId; label: string; icon: string; key: string }[] = [
  { id: 'select', label: 'Zaznacz', icon: 'select', key: 'Esc' },
  { id: 'line', label: 'Linia', icon: 'line', key: 'L' },
  { id: 'rect', label: 'Prostokąt', icon: 'rect', key: 'R' },
  { id: 'circle', label: 'Okrąg', icon: 'circle', key: 'C' },
  { id: 'polygon', label: 'Wielokąt', icon: 'polygon', key: 'P' },
  { id: 'arc3', label: 'Łuk 3 pkt', icon: 'arc3', key: 'A' },
  { id: 'arcc', label: 'Łuk ze środkiem', icon: 'arcc', key: 'Shift+A' },
  { id: 'sketchFillet', label: 'Zaokrąglij narożnik', icon: 'fillet2d', key: 'Shift+F' },
  { id: 'fill', label: 'Wypełnij', icon: 'fill', key: 'W' },
  { id: 'erase', label: 'Gumka', icon: 'erase', key: 'X' },
];

function useActiveSketch(): Sketch | null {
  return useApp((s) => s.doc.sketches.find((x) => x.id === s.activeSketchId) ?? null);
}

export function SketchBar() {
  const sk = useActiveSketch();
  const tool = useApp((s) => s.tool);
  if (!sk) return null;
  const gp = gaps(sk).filter((g) => g.distance > 0);
  return (
    <div className="sketch-bar" data-testid="sketch-bar">
      {SKETCH_TOOLS.map((t) => (
        <button
          key={t.id}
          className={'tool' + (tool === t.id ? ' on' : '')}
          title={`${t.label} (${t.key})`}
          data-testid={`sk-${t.id}`}
          onClick={() => useApp.getState().setTool(t.id)}
        >
          <Icon name={t.icon} size={20} />
          <span>{t.label}</span>
        </button>
      ))}
      <button
        className="tool"
        title="Wypełnij wszystkie zamknięte kontury"
        data-testid="sk-fill-all"
        onClick={() => {
          const st = useApp.getState();
          let n = 0;
          st.commit(updateSketch(st.doc, sk.id, (s) => (n = fillAll(s).length)));
          st.notify(n ? `Wypełniono obszary: ${n}` : 'Brak zamkniętych konturów do wypełnienia', n ? 'ok' : 'error');
        }}
      >
        <Icon name="fill" size={20} />
        <span>Wypełnij wszystko</span>
      </button>
      <button className="tool primary" data-testid="sk-finish" onClick={exitSketch} title="Zakończ edycję szkicu">
        <Icon name="check" size={20} />
        <span>Zakończ szkic</span>
      </button>
      {gp.length > 0 && (
        <span className="gap-info" data-testid="gap-info" title="Przerwy w konturze zaznaczone są na czerwono">
          ⚠ Niedomknięty kontur: {gp.length} {gp.length === 1 ? 'przerwa' : 'przerwy'}
        </span>
      )}
    </div>
  );
}

/** Pole wymiarów pojawiające się w trakcie rysowania. */
export function DimBox() {
  const dims = useApp((s) => s.toolState.dims as DimDef[] | null | undefined);
  const hint = useApp((s) => s.toolState.hint as string | undefined);
  const active = useApp((s) => !!s.activeSketchId);
  if (!active) return hint ? <div className="tool-hint">{hint}</div> : null;
  return (
    <>
      {hint && <div className="tool-hint">{hint}</div>}
      {dims && dims.length > 0 && (
        <div className="dim-box" data-testid="dim-box">
          {dims.map((d) => (
            <NumberField
              key={d.key}
              testId={`dim-${d.key}`}
              label={d.label}
              unit={d.unit}
              value={d.value}
              integer={d.integer}
              onChange={(v) => (refs.viewer?.tool as { setDim?: (k: string, v: number) => void })?.setDim?.(d.key, v)}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** Edycja wymiarów zaznaczonego elementu szkicu – zmiana od razu przebudowuje geometrię. */
export function SketchSelectionPanel() {
  const sel = useApp((s) => s.selection);
  const doc = useApp((s) => s.doc);
  const commit = useApp((s) => s.commit);
  if (!sel || (sel.kind !== 'sketch' && sel.kind !== 'profile')) return null;
  const sk = doc.sketches.find((s) => s.id === sel.sketchId);
  if (!sk) return null;
  const edit = (fn: (s: Sketch) => void) => {
    try {
      commit(updateSketch(useApp.getState().doc, sk.id, fn));
    } catch (e) {
      useApp.getState().notify(e instanceof Error ? e.message : String(e), 'error');
    }
  };
  const pts = pointMap(sk);

  if (sel.kind === 'profile') {
    const pr = sk.profiles.find((p) => p.id === sel.profileId);
    if (!pr) return null;
    let area = 0;
    try {
      const loops = pr.loops.map((l) => Math.abs(polygonArea(loopPolygon(orderLoop(sk, l)))));
      area = loops[0] - loops.slice(1).reduce((a, b) => a + b, 0);
    } catch {
      area = 0;
    }
    return (
      <div className="panel-section" data-testid="profile-panel">
        <h3>Wypełniony kontur</h3>
        <div className="info">
          Pole ≈ {fmt(area)} mm² · {pr.loops.length - 1 > 0 ? `otwory: ${pr.loops.length - 1}` : 'bez otworów'}
        </div>
        <button className="primary" data-testid="extrude-profile" onClick={() => useApp.getState().setTool('extrude')}>
          <Icon name="extrude" size={18} /> Wyciągnij
        </button>
        <button
          className="danger"
          onClick={() => {
            edit((s) => (s.profiles = s.profiles.filter((p) => p.id !== pr.id)));
            useApp.getState().setSelection(null);
          }}
        >
          Usuń wypełnienie
        </button>
      </div>
    );
  }

  if (sel.points.length === 1 && !sel.entities.length) {
    const p = sk.points.find((x) => x.id === sel.points[0]);
    if (!p) return null;
    return (
      <div className="panel-section">
        <h3>Punkt szkicu</h3>
        <div className="grid3">
          <NumberField label="X" testId="pt-x" value={p.x} onChange={(v) => edit((s) => movePoint(s, p.id, [v, getPoint(s, p.id).y]))} />
          <NumberField label="Y" testId="pt-y" value={p.y} onChange={(v) => edit((s) => movePoint(s, p.id, [getPoint(s, p.id).x, v]))} />
        </div>
        <div className="muted">Punkt można przeciągnąć myszą lub palcem. Upuszczony na inny punkt łączy się z nim.</div>
      </div>
    );
  }
  const e = sk.entities.find((x) => x.id === sel.entities[0]);
  if (!e) return null;
  const group = e.group ? sk.groups.find((g) => g.id === e.group) : undefined;
  const del = (
    <button
      className="danger"
      onClick={() => {
        edit((s) => removeEntity(s, e.id));
        useApp.getState().setSelection(null);
      }}
    >
      Usuń element
    </button>
  );

  if (group?.kind === 'rect') {
    const [w, h] = rectSize(sk, group as RectGroup);
    return (
      <div className="panel-section" data-testid="sketch-entity-panel">
        <h3>Prostokąt</h3>
        <div className="grid3">
          <NumberField label="Szerokość" testId="rect-w" value={w} min={0.01} onChange={(v) => edit((s) => setRectSize(s, group.id, v, h))} />
          <NumberField label="Wysokość" testId="rect-h" value={h} min={0.01} onChange={(v) => edit((s) => setRectSize(s, group.id, w, v))} />
        </div>
        <PointFields sk={sk} id={group.points[0]} label="Narożnik" edit={edit} />
        {del}
      </div>
    );
  }
  if (group?.kind === 'polygon') {
    const g = group as PolygonGroup;
    return (
      <div className="panel-section" data-testid="sketch-entity-panel">
        <h3>Wielokąt foremny</h3>
        <NumberField label="Liczba boków" unit="" integer min={3} max={200} value={g.points.length} onChange={(v) => edit((s) => setPolygonSides(s, g.id, v))} />
        <NumberField
          label="Promień opisany"
          testId="poly-r"
          value={g.radius}
          min={0.01}
          onChange={(v) =>
            edit((s) => {
              const gg = s.groups.find((x) => x.id === g.id) as PolygonGroup;
              gg.radius = v;
              applyPolygon(s, gg);
            })
          }
        />
        <div className="grid3">
          {[0, 1].map((i) => (
            <NumberField
              key={i}
              label={i ? 'Środek Y' : 'Środek X'}
              value={g.center[i]}
              onChange={(v) =>
                edit((s) => {
                  const gg = s.groups.find((x) => x.id === g.id) as PolygonGroup;
                  gg.center = i ? [gg.center[0], v] : [v, gg.center[1]];
                  applyPolygon(s, gg);
                })
              }
            />
          ))}
        </div>
        {del}
      </div>
    );
  }
  if (e.type === 'line') {
    const a = pts.get(e.a)!, b = pts.get(e.b)!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ang = deg(Math.atan2(b[1] - a[1], b[0] - a[0]));
    return (
      <div className="panel-section" data-testid="sketch-entity-panel">
        <h3>Linia</h3>
        <div className="grid3">
          <NumberField label="Długość" testId="line-len" value={len} min={0.01} onChange={(v) => edit((s) => setLineLength(s, e.id, v))} />
          <NumberField label="Kąt" unit="°" testId="line-ang" value={ang} onChange={(v) => edit((s) => setLineAngle(s, e.id, v))} />
        </div>
        <PointFields sk={sk} id={e.a} label="Początek" edit={edit} />
        <PointFields sk={sk} id={e.b} label="Koniec" edit={edit} />
        {del}
      </div>
    );
  }
  if (e.type === 'circle') {
    return (
      <div className="panel-section" data-testid="sketch-entity-panel">
        <h3>Okrąg</h3>
        <div className="grid3">
          <NumberField label="Promień" testId="circle-r" value={e.r} min={0.01} onChange={(v) => edit((s) => ((s.entities.find((x) => x.id === e.id) as typeof e).r = v))} />
          <NumberField label="Średnica" testId="circle-d" value={e.r * 2} min={0.02} onChange={(v) => edit((s) => ((s.entities.find((x) => x.id === e.id) as typeof e).r = v / 2))} />
        </div>
        <PointFields sk={sk} id={e.c} label="Środek" edit={edit} />
        {del}
      </div>
    );
  }
  const g = arcGeometry(pts.get(e.a)!, pts.get(e.b)!, e.bulge);
  return (
    <div className="panel-section" data-testid="sketch-entity-panel">
      <h3>Łuk</h3>
      <div className="grid3">
        <NumberField label="Promień" testId="arc-r" value={g.r} min={0.01} onChange={(v) => edit((s) => setArcRadius(s, e.id, v))} />
        <NumberField label="Kąt łuku" unit="°" value={Math.abs(deg(g.sweep))} disabled onChange={() => {}} />
      </div>
      <PointFields sk={sk} id={e.a} label="Początek" edit={edit} />
      <PointFields sk={sk} id={e.b} label="Koniec" edit={edit} />
      {del}
    </div>
  );
}

function PointFields({ sk, id, label, edit }: { sk: Sketch; id: string; label: string; edit: (fn: (s: Sketch) => void) => void }) {
  const p = sk.points.find((x) => x.id === id);
  if (!p) return null;
  return (
    <div className="grid3">
      <NumberField label={`${label} X`} value={p.x} onChange={(v) => edit((s) => movePoint(s, id, [v, getPoint(s, id).y]))} />
      <NumberField label={`${label} Y`} value={p.y} onChange={(v) => edit((s) => movePoint(s, id, [getPoint(s, id).x, v]))} />
    </div>
  );
}
