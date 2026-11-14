import { useApp } from '../state/store';
import { BodyPanel } from './BodyPanel';
import { FeaturePanel } from './FeaturePanel';
import { SketchSelectionPanel } from './SketchPanels';
import { ToolPanel } from './ToolPanel';

export function PropertiesPanel() {
  const selection = useApp((s) => s.selection);
  const tool = useApp((s) => s.tool);
  const doc = useApp((s) => s.doc);
  const toolPanel = <ToolPanel />;
  let content: React.ReactNode = null;
  if (selection?.kind === 'body' || selection?.kind === 'face' || selection?.kind === 'edges') {
    if (tool === 'select' && doc.bodies.some((b) => b.id === selection.bodyId)) content = <BodyPanel bodyId={selection.bodyId} />;
  } else if (selection?.kind === 'feature') {
    content = <FeaturePanel featureId={selection.featureId} />;
  } else if (selection?.kind === 'sketch' || selection?.kind === 'profile') {
    content = <SketchSelectionPanel />;
  }
  return (
    <div className="props" data-testid="properties">
      {toolPanel}
      {content}
      {!content && tool === 'select' && (
        <div className="muted hint">
          Kliknij bryłę, aby ją zaznaczyć i zobaczyć manipulator. Przeciągnij strzałkę, aby przesunąć, albo pierścień, aby obrócić. Wymiary wpiszesz w polach
          poniżej. Obrót widoku: lewy przycisk myszy / jeden palec; przesuw: prawy przycisk / dwa palce; zoom: kółko / szczypanie.
        </div>
      )}
    </div>
  );
}
