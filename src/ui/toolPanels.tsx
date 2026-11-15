// Panele narzędzi: otwór, operacje logiczne, zaokrąglenie/fazowanie, pomiar.
import { useApp, type ToolId } from '../state/store';
import { NumberField } from './NumberField';
import { refs } from '../viewer/ref';
import type { BooleanTool, FilletTool, HoleTool } from '../viewer/tools/FeatureTools';
import type { BooleanOp, HoleFeature, Vec3 } from '../model/types';
import { fmt } from '../model/math';

function OkCancel({ onOk, onCancel, okTestId }: { onOk: () => void; onCancel: () => void; okTestId: string }) {
  return (
    <div className="btnrow">
      <button className="primary" data-testid={okTestId} onClick={onOk}>
        OK
      </button>
      <button onClick={onCancel}>Anuluj</button>
    </div>
  );
}

function HolePanel() {
  const hole = useApp((s) => s.toolState.hole as { pairs: number; byEdges: boolean; featureId: string } | null | undefined);
  const doc = useApp((s) => s.doc);
  const error = useApp((s) => (hole ? s.build?.errors[hole.featureId] : undefined));
  const t = refs.viewer?.tool as HoleTool | undefined;
  const f = hole ? (doc.features.find((x) => x.id === hole.featureId) as HoleFeature | undefined) : undefined;
  if (!f || !t)
    return (
      <div className="panel-section">
        <h3>Otwór</h3>
        <div className="muted">Kliknij płaską ścianę bryły w miejscu, gdzie ma być otwór.</div>
      </div>
    );
  return (
    <div className="panel-section" data-testid="hole-panel">
      <h3>Otwór</h3>
      <NumberField label="Średnica" testId="hole-d" value={f.diameter} min={0.01} onChange={(v) => t.update({ diameter: v })} />
      <label className="check">
        <input type="checkbox" data-testid="hole-through" checked={f.through} onChange={(e) => t.update({ through: e.target.checked })} /> Na wylot
      </label>
      {!f.through && <NumberField label="Głębokość" testId="hole-depth" value={f.depth} min={0.01} onChange={(v) => t.update({ depth: v })} />}
      <div className="grid3">
        <NumberField label={hole!.byEdges ? 'Od krawędzi 1 (czerw.)' : 'Przesunięcie X'} testId="hole-o1" value={f.offsets[0]} onChange={(v) => t.update({ offset0: v })} />
        <NumberField label={hole!.byEdges ? 'Od krawędzi 2 (ziel.)' : 'Przesunięcie Y'} testId="hole-o2" value={f.offsets[1]} onChange={(v) => t.update({ offset1: v })} />
      </div>
      {hole!.pairs > 1 && <button onClick={() => t.nextPair()}>Zmień krawędzie odniesienia</button>}
      {!hole!.byEdges && <div className="muted">Ściana nie ma dwóch nierównoległych prostych krawędzi – położenie liczone od środka ściany.</div>}
      {error && <div className="error-box">⚠ {error}</div>}
      <OkCancel
        okTestId="hole-ok"
        onOk={() => t.confirm()}
        onCancel={() => {
          t.cancel();
          useApp.getState().setTool('select');
        }}
      />
    </div>
  );
}

const OPS: [BooleanOp, string][] = [
  ['union', 'Suma'],
  ['subtract', 'Różnica'],
  ['intersect', 'Część wspólna'],
];

function BooleanPanel() {
  const ts = useApp((s) => s.toolState);
  const doc = useApp((s) => s.doc);
  const t = refs.viewer?.tool as BooleanTool | undefined;
  const name = (id: string | null) => doc.bodies.find((b) => b.id === id)?.name ?? '—';
  const tools = (ts.tools as string[]) ?? [];
  return (
    <div className="panel-section" data-testid="boolean-panel">
      <h3>Operacja logiczna</h3>
      <div className="seg">
        {OPS.map(([k, l]) => (
          <button key={k} className={ts.op === k ? 'on' : ''} data-testid={`op-${k}`} onClick={() => useApp.getState().setToolState({ op: k })}>
            {l}
          </button>
        ))}
      </div>
      <div className="info">
        Bryła główna: <b style={{ color: '#1f6fff' }}>{name(ts.target as string | null)}</b>
      </div>
      <div className="info">
        {ts.op === 'subtract' ? 'Odejmowane' : 'Narzędzia'}: <b style={{ color: '#e06a00' }}>{tools.length ? tools.map(name).join(', ') : '—'}</b>
      </div>
      <div className="muted">
        {ts.op === 'union' && 'Suma łączy bryły w jedną.'}
        {ts.op === 'subtract' && 'Różnica wycina narzędzia z bryły głównej.'}
        {ts.op === 'intersect' && 'Część wspólna zostawia tylko objętość wspólną.'} Bryły-narzędzia znikają (są zużywane przez operację).
      </div>
      <OkCancel okTestId="boolean-ok" onOk={() => t?.apply()} onCancel={() => useApp.getState().setTool('select')} />
    </div>
  );
}

function FilletPanel({ kind }: { kind: 'fillet' | 'chamfer' }) {
  const info = useApp((s) => s.toolState.fillet as { count: number; featureId?: string; radius?: number; preview?: boolean } | undefined);
  const error = useApp((s) => (info?.featureId && info.preview ? s.build?.errors[info.featureId] : undefined));
  const t = refs.viewer?.tool as FilletTool | undefined;
  const label = kind === 'fillet' ? 'Zaokrąglenie' : 'Fazowanie';
  return (
    <div className="panel-section" data-testid="fillet-panel">
      <h3>{label} krawędzi</h3>
      <NumberField
        label={kind === 'fillet' ? 'Promień' : 'Odległość fazy'}
        testId="fillet-r"
        value={info?.radius ?? (kind === 'fillet' ? 2 : 1)}
        min={0.01}
        onChange={(v) => t?.setRadius(v)}
      />
      <div className="info" data-testid="fillet-count">
        {info?.count === -1 ? 'Wszystkie krawędzie bryły' : `Zaznaczone krawędzie: ${info?.count ?? 0}`}
      </div>
      <button data-testid="fillet-all" onClick={() => t?.allEdges()}>
        Wszystkie krawędzie bryły
      </button>
      <label className="check">
        <input type="checkbox" data-testid="fillet-preview" disabled={!info?.featureId} checked={!!info?.preview} onChange={(e) => t?.setPreview(e.target.checked)} /> Podgląd wyniku
      </label>
      {error && <div className="error-box">⚠ {error}</div>}
      <div className="muted">Klik w krawędź – zaznacz/odznacz. Klik w narożnik – wszystkie krawędzie wychodzące z narożnika (zaokrąglony róg).</div>
      <OkCancel
        okTestId="fillet-ok"
        onOk={() => (info?.featureId ? t?.confirm() : useApp.getState().notify('Najpierw zaznacz krawędzie', 'error'))}
        onCancel={() => {
          t?.cancel();
          useApp.getState().setTool('select');
        }}
      />
    </div>
  );
}

function MeasurePanel() {
  const m = useApp((s) => s.toolState.measure as { a: Vec3; b?: Vec3; d?: number; dx?: number; dy?: number; dz?: number } | null | undefined);
  return (
    <div className="panel-section" data-testid="measure-panel">
      <h3>Pomiar odległości</h3>
      {!m && <div className="muted">Kliknij pierwszy punkt.</div>}
      {m && m.d === undefined && <div className="muted">Punkt 1: ({m.a.map((x) => fmt(x)).join('; ')}). Kliknij drugi punkt.</div>}
      {m && m.d !== undefined && (
        <>
          <div className="measure-result" data-testid="measure-result">
            {fmt(m.d)} mm
          </div>
          <div className="grid3">
            <div className="info">ΔX {fmt(m.dx!)}</div>
            <div className="info">ΔY {fmt(m.dy!)}</div>
            <div className="info">ΔZ {fmt(m.dz!)}</div>
          </div>
        </>
      )}
    </div>
  );
}

export const toolPanels: Partial<Record<ToolId, () => React.ReactNode>> = {
  hole: () => <HolePanel />,
  boolean: () => <BooleanPanel />,
  fillet: () => <FilletPanel kind="fillet" />,
  chamfer: () => <FilletPanel kind="chamfer" />,
  measure: () => <MeasurePanel />,
};
