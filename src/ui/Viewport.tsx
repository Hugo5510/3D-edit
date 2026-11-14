import { useEffect, useRef } from 'react';
import { Viewer, type Tool } from '../viewer/Viewer';
import { ViewCube } from '../viewer/ViewCube';
import { SketchLayer } from '../viewer/SketchLayer';
import { useApp, type ToolId } from '../state/store';
import { SelectTool } from '../viewer/tools/SelectTool';
import { toolFactories } from '../viewer/tools/registry';

export let viewerInstance: Viewer | null = null;
export let sketchLayerInstance: SketchLayer | null = null;

export function Viewport() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current!;
    const viewer = new Viewer(el);
    viewerInstance = viewer;
    const cube = new ViewCube(el, viewer);
    const sketchLayer = new SketchLayer();
    sketchLayerInstance = sketchLayer;
    viewer.scene.add(sketchLayer.group, sketchLayer.preview);
    (window as unknown as { __viewer: Viewer }).__viewer = viewer;

    const tools = new Map<ToolId, Tool>();
    const getTool = (id: ToolId): Tool => {
      let t = tools.get(id);
      if (!t) {
        const f = toolFactories[id];
        t = f ? f(viewer, sketchLayer) : new SelectTool(viewer);
        tools.set(id, t);
      }
      return t;
    };

    let lastTool: ToolId | null = null;
    const sync = () => {
      const st = useApp.getState();
      const hidden = new Set<string>();
      viewer.syncBodies(st.bodies, st.doc.bodies, hidden);
      if (st.doc.printer) {
        viewer.setPrinter(st.doc.printer, outOfBed(st));
      }
      sketchLayer.sync(st.doc.sketches, st.selection, st.activeSketchId);
      if (st.tool !== lastTool) {
        lastTool = st.tool;
        viewer.setTool(getTool(st.tool));
      }
      viewer.tool?.refresh?.();
      viewer.requestRender();
      cube.render();
    };
    let prevPrinter = useApp.getState().doc.printer;
    const unsub = useApp.subscribe((s, p) => {
      if (s.bodies !== p.bodies || s.doc !== p.doc || s.selection !== p.selection || s.tool !== p.tool || s.activeSketchId !== p.activeSketchId || s.toolState !== p.toolState) {
        if (s.doc.printer !== prevPrinter) {
          prevPrinter = s.doc.printer;
        }
        sync();
      }
    });
    sync();
    let fitted = false;
    const unsubFit = useApp.subscribe((s) => {
      if (!fitted && s.kernelReady) {
        fitted = true;
        if (Object.keys(s.bodies).length) viewer.fitAll();
      }
    });
    return () => {
      unsub();
      unsubFit();
      viewer.dispose();
      cube.renderer.dispose();
      el.innerHTML = '';
    };
  }, []);

  return <div className="viewport" ref={host} data-testid="viewport" />;
}

export function outOfBed(st: ReturnType<typeof useApp.getState>): boolean {
  return bedProblems(st).length > 0;
}

export function bedProblems(st: ReturnType<typeof useApp.getState>): string[] {
  const p = st.doc.printer;
  const out: string[] = [];
  const tol = 0.01;
  for (const meta of st.doc.bodies) {
    const b = st.bodies[meta.id];
    if (!b || !meta.visible) continue;
    const { min, max } = b.bbox;
    const sx = max[0] - min[0], sy = max[1] - min[1], sz = max[2] - min[2];
    if (sx > p.x + tol || sy > p.y + tol || sz > p.z + tol) out.push(`${meta.name} jest większa niż obszar roboczy`);
    else if (min[0] < -p.x / 2 - tol || max[0] > p.x / 2 + tol || min[1] < -p.y / 2 - tol || max[1] > p.y / 2 + tol || max[2] > p.z + tol)
      out.push(`${meta.name} wystaje poza obszar roboczy`);
    else if (min[2] < -tol) out.push(`${meta.name} jest poniżej stołu`);
  }
  return out;
}
