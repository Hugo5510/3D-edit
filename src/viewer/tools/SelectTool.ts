import * as THREE from 'three';
import type { PointerInfo, Tool, Viewer } from '../Viewer';
import { Gizmo } from '../Gizmo';
import { useApp } from '../../state/store';
import { transformBody } from '../../state/actions';
import { pickSketch } from './sketchPick';
import { SketchPointDragger } from './SketchTools';
import type { SketchLayer } from '../SketchLayer';

/** Narzędzie zaznaczania: klik zaznacza bryłę (lub element szkicu), manipulator przesuwa i obraca. */
export class SelectTool implements Tool {
  private gizmo: Gizmo;
  private viewer!: Viewer;
  private previewBody: string | null = null;

  private dragger: SketchPointDragger | null = null;
  private draggingPoint = false;

  constructor(viewer: Viewer, layer?: SketchLayer) {
    this.viewer = viewer;
    if (layer) this.dragger = new SketchPointDragger(viewer, layer);
    this.gizmo = new Gizmo(viewer, {
      preview: (m, label, info) => {
        const id = this.previewBody;
        const v = id ? viewer.bodies.get(id) : null;
        if (v) {
          v.group.matrixAutoUpdate = false;
          v.group.matrix.copy(m);
          v.group.matrixWorldNeedsUpdate = true;
        }
        viewer.hiOverlay.matrixAutoUpdate = false;
        viewer.hiOverlay.matrix.copy(m);
        viewer.hiOverlay.matrixWorldNeedsUpdate = true;
        this.gizmo.group.position.copy(this.gizmo.center.clone().applyMatrix4(m));
        useApp.getState().setDragInfo({ text: label, x: info.x, y: info.y });
      },
      commit: (m) => {
        const id = this.previewBody;
        if (!id) return;
        const st = useApp.getState();
        st.commit(transformBody(st.doc, id, m.elements.slice(), true));
      },
      snapMove: () => {
        const s = useApp.getState().settings;
        return s.gridSnap ? s.gridStep : null;
      },
      snapAngle: (free) => {
        const s = useApp.getState().settings;
        return s.gridSnap && !free ? 5 : null;
      },
    });
  }

  activate(v: Viewer) {
    this.viewer = v;
    this.refresh();
  }

  deactivate() {
    this.gizmo.group.removeFromParent();
  }

  refresh() {
    const st = useApp.getState();
    const sel = st.selection;
    const id = sel && sel.kind === 'body' ? sel.bodyId : null;
    const res = id ? st.bodies[id] : null;
    if (res && !this.gizmo.dragging) {
      const bb = res.bbox;
      this.gizmo.setCenter(new THREE.Vector3((bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2));
      if (!this.gizmo.group.parent) this.viewer.overlay.add(this.gizmo.group);
    } else if (!res) {
      this.gizmo.group.removeFromParent();
    }
    this.viewer.setHighlight(
      id && res
        ? { edges: res.edges.map((_, i) => ({ bodyId: id, edge: i, color: 0xff9a00 })) }
        : {},
    );
    this.viewer.requestRender();
  }

  frame() {
    if (this.gizmo.group.parent) this.gizmo.updateScale();
  }

  pointerDown(e: PointerInfo): boolean {
    const st = useApp.getState();
    if (st.activeSketchId && this.dragger?.pointerDown(e)) {
      this.draggingPoint = true;
      return true;
    }
    const sel = st.selection;
    if (sel?.kind === 'body' && this.gizmo.begin(e)) {
      this.previewBody = sel.bodyId;
      return true;
    }
    return false;
  }

  drag(e: PointerInfo) {
    if (this.draggingPoint) this.dragger?.drag(e);
    else this.gizmo.move(e);
  }

  pointerUp() {
    if (this.draggingPoint) {
      this.draggingPoint = false;
      this.dragger?.pointerUp();
      return;
    }
    const id = this.previewBody;
    this.gizmo.end();
    useApp.getState().setDragInfo(null);
    this.viewer.hiOverlay.matrix.identity();
    this.viewer.hiOverlay.matrixAutoUpdate = true;
    const v = id ? this.viewer.bodies.get(id) : null;
    if (v) {
      // podgląd zostaje do czasu przebudowy (nowa geometria zastąpi widok)
      setTimeout(() => {
        const cur = this.viewer.bodies.get(id!);
        if (cur === v) {
          v.group.matrixAutoUpdate = true;
          v.group.matrix.identity();
          v.group.position.set(0, 0, 0);
          v.group.updateMatrix();
          this.viewer.requestRender();
        }
      }, 1500);
    }
    this.previewBody = null;
  }

  hover(e: PointerInfo) {
    if (useApp.getState().selection?.kind === 'body') this.gizmo.hover(e);
  }

  click(e: PointerInfo) {
    const st = useApp.getState();
    const sk = pickSketch(this.viewer, e);
    const hit = this.viewer.pickBody(e);
    if (sk && (!hit || sk.depth <= hit.distance + 1)) {
      st.setSelection(sk.selection);
      return;
    }
    if (hit) {
      st.setSelection({ kind: 'body', bodyId: hit.bodyId });
    } else st.setSelection(null);
  }
}
