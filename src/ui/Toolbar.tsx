import { useState } from 'react';
import { useApp, type ToolId } from '../state/store';
import { addPrimitive, PRIMITIVE_NAMES } from '../state/actions';
import type { PrimitiveKind } from '../model/types';
import { Icon } from './icons';
import { viewerInstance } from './Viewport';

export interface ToolDef {
  id: ToolId;
  label: string;
  icon: string;
  key?: string;
  title: string;
}

export const MODEL_TOOLS: ToolDef[] = [
  { id: 'select', label: 'Zaznacz', icon: 'select', key: 'Esc', title: 'Zaznaczanie i manipulator (Esc)' },
  { id: 'sketchPlane', label: 'Szkic', icon: 'sketch', key: 'S', title: 'Nowy szkic na płaszczyźnie lub płaskiej ścianie (S)' },
  { id: 'extrude', label: 'Wyciągnij', icon: 'extrude', key: 'E', title: 'Wyciągnięcie konturu lub ściany – dodaj materiał / wytnij (E)' },
  { id: 'hole', label: 'Otwór', icon: 'hole', key: 'H', title: 'Otwór: ściana, średnica, głębokość lub na wylot, odległości od krawędzi (H)' },
  { id: 'fillet', label: 'Zaokrąglij', icon: 'fillet', key: 'O', title: 'Zaokrąglenie krawędzi i narożników (O)' },
  { id: 'chamfer', label: 'Fazuj', icon: 'chamfer', key: 'K', title: 'Fazowanie krawędzi i narożników (K)' },
];

export const BOOL_TOOLS: { op: 'union' | 'subtract' | 'intersect'; label: string; icon: string; title: string }[] = [
  { op: 'union', label: 'Suma', icon: 'union', title: 'Suma brył (U)' },
  { op: 'subtract', label: 'Różnica', icon: 'subtract', title: 'Różnica brył – wycięcie jednej bryły z drugiej' },
  { op: 'intersect', label: 'Wspólna', icon: 'intersect', title: 'Część wspólna brył' },
];

export const EDIT_TOOLS: ToolDef[] = [
  { id: 'erase', label: 'Gumka', icon: 'erase', key: 'X', title: 'Gumka: usuwa odcinek szkicu, kontur lub bryłę (X)' },
  { id: 'measure', label: 'Pomiar', icon: 'measure', key: 'M', title: 'Pomiar odległości między dwoma punktami (M)' },
];

export function freeSpot(): [number, number, number] {
  const st = useApp.getState();
  let maxX = -Infinity;
  let any = false;
  for (const b of Object.values(st.bodies)) {
    any = true;
    maxX = Math.max(maxX, b.bbox.max[0]);
  }
  if (!any) return [0, 0, 0];
  return [Math.round(maxX + 25), 0, 0];
}

export function Toolbar() {
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);
  const [primOpen, setPrimOpen] = useState(false);
  const opState = useApp((s) => s.toolState.op);

  const addPrim = (kind: PrimitiveKind) => {
    const st = useApp.getState();
    const { doc, bodyId } = addPrimitive(st.doc, kind, freeSpot());
    st.commit(doc);
    st.setTool('select');
    st.setSelection({ kind: 'body', bodyId });
    setPrimOpen(false);
    st.notify(`Dodano: ${PRIMITIVE_NAMES[kind]}. Wymiary zmienisz w panelu po prawej.`, 'ok');
  };

  return (
    <nav className="toolbar" data-testid="toolbar">
      {MODEL_TOOLS.map((t) => (
        <button key={t.id} className={'tool' + (tool === t.id ? ' on' : '')} title={t.title} data-testid={`tool-${t.id}`} onClick={() => setTool(t.id)}>
          <Icon name={t.icon} />
          <span>{t.label}</span>
        </button>
      ))}
      <div className="tool-group">
        <button className={'tool' + (primOpen ? ' on' : '')} title="Bryły gotowe" data-testid="tool-primitives" onClick={() => setPrimOpen(!primOpen)}>
          <Icon name="box" />
          <span>Bryły</span>
        </button>
        {primOpen && (
          <div className="popup" data-testid="primitives-menu">
            {(Object.keys(PRIMITIVE_NAMES) as PrimitiveKind[]).map((k) => (
              <button key={k} data-testid={`add-${k}`} onClick={() => addPrim(k)}>
                <Icon name={k} /> {PRIMITIVE_NAMES[k]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="sep" />
      {BOOL_TOOLS.map((b) => (
        <button
          key={b.op}
          className={'tool' + (tool === 'boolean' && opState === b.op ? ' on' : '')}
          title={b.title}
          data-testid={`tool-${b.op}`}
          onClick={() => setTool('boolean', { op: b.op })}
        >
          <Icon name={b.icon} />
          <span>{b.label}</span>
        </button>
      ))}
      <div className="sep" />
      {EDIT_TOOLS.map((t) => (
        <button key={t.id} className={'tool' + (tool === t.id ? ' on' : '')} title={t.title} data-testid={`tool-${t.id}`} onClick={() => setTool(t.id)}>
          <Icon name={t.icon} />
          <span>{t.label}</span>
        </button>
      ))}
      <div className="sep" />
      <button className="tool" title="Dopasuj widok (F)" data-testid="fit-view" onClick={() => viewerInstance?.fitAll()}>
        <Icon name="fit" />
        <span>Widok</span>
      </button>
    </nav>
  );
}
