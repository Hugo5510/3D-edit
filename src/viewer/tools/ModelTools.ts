// Narzędzia 3D: wybór płaszczyzny szkicu, wyciągnięcie (ze strzałką), gumka.
import * as THREE from 'three';
import type { PointerInfo, Tool, Viewer } from '../Viewer';
import { useApp } from '../../state/store';
import { clone, newBodyMeta, newSketch, removeFeature, updateSketch, deleteBody } from '../../state/actions';
import type { ExtrudeFeature, ExtrudeMode, ExtrudeSource, Plane, Sketch, Vec3 } from '../../model/types';
import { anyPerp, uid, v3 } from '../../model/math';
import { loopPolygon, orderLoop, polygonArea, toWorld } from '../../model/sketchGeom';
import { removeEntity } from '../../model/sketchOps';
import { pickSketch } from './sketchPick';
import { viewFromPlane } from './sketchMode';

// ------------------------------------------------------------ płaszczyzna szkicu

export function planeFromFace(normal: Vec3, centroid: Vec3, xHint: Vec3 | null): Plane {
  const n = v3.norm(normal);
  let x: Vec3;
  if (Math.abs(n[2]) < 0.9) x = v3.norm(v3.cross([0, 0, 1], n));
  else x = xHint && Math.abs(v3.dot(xHint, n)) < 1e-6 ? v3.norm(xHint) : [1, 0, 0];
  if (v3.len(x) < 0.5) x = anyPerp(n);
  // początek: rzut początku układu świata na płaszczyznę (siatka szkicu zgodna z siatką globalną)
  const o = v3.scale(n, v3.dot(n, centroid));
  return { origin: o, normal: n, xDir: x };
}

export const BASE_PLANES: { name: string; plane: Plane }[] = [
  { name: 'XY (góra)', plane: { origin: [0, 0, 0], normal: [0, 0, 1], xDir: [1, 0, 0] } },
  { name: 'XZ (przód)', plane: { origin: [0, 0, 0], normal: [0, -1, 0], xDir: [1, 0, 0] } },
  { name: 'YZ (prawo)', plane: { origin: [0, 0, 0], normal: [1, 0, 0], xDir: [0, 1, 0] } },
];

export function startSketch(plane: Plane, name?: string) {
  const st = useApp.getState();
  const { doc, sketchId } = newSketch(st.doc, plane, name);
  st.commit(doc);
  st.setActiveSketch(sketchId);
  st.setSelection(null);
  st.setTool('line');
  viewFromPlane(plane);
}

export class SketchPlaneTool implements Tool {
  constructor(private viewer: Viewer) {}
  activate() {
    useApp.getState().setToolState({ hint: 'Wybierz płaszczyznę bazową w panelu albo kliknij płaską ścianę bryły.' });
  }
  deactivate() {
    this.viewer.setHighlight({});
  }
  hover(e: PointerInfo) {
    const h = this.viewer.pickBody(e);
    const f = h ? this.viewer.bodies.get(h.bodyId)?.data.faces[h.face] : null;
    this.viewer.setHighlight(h && f?.normal ? { faces: [{ bodyId: h.bodyId, face: h.face, color: 0x00a0ff }] } : {});
  }
  click(e: PointerInfo) {
    const h = this.viewer.pickBody(e);
    if (!h) return;
    const f = this.viewer.bodies.get(h.bodyId)?.data.faces[h.face];
    if (!f?.normal) {
      useApp.getState().notify('Szkic można utworzyć tylko na płaskiej ścianie', 'error');
      return;
    }
    const meta = useApp.getState().doc.bodies.find((b) => b.id === h.bodyId);
    startSketch(planeFromFace(f.normal, f.centroid, f.xDir), `Szkic na ${meta?.name ?? 'ścianie'}`);
  }
}

// ------------------------------------------------------------------- wyciągnięcie

export interface ExtrudeState {
  featureId: string;
  source: ExtrudeSource;
  base: Vec3;
  normal: Vec3;
  newBodyId: string;
}

function profileInfo(sk: Sketch, profileId: string): { base: Vec3; area: number; corners: Vec3[] } | null {
  const pr = sk.profiles.find((p) => p.id === profileId);
  if (!pr) return null;
  try {
    const poly = loopPolygon(orderLoop(sk, pr.loops[0]));
    let cx = 0, cy = 0, a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const cr = p[0] * q[1] - q[0] * p[1];
      a += cr;
      cx += (p[0] + q[0]) * cr;
      cy += (p[1] + q[1]) * cr;
    }
    a /= 2;
    const c: [number, number] = Math.abs(a) > 1e-12 ? [cx / (6 * a), cy / (6 * a)] : poly[0];
    return { base: toWorld(sk.plane, c), area: Math.abs(polygonArea(poly)), corners: poly.map((p) => toWorld(sk.plane, p)) };
  } catch {
    return null;
  }
}

export class ExtrudeTool implements Tool {
  private st: ExtrudeState | null = null;
  private arrow = new THREE.Group();
  private hit: THREE.Mesh;
  private dragStart: { param: number; dist: number } | null = null;

  constructor(private viewer: Viewer) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff7a00, depthTest: false, transparent: true });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), mat);
    shaft.position.y = 0.35;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 16), mat);
    head.position.y = 0.85;
    this.hit = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.position.y = 0.55;
    this.arrow.add(shaft, head, this.hit);
    this.arrow.traverse((o) => (o.renderOrder = 12));
  }

  activate() {
    const s = useApp.getState();
    const sel = s.selection;
    this.st = null;
    if (sel?.kind === 'profile') this.begin({ kind: 'profile', sketchId: sel.sketchId, profileId: sel.profileId });
    else if (sel?.kind === 'face') this.beginFace(sel.bodyId, sel.face);
    else s.setToolState({ hint: 'Kliknij wypełniony kontur szkicu albo płaską ścianę bryły.' });
  }

  deactivate() {
    if (this.st) this.cancel();
    this.arrow.removeFromParent();
    this.viewer.setHighlight({});
  }

  private beginFace(bodyId: string, face: number) {
    const f = this.viewer.bodies.get(bodyId)?.data.faces[face];
    if (!f?.normal) {
      useApp.getState().notify('Wyciągać można tylko płaskie ściany', 'error');
      return;
    }
    this.begin({ kind: 'face', bodyId, face: { centroid: f.centroid, normal: f.normal, kind: f.kind } });
  }

  begin(source: ExtrudeSource) {
    const s = useApp.getState();
    let base: Vec3, normal: Vec3, mode: ExtrudeMode, target: string | null;
    if (source.kind === 'profile') {
      const sk = s.doc.sketches.find((x) => x.id === source.sketchId);
      const info = sk ? profileInfo(sk, source.profileId) : null;
      if (!sk || !info) return;
      base = info.base;
      normal = v3.norm(sk.plane.normal);
      target = this.intersectingBody(info.corners, normal, 10);
      mode = target ? 'join' : 'new';
    } else {
      base = source.face.centroid;
      normal = source.face.normal!;
      target = source.bodyId;
      mode = 'join';
    }
    s.beginGesture();
    const newBody = newBodyMeta(s.doc, 'Wyciągnięcie');
    const f: ExtrudeFeature = { id: uid('f'), type: 'extrude', bodyId: mode === 'new' ? newBody.id : target!, source, distance: 10, mode };
    const d = clone(s.doc);
    if (mode === 'new') d.bodies.push(newBody);
    d.features.push(f);
    s.live(d);
    this.st = { featureId: f.id, source, base, normal, newBodyId: newBody.id };
    newBodyMetas.set(newBody.id, newBody);
    s.setToolState({ extrude: { ...this.st }, target, hint: 'Przeciągnij strzałkę albo wpisz wysokość. Zatwierdź Enterem lub przyciskiem „OK”.' });
    s.setSelection(null);
    this.viewer.overlay.add(this.arrow);
    this.refresh();
  }

  private intersectingBody(corners: Vec3[], n: Vec3, d: number): string | null {
    const s = useApp.getState();
    const pts = [...corners, ...corners.map((c) => v3.add(c, v3.scale(n, d)))];
    const min = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i])));
    const max = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])));
    for (const meta of s.doc.bodies) {
      const b = s.bodies[meta.id];
      if (!b || !meta.visible) continue;
      if ([0, 1, 2].every((i) => b.bbox.min[i] <= max[i] + 1e-6 && b.bbox.max[i] >= min[i] - 1e-6)) return meta.id;
    }
    return null;
  }

  feature(): ExtrudeFeature | null {
    if (!this.st) return null;
    return (useApp.getState().doc.features.find((f) => f.id === this.st!.featureId) as ExtrudeFeature) ?? null;
  }

  update(patch: Partial<Pick<ExtrudeFeature, 'distance' | 'mode' | 'symmetric'>> & { target?: string | null }) {
    const s = useApp.getState();
    const st = this.st;
    if (!st) return;
    const d = clone(s.doc);
    const f = d.features.find((x) => x.id === st.featureId) as ExtrudeFeature | undefined;
    if (!f) return;
    if (patch.distance !== undefined) f.distance = patch.distance;
    if (patch.symmetric !== undefined) f.symmetric = patch.symmetric;
    let target = (s.toolState.target as string | null) ?? null;
    if (patch.target !== undefined) target = patch.target;
    if (patch.mode !== undefined) {
      // przy wycinaniu kierunek domyślnie w głąb bryły
      if (patch.mode === 'cut' && f.mode !== 'cut' && f.distance > 0 && patch.distance === undefined) {
        const tb = s.bodies[target ?? (f.source.kind === 'face' ? f.source.bodyId : '')];
        if (f.source.kind === 'face') f.distance = -f.distance;
        else if (tb) {
          const c: Vec3 = [0, 1, 2].map((i) => (tb.bbox.min[i] + tb.bbox.max[i]) / 2) as Vec3;
          if (v3.dot(v3.sub(c, st.base), st.normal) < 0) f.distance = -f.distance;
        }
      }
      f.mode = patch.mode;
    }
    if (f.mode === 'new') {
      f.bodyId = st.newBodyId;
      if (!d.bodies.some((b) => b.id === st.newBodyId)) d.bodies.push(newBodyMetas.get(st.newBodyId)!);
    } else {
      if (!target) {
        const first = d.bodies.find((b) => s.bodies[b.id] && b.id !== st.newBodyId);
        target = first?.id ?? null;
      }
      if (!target) {
        s.notify('Brak bryły, do której można dodać materiał lub z której można wyciąć', 'error');
        return;
      }
      f.bodyId = target;
      d.bodies = d.bodies.filter((b) => b.id !== st.newBodyId);
    }
    s.live(d);
    s.setToolState({ target });
    this.refresh();
  }

  confirm() {
    const s = useApp.getState();
    const f = this.feature();
    if (f?.source.kind === 'profile') {
      // szkic użyty do wyciągnięcia zostaje ukryty (jak w programach CAD); można go pokazać w drzewie
      const src = f.source;
      s.live(updateSketch(s.doc, src.sketchId, (sk) => (sk.visible = false)));
    }
    s.endGesture();
    this.st = null;
    this.arrow.removeFromParent();
    s.setToolState({ extrude: null });
    if (f) s.setSelection({ kind: 'body', bodyId: f.bodyId });
    s.setTool('select');
  }

  cancel() {
    const s = useApp.getState();
    const start = s.gestureStart;
    if (start) useApp.setState({ doc: start, gestureStart: null });
    this.st = null;
    this.arrow.removeFromParent();
    s.setToolState({ extrude: null });
  }

  refresh() {
    const f = this.feature();
    if (!this.st || !f) return;
    const { base, normal } = this.st;
    const tip = v3.add(base, v3.scale(normal, f.symmetric ? f.distance / 2 : f.distance));
    this.arrow.position.set(...tip);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...normal).multiplyScalar(Math.sign(f.distance) || 1));
    this.arrow.quaternion.copy(q);
    this.frame();
    this.viewer.requestRender();
  }

  frame() {
    if (this.arrow.parent) {
      this.arrow.scale.setScalar(this.viewer.worldPerPixel(this.arrow.position) * 80);
      this.arrow.updateMatrixWorld(true);
    }
  }

  private axisParam(e: PointerInfo): number {
    const st = this.st!;
    const a = new THREE.Vector3(...st.normal);
    const c = new THREE.Vector3(...st.base);
    const o = e.ray.origin, dv = e.ray.direction;
    const w0 = o.clone().sub(c);
    const A = dv.dot(dv), B = dv.dot(a), C = a.dot(a), D = dv.dot(w0), E = a.dot(w0);
    const den = A * C - B * B;
    return Math.abs(den) < 1e-9 ? 0 : (A * E - B * D) / den;
  }

  pointerDown(e: PointerInfo): boolean {
    if (!this.st || !this.arrow.parent) return false;
    this.frame();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(e.ndc, this.viewer.camera);
    if (!rc.intersectObject(this.hit, false).length) return false;
    this.dragStart = { param: this.axisParam(e), dist: this.feature()?.distance ?? 10 };
    return true;
  }

  drag(e: PointerInfo) {
    if (!this.dragStart) return;
    const f = this.feature();
    let d = this.dragStart.dist + (this.axisParam(e) - this.dragStart.param) * (f?.symmetric ? 2 : 1);
    const st = useApp.getState().settings;
    if (st.gridSnap) d = Math.round(d / st.gridStep) * st.gridStep;
    if (Math.abs(d) < 1e-6) d = st.gridSnap ? st.gridStep : 0.01;
    this.update({ distance: d });
    useApp.getState().setDragInfo({ text: `Wysokość: ${d.toFixed(2).replace('.', ',')} mm`, x: e.x, y: e.y });
  }

  pointerUp() {
    this.dragStart = null;
    useApp.getState().setDragInfo(null);
  }

  hover(e: PointerInfo) {
    if (this.st) return;
    const sk = pickSketch(this.viewer, e, true);
    if (sk) {
      useApp.getState().setSelection(sk.selection);
      this.viewer.setHighlight({});
      return;
    }
    const h = this.viewer.pickBody(e);
    const f = h ? this.viewer.bodies.get(h.bodyId)?.data.faces[h.face] : null;
    this.viewer.setHighlight(h && f?.normal ? { faces: [{ bodyId: h.bodyId, face: h.face, color: 0xff9a00 }] } : {});
  }

  click(e: PointerInfo) {
    if (this.st) return;
    const sk = pickSketch(this.viewer, e, true);
    if (sk && sk.kind === 'profile') {
      this.begin({ kind: 'profile', sketchId: sk.sketchId, profileId: sk.id });
      return;
    }
    const h = this.viewer.pickBody(e);
    if (h) this.beginFace(h.bodyId, h.face);
  }

  key(e: KeyboardEvent): boolean {
    if (!this.st) return false;
    if (e.key === 'Enter') {
      this.confirm();
      return true;
    }
    if (e.key === 'Escape') {
      this.cancel();
      useApp.getState().setTool('select');
      return true;
    }
    return false;
  }
}

const newBodyMetas = new Map<string, ReturnType<typeof newBodyMeta>>();

// -------------------------------------------------------------------------- gumka

export class EraseTool implements Tool {
  constructor(private viewer: Viewer) {}
  activate() {
    useApp.getState().setToolState({ hint: 'Kliknij odcinek szkicu, wypełniony kontur albo bryłę, aby je usunąć.' });
  }
  deactivate() {
    this.viewer.setHighlight({});
    useApp.getState().setSelection(null);
  }
  hover(e: PointerInfo) {
    const st = useApp.getState();
    const sk = pickSketch(this.viewer, e);
    const hit = this.viewer.pickBody(e);
    if (sk && (!hit || sk.depth <= hit.distance + 1) && sk.kind !== 'point') {
      st.setSelection(sk.selection);
      this.viewer.setHighlight({});
    } else if (hit) {
      if (st.selection) st.setSelection(null);
      const v = this.viewer.bodies.get(hit.bodyId)!;
      this.viewer.setHighlight({ edges: v.data.edges.map((_, i) => ({ bodyId: hit.bodyId, edge: i, color: 0xe02020 })) });
    } else {
      if (st.selection) st.setSelection(null);
      this.viewer.setHighlight({});
    }
  }
  click(e: PointerInfo) {
    const st = useApp.getState();
    const sk = pickSketch(this.viewer, e);
    const hit = this.viewer.pickBody(e);
    if (sk && (!hit || sk.depth <= hit.distance + 1) && sk.kind !== 'point') {
      if (sk.kind === 'profile') {
        const used = st.doc.features.some((f) => f.type === 'extrude' && f.source.kind === 'profile' && f.source.profileId === sk.id);
        st.commit(updateSketch(st.doc, sk.sketchId, (s) => (s.profiles = s.profiles.filter((p) => p.id !== sk.id))));
        st.notify(used ? 'Usunięto wypełnienie (operacja wyciągnięcia, która go używała, zgłosi błąd)' : 'Usunięto wypełnienie', 'ok');
      } else {
        st.commit(updateSketch(st.doc, sk.sketchId, (s) => removeEntity(s, sk.id)));
        st.notify('Usunięto element szkicu', 'ok');
      }
      st.setSelection(null);
      return;
    }
    if (hit) {
      const name = st.doc.bodies.find((b) => b.id === hit.bodyId)?.name ?? 'bryła';
      st.commit(deleteBody(st.doc, hit.bodyId));
      this.viewer.setHighlight({});
      st.notify(`Usunięto: ${name}`, 'ok');
    }
  }
}

export { removeFeature };
