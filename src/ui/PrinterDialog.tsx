import { useApp } from '../state/store';
import { clone } from '../state/actions';
import { NumberField } from './NumberField';
import { Dialog } from './Dialog';

const PRESETS = [
  { name: 'Bambu Lab X1 / P1 / P2S (256 mm)', x: 256, y: 256, z: 256 },
  { name: 'Bambu Lab A1 (256 mm)', x: 256, y: 256, z: 256 },
  { name: 'Bambu Lab A1 mini (180 mm)', x: 180, y: 180, z: 180 },
  { name: 'Bambu Lab H2D (325 × 320 × 325 mm)', x: 325, y: 320, z: 325 },
  { name: 'Prusa MK4 (250 × 210 × 220 mm)', x: 250, y: 210, z: 220 },
];

export function PrinterDialog() {
  const printer = useApp((s) => s.doc.printer);
  const set = (patch: Partial<typeof printer>) => {
    const st = useApp.getState();
    const d = clone(st.doc);
    d.printer = { ...d.printer, ...patch };
    st.commit(d);
  };
  return (
    <Dialog title="Obszar roboczy drukarki" onClose={() => useApp.getState().setDialog(null)}>
      <p className="muted">Wymiary stołu i maksymalna wysokość wydruku. Gdy model się nie mieści, ramka obszaru zmienia kolor na czerwony i pojawia się ostrzeżenie.</p>
      <div className="grid3">
        <NumberField label="X" testId="printer-x" value={printer.x} min={10} onChange={(x) => set({ x, name: 'Własna' })} />
        <NumberField label="Y" testId="printer-y" value={printer.y} min={10} onChange={(y) => set({ y, name: 'Własna' })} />
        <NumberField label="Z" testId="printer-z" value={printer.z} min={10} onChange={(z) => set({ z, name: 'Własna' })} />
      </div>
      <div className="preset-list">
        {PRESETS.map((p) => (
          <button key={p.name} onClick={() => set(p)} className={printer.name === p.name ? 'on' : ''}>
            {p.name}
          </button>
        ))}
      </div>
      <p className="muted">Wymiary katalogowe – sprawdź je w dokumentacji swojej drukarki.</p>
    </Dialog>
  );
}
