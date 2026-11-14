// Narzędzia etapu 3: otwór, operacje logiczne, zaokrąglenie/fazowanie krawędzi, pomiar.
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { PointerInfo, Tool, Viewer } from '../Viewer';
import { rayPlane } from '../Viewer';
import { useApp } from '../../state/store';
import { clone } from '../../state/actions';
import type { BooleanFeature, BooleanOp, EdgeRef, FilletFeature, HoleFeature, Vec3 } from '../../model/types';
import type { EdgeInfo, FaceInfo } from '../../kernel/protocol';
import { fmt, uid, v3 } from '../../model/math';
import { makeLineMaterial } from '../BodyView';

/** Wspólny mechanizm „operacji na żywo”: cecha dopisywana bez historii, zatwierdzana przyciskiem OK. */
abstract class LiveFeatureTool implements Tool {
  protected featureId: string | null = null;
  constructor(protected viewer: Viewer) {}

  protected startLive(f: HoleFeature | FilletFeature | BooleanFeature) {
    const s = useApp.getState();
    if (!s.gestureStart) s.beginGesture();
    const d = clone(s.doc);
    d.features.push(f);
    s.live(d);
    this.featureId = f.id;
  }

  protected patch(fn: (f: never) => void) {
    const s = useApp.getState();
    if (!this.featureId) return;
    const d = clone(s.doc);
    const f = d.features.find((x) => x.id === this.featureId);
    if (!f) return;
    fn(f as never);
    s.live(d);
  }

  feature<T>(): T | null {
    if (!this.featureId) return null;
    return (useApp.getState().doc.features.find((f) => f.id === this.featureId) as T) ?? null;
  }

  confirm() {
    const s = useApp.getState();
    const f = this.feature<{ bodyId: string }>();
    s.endGesture();
    this.featureId = null;
    this.onEnd();
    if (f) s.setSelection({ kind: 'body', bodyId: f.bodyId });
    s.setTool('select');
  }

  cancel() {
    const s = useApp.getState();
    if (s.gestureStart) useApp.setState({ doc: s.gestureStart, gestureStart: null });
    this.featureId = null;
    this.onEnd();
  }

  protected onEnd() {}

  deactivate() {
    if (this.featureId) this.cancel();
    this.viewer.setHighlight({});
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Enter' && this.featureId) {
      this.confirm();
      return true;
    }
    if (e.key === 'Escape' && this.featureId) {
      this.cancel();
      useApp.getState().setTool('select');
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------- otwór

export interface HoleRefInfo {
  pairs: [number, number][];
  pairIndex: number;
}

function lineEdges(edges: EdgeInfo[], face: FaceInfo): number[] {
  return face.edges.filter((i) => edges[i]?.kind === 'line' && edges[i].length > 1e-6);
}

function inwardNormal(e: EdgeInfo, face: FaceInfo): Vec3 {
  const d = v3.norm(v3.sub(e.b, e.a));
  let m = v3.norm(v3.cross(face.normal!, d));
  if (v3.dot(v3.sub(face.centroid, e.a), m) < 0) m = v3.scale(m, -1);
  return m;
}

export class HoleTool extends LiveFeatureTool {
  private pairs: [number, number][] = [];
  private pairIndex = 0;
  private faceRef: { bodyId: string; face: number } | null = null;
  /** Kopia danych bryły sprzed otworu (po podglądzie numeracja krawędzi się zmienia). */
  private snap: { data: import('../../kernel/protocol').BodyResult } | null = null;
  private refLines = new THREE.Group();

  activate() {
    useApp.getState().setToolState({ hint: 'Kliknij płaską ścianę bryły w miejscu otworu. Położenie doprecyzujesz w panelu.' });
  }

  hover(e: PointerInfo) {
    if (this.featureId) return;
    const h = this.viewer.pickBody(e);
    const f = h ? this.viewer.bodies.get(h.bodyId)?.data.faces[h.face] : null;
    this.viewer.setHighlight(h && f?.normal ? { faces: [{ bodyId: h.bodyId, face: h.face, color: 0x00a0ff }] } : {});
  }

  click(e: PointerInfo) {
    if (this.featureId) return;
    const h = this.viewer.pickBody(e);
    if (!h) return;
    const view = this.viewer.bodies.get(h.bodyId)!;
    if (view.data.geometry === 'mesh') {
      useApp.getState().notify('Narzędzie „Otwór” działa na bryłach B-rep. W siatce zrób otwór walcem i operacją „Różnica”.', 'error');
      return;
    }
    const face = view.data.faces[h.face];
    if (!face?.normal) {
      useApp.getState().notify('Otwór można wykonać tylko w płaskiej ścianie', 'error');
      return;
    }
    const edges = view.data.edges;
    const le = lineEdges(edges, face);
    const p: Vec3 = [h.point.x, h.point.y, h.point.z];
    // pary nierównoległych krawędzi prostych, posortowane wg odległości od kliknięcia
    const pairs: { pair: [number, number]; d: number }[] = [];
    for (let i = 0; i < le.length; i++)
      for (let j = i + 1; j < le.length; j++) {
        const a = edges[le[i]], b = edges[le[j]];
        const da = v3.norm(v3.sub(a.b, a.a)), db = v3.norm(v3.sub(b.b, b.a));
        if (Math.abs(v3.dot(da, db)) > 0.999) continue;
        pairs.push({ pair: [le[i], le[j]], d: distToSeg(p, a) + distToSeg(p, b) });
      }
    pairs.sort((x, y) => x.d - y.d);
    this.pairs = pairs.map((x) => x.pair);
    this.pairIndex = 0;
    this.faceRef = { bodyId: h.bodyId, face: h.face };
    this.snap = { data: view.data };
    const f: HoleFeature = {
      id: uid('f'),
      type: 'hole',
      bodyId: h.bodyId,
      face: { centroid: face.centroid, normal: face.normal, kind: face.kind },
      edges: null,
      offsets: [0, 0],
      diameter: 5,
      depth: 10,
      through: true,
    };
    this.applyRefs(f, p);
    this.viewer.setHighlight({});
    this.startLive(f);
    this.publish();
  }

  private applyRefs(f: HoleFeature, p: Vec3) {
    const view = this.faceRef && this.snap;
    if (!view || !this.faceRef) return;
    const face = view.data.faces[this.faceRef.face];
    const edges = view.data.edges;
    const pair = this.pairs[this.pairIndex];
    if (pair) {
      const [a, b] = pair.map((i) => edges[i]);
      f.edges = [
        { mid: a.mid, dir: a.dir, kind: a.kind },
        { mid: b.mid, dir: b.dir, kind: b.kind },
      ];
      f.offsets = [round2(v3.dot(v3.sub(p, a.a), inwardNormal(a, face))), round2(v3.dot(v3.sub(p, b.a), inwardNormal(b, face)))];
    } else {
      const x = face.xDir ?? [1, 0, 0];
      const y = v3.norm(v3.cross(face.normal!, x));
      const d = v3.sub(p, face.centroid);
      f.edges = null;
      f.offsets = [round2(v3.dot(d, x)), round2(v3.dot(d, y))];
    }
  }

  /** Przełącza parę krawędzi odniesienia (zachowując położenie otworu). */
  nextPair() {
    const f = this.feature<HoleFeature>();
    if (!f || this.pairs.length < 2) return;
    const center = this.currentCenter(f);
    this.pairIndex = (this.pairIndex + 1) % this.pairs.length;
    this.patch((x: HoleFeature) => this.applyRefs(x, center));
    this.publish();
  }

  private currentCenter(f: HoleFeature): Vec3 {
    const view = this.faceRef && this.snap;
    const face = view?.data.faces[this.faceRef!.face];
    if (!view || !face) return [0, 0, 0];
    const pair = this.pairs[this.pairIndex];
    if (!pair || !f.edges) {
      const x = face.xDir ?? [1, 0, 0];
      const y = v3.norm(v3.cross(face.normal!, x));
      return v3.add(face.centroid, v3.add(v3.scale(x, f.offsets[0]), v3.scale(y, f.offsets[1])));
    }
    const [a, b] = pair.map((i) => view.data.edges[i]);
    const m1 = inwardNormal(a, face), m2 = inwardNormal(b, face);
    // rozwiązanie w płaszczyźnie: m1·c = off1 + m1·a.a, m2·c = off2 + m2·b.a, c = o + s*u + t*w
    const u = m1, w = v3.norm(v3.cross(face.normal!, u));
    const o = face.centroid;
    const r1 = f.offsets[0] + v3.dot(m1, v3.sub(a.a, o));
    const r2 = f.offsets[1] + v3.dot(m2, v3.sub(b.a, o));
    const A = [v3.dot(m1, u), v3.dot(m1, w), v3.dot(m2, u), v3.dot(m2, w)];
    const det = A[0] * A[3] - A[1] * A[2];
    const s = (r1 * A[3] - A[1] * r2) / det;
    const t = (A[0] * r2 - r1 * A[2]) / det;
    return v3.add(o, v3.add(v3.scale(u, s), v3.scale(w, t)));
  }

  update(patch: Partial<Pick<HoleFeature, 'diameter' | 'depth' | 'through'>> & { offset0?: number; offset1?: number }) {
    this.patch((f: HoleFeature) => {
      if (patch.diameter !== undefined) f.diameter = patch.diameter;
      if (patch.depth !== undefined) f.depth = patch.depth;
      if (patch.through !== undefined) f.through = patch.through;
      if (patch.offset0 !== undefined) f.offsets[0] = patch.offset0;
      if (patch.offset1 !== undefined) f.offsets[1] = patch.offset1;
    });
  }

  refresh() {
    this.publish();
  }

  private publish() {
    const view = this.faceRef && this.snap;
    if (!this.featureId || !view) return;
    const pair = this.pairs[this.pairIndex];
    this.refLines.clear();
    if (pair) {
      pair.forEach((ei, k) => {
        const e = view.data.edges[ei];
        const g = new LineSegmentsGeometry();
        g.setPositions(edgeSegmentsOf(view.data.edgePoints, e));
        const l = new LineSegments2(g, k === 0 ? refMatA : refMatB);
        l.renderOrder = 15;
        this.refLines.add(l);
      });
    }
    if (!this.refLines.parent) this.viewer.overlay.add(this.refLines);
    this.viewer.requestRender();
    const st = useApp.getState();
    const cur = st.toolState.hole as { pairs: number; byEdges: boolean } | undefined;
    const next = { pairs: this.pairs.length, byEdges: !!pair, featureId: this.featureId };
    if (!cur || cur.pairs !== next.pairs || cur.byEdges !== next.byEdges || (cur as { featureId?: string }).featureId !== next.featureId)
      st.setToolState({ hole: next, hint: 'Odległości mierzone od krawędzi zaznaczonych na czerwono (1) i zielono (2).' });
  }

  protected onEnd() {
    this.faceRef = null;
    this.snap = null;
    this.refLines.clear();
    this.refLines.removeFromParent();
    this.viewer.setHighlight({});
    useApp.getState().setToolState({ hole: null });
  }
}

const refMatA = makeLineMaterial(0xe53935, 4, false);
const refMatB = makeLineMaterial(0x2e9d3a, 4, false);
function edgeSegmentsOf(points: Float32Array, e: EdgeInfo): number[] {
  const out: number[] = [];
  for (let i = e.start; i + 3 < e.start + e.count; i += 3) out.push(points[i], points[i + 1], points[i + 2], points[i + 3], points[i + 4], points[i + 5]);
  return out;
}

function distToSeg(p: Vec3, e: EdgeInfo): number {
  const ab = v3.sub(e.b, e.a);
  const l2 = v3.dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, v3.dot(v3.sub(p, e.a), ab) / l2)) : 0;
  return v3.dist(p, v3.add(e.a, v3.scale(ab, t)));
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------- operacje logiczne

export class BooleanTool implements Tool {
  constructor(private viewer: Viewer) {}
  activate() {
    const s = useApp.getState();
    s.setSelection(null);
    s.setToolState({ op: s.toolState.op ?? 'union', target: null, tools: [], hint: 'Kliknij bryłę główną, a potem bryły-narzędzia. Zatwierdź przyciskiem OK.' });
    this.refresh();
  }
  deactivate() {
    this.viewer.setHighlight({});
  }
  refresh() {
    const ts = useApp.getState().toolState;
    const target = ts.target as string | null;
    const tools = (ts.tools as string[]) ?? [];
    const edges: { bodyId: string; edge: number; color: number }[] = [];
    const add = (id: string, color: number) => {
      const v = this.viewer.bodies.get(id);
      v?.data.edges.forEach((_, i) => edges.push({ bodyId: id, edge: i, color }));
    };
    if (target) add(target, 0x1f6fff);
    tools.forEach((t) => add(t, 0xff7a00));
    this.viewer.setHighlight({ edges });
  }
  click(e: PointerInfo) {
    const h = this.viewer.pickBody(e);
    if (!h) return;
    const s = useApp.getState();
    const target = s.toolState.target as string | null;
    let tools = [...((s.toolState.tools as string[]) ?? [])];
    if (!target) s.setToolState({ target: h.bodyId });
    else if (h.bodyId === target) s.setToolState({ target: tools[0] ?? null, tools: tools.slice(1) });
    else {
      tools = tools.includes(h.bodyId) ? tools.filter((t) => t !== h.bodyId) : [...tools, h.bodyId];
      s.setToolState({ tools });
    }
  }
  apply() {
    const s = useApp.getState();
    const target = s.toolState.target as string | null;
    const tools = (s.toolState.tools as string[]) ?? [];
    const op = s.toolState.op as BooleanOp;
    if (!target || !tools.length) {
      s.notify('Wybierz bryłę główną i co najmniej jedną bryłę-narzędzie', 'error');
      return;
    }
    const d = clone(s.doc);
    d.features.push({ id: uid('f'), type: 'boolean', op, bodyId: target, tools });
    s.commit(d);
    s.setSelection({ kind: 'body', bodyId: target });
    s.setTool('select');
  }
  key(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.apply();
      return true;
    }
    return false;
  }
}

// ------------------------------------------------------------ zaokrąglenie/fazowanie

export class FilletTool extends LiveFeatureTool {
  private bodyId: string | null = null;
  private hoverEdge: { bodyId: string; edge: number } | null = null;
  constructor(
    viewer: Viewer,
    private kind: 'fillet' | 'chamfer',
  ) {
    super(viewer);
  }
  static radius = { fillet: 2, chamfer: 1 };

  activate() {
    useApp.getState().setToolState({
      hint: 'Klikaj krawędzie (ponowne kliknięcie odznacza). Kliknięcie w narożnik zaznacza wszystkie krawędzie wychodzące z niego.',
      fillet: { count: 0 },
    });
  }

  private selectedIdx(): number[] {
    const f = this.feature<FilletFeature>();
    if (!f || !this.bodyId) return [];
    const v = this.viewer.bodies.get(this.bodyId);
    if (!v) return [];
    if (f.allEdges) return v.data.edges.map((_, i) => i);
    return f.edges.map((r) => nearestEdge(v.data.edges, r)).filter((i) => i >= 0);
  }

  refresh() {
    if (this.refreshPreviewFlag()) {
      this.viewer.setHighlight({});
      return;
    }
    const sel = this.selectedIdx();
    const edges = sel.map((i) => ({ bodyId: this.bodyId!, edge: i, color: 0xff7a00 }));
    if (this.hoverEdge && !(this.hoverEdge.bodyId === this.bodyId && sel.includes(this.hoverEdge.edge))) edges.push({ ...this.hoverEdge, color: 0xffd400 });
    this.viewer.setHighlight({ edges });
  }

  hover(e: PointerInfo) {
    const h = this.viewer.pickEdge(e, e.pointerType === 'touch' ? 22 : 10);
    const changed = JSON.stringify(h && { b: h.bodyId, e: h.edge }) !== JSON.stringify(this.hoverEdge && { b: this.hoverEdge.bodyId, e: this.hoverEdge.edge });
    this.hoverEdge = h ? { bodyId: h.bodyId, edge: h.edge } : null;
    if (changed) this.refresh();
  }

  setPreview(on: boolean) {
    this.patch((f: FilletFeature) => (f.suppressed = !on));
    this.publishCount();
    this.refresh();
  }

  confirm() {
    this.patch((f: FilletFeature) => (f.suppressed = false));
    super.confirm();
  }

  refreshPreviewFlag(): boolean {
    return !!this.feature<FilletFeature>() && !this.feature<FilletFeature>()!.suppressed;
  }

  click(e: PointerInfo) {
    if (this.refreshPreviewFlag()) {
      this.setPreview(false);
      useApp.getState().notify('Wyłączono podgląd – teraz możesz zaznaczać krawędzie', 'info');
      return;
    }
    const tol = e.pointerType === 'touch' ? 22 : 10;
    const vtx = this.viewer.pickVertex(e, tol);
    const edgeHit = this.viewer.pickEdge(e, tol);
    const bodyId = vtx?.bodyId ?? edgeHit?.bodyId;
    if (!bodyId) return;
    const view = this.viewer.bodies.get(bodyId)!;
    if (view.data.geometry === 'mesh') {
      useApp.getState().notify('Zaokrąglenia i fazowania działają tylko na bryłach B-rep, nie na zaimportowanych siatkach.', 'error');
      return;
    }
    let idx: number[] = [];
    if (vtx) {
      // narożnik: wszystkie krawędzie, których koniec leży w tym wierzchołku
      idx = view.data.edges.map((ed, i) => (v3.dist(ed.a, [vtx.pos.x, vtx.pos.y, vtx.pos.z]) < 1e-4 || v3.dist(ed.b, [vtx.pos.x, vtx.pos.y, vtx.pos.z]) < 1e-4 ? i : -1)).filter((i) => i >= 0);
    } else if (edgeHit) idx = [edgeHit.edge];
    if (!idx.length) return;
    if (this.bodyId && this.bodyId !== bodyId && this.featureId) {
      this.cancel();
    }
    this.bodyId = bodyId;
    const refs = idx.map((i) => edgeRef(view.data.edges[i]));
    if (!this.featureId) {
      // w trakcie wybierania krawędzi operacja jest wygaszona (widać oryginalne krawędzie); podgląd włącza się osobno
      const f: FilletFeature = { id: uid('f'), type: this.kind, bodyId, edges: refs, radius: FilletTool.radius[this.kind], suppressed: true };
      this.startLive(f);
    } else {
      this.patch((f: FilletFeature) => {
        f.allEdges = false;
        const cur = f.edges.map((r) => nearestEdge(view.data.edges, r));
        const allSelected = idx.every((i) => cur.includes(i));
        if (allSelected) f.edges = f.edges.filter((_, k) => !idx.includes(cur[k]));
        else for (const i of idx) if (!cur.includes(i)) f.edges.push(edgeRef(view.data.edges[i]));
      });
    }
    const f = this.feature<FilletFeature>();
    if (f && !f.edges.length && !f.allEdges) this.cancel();
    this.publishCount();
    this.refresh();
  }

  allEdges() {
    const s = useApp.getState();
    const id = this.bodyId ?? (s.selection?.kind === 'body' ? s.selection.bodyId : null) ?? Object.keys(s.bodies)[0];
    if (!id) return;
    this.bodyId = id;
    if (!this.featureId) this.startLive({ id: uid('f'), type: this.kind, bodyId: id, edges: [], allEdges: true, radius: FilletTool.radius[this.kind], suppressed: true });
    else this.patch((f: FilletFeature) => (f.allEdges = true));
    this.publishCount();
    this.refresh();
  }

  setRadius(r: number) {
    FilletTool.radius[this.kind] = r;
    this.patch((f: FilletFeature) => (f.radius = r));
    this.publishCount();
  }

  private publishCount() {
    const f = this.feature<FilletFeature>();
    useApp.getState().setToolState({
      fillet: { count: f ? (f.allEdges ? -1 : f.edges.length) : 0, featureId: this.featureId, radius: FilletTool.radius[this.kind], preview: !!f && !f.suppressed },
    });
  }

  protected onEnd() {
    this.bodyId = null;
    this.viewer.setHighlight({});
    useApp.getState().setToolState({ fillet: { count: 0 } });
  }
}

export function edgeRef(e: EdgeInfo): EdgeRef {
  return { mid: e.mid, dir: e.dir, kind: e.kind };
}

function nearestEdge(edges: EdgeInfo[], r: EdgeRef): number {
  let best = -1, bs = Infinity;
  edges.forEach((e, i) => {
    const sc = v3.dist(e.mid, r.mid) + 50 * (1 - Math.abs(v3.dot(e.dir, r.dir)));
    if (sc < bs) {
      bs = sc;
      best = i;
    }
  });
  return bs < 1 ? best : -1;
}

// --------------------------------------------------------------------------- pomiar

const measureMat = makeLineMaterial(0xd81b60, 3, false);

function labelSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 30px system-ui, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  c.width = w;
  c.height = 46;
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(216,27,96,0.95)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 46, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 12, 24);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  sp.scale.set((w / 46) * 0.045, 0.045, 1);
  sp.renderOrder = 20;
  return sp;
}

export class MeasureTool implements Tool {
  private pts: Vec3[] = [];
  private group = new THREE.Group();
  constructor(private viewer: Viewer) {}
  activate() {
    this.pts = [];
    this.viewer.overlay.add(this.group);
    useApp.getState().setToolState({ hint: 'Kliknij dwa punkty (wierzchołki są przyciągane). Trzecie kliknięcie zaczyna nowy pomiar.', measure: null });
  }
  deactivate() {
    this.group.clear();
    this.group.removeFromParent();
  }
  private pointAt(e: PointerInfo): Vec3 | null {
    const tol = e.pointerType === 'touch' ? 22 : 12;
    const v = this.viewer.pickVertex(e, tol);
    if (v) return [v.pos.x, v.pos.y, v.pos.z];
    const ed = this.viewer.pickEdge(e, tol * 0.6);
    const hit = this.viewer.pickBody(e);
    if (ed) {
      const info = this.viewer.bodies.get(ed.bodyId)!.data.edges[ed.edge];
      // punkt na krawędzi najbliższy kursorowi: środek krawędzi lub środek okręgu
      if (info.center && info.kind === 'circle') return info.center;
      if (hit) return [hit.point.x, hit.point.y, hit.point.z];
      return info.mid;
    }
    if (hit) return [hit.point.x, hit.point.y, hit.point.z];
    const p = rayPlane(e.ray, [0, 0, 0], [0, 0, 1]);
    return p ? [p.x, p.y, p.z] : null;
  }
  click(e: PointerInfo) {
    const p = this.pointAt(e);
    if (!p) return;
    if (this.pts.length >= 2) this.pts = [];
    this.pts.push(p);
    this.draw();
  }
  private draw() {
    this.group.clear();
    const s = useApp.getState();
    for (const p of this.pts) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xd81b60, depthTest: false }));
      m.position.set(...p);
      m.scale.setScalar(this.viewer.worldPerPixel(m.position) * 5);
      m.renderOrder = 19;
      this.group.add(m);
    }
    if (this.pts.length === 2) {
      const [a, b] = this.pts;
      const g = new LineSegmentsGeometry();
      g.setPositions([...a, ...b]);
      const l = new LineSegments2(g, measureMat);
      l.renderOrder = 18;
      this.group.add(l);
      const d = v3.dist(a, b);
      const sp = labelSprite(`${fmt(d)} mm`);
      sp.position.set(...v3.lerp(a, b, 0.5));
      this.group.add(sp);
      s.setToolState({ measure: { a, b, d, dx: b[0] - a[0], dy: b[1] - a[1], dz: b[2] - a[2] } });
    } else s.setToolState({ measure: this.pts.length ? { a: this.pts[0] } : null });
    this.viewer.requestRender();
  }
  frame() {
    for (const c of this.group.children) if (c instanceof THREE.Mesh) c.scale.setScalar(this.viewer.worldPerPixel(c.position) * 5);
  }
  key(e: KeyboardEvent) {
    if (e.key === 'Escape' && this.pts.length) {
      this.pts = [];
      this.draw();
      return true;
    }
    return false;
  }
}
