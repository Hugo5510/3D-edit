// Narzędzia rysowania szkicu: linia, prostokąt, okrąg, wielokąt, łuki, zaokrąglenie narożnika, wypełnianie.
import type { PointerInfo, Tool, Viewer } from '../Viewer';
import type { SketchLayer } from '../SketchLayer';
import { useApp } from '../../state/store';
import { updateSketch } from '../../state/actions';
import type { Sketch, Vec2 } from '../../model/types';
import {
  addArc,
  addCircle,
  addLine,
  addPolygon,
  addRect,
  fillAt,
  fillableRegionAt,
  filletCorner,
  mergePoints,
  movePoint,
  polygonPoints,
  snap,
  type PointSpec,
  type SnapResult,
} from '../../model/sketchOps';
import { arcGeometry, bulgeFrom3, bulgeFromCenter, gaps, sampleArc } from '../../model/sketchGeom';
import { deg, fmt, rad, v2 } from '../../model/math';
import { hitSketch, sketchCursor } from './sketchPick';

export interface DimDef {
  key: string;
  label: string;
  value: number;
  unit: string;
  integer?: boolean;
}

export function activeSketch(): Sketch | null {
  const st = useApp.getState();
  return st.doc.sketches.find((s) => s.id === st.activeSketchId) ?? null;
}

function circlePoly(c: Vec2, r: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= 72; i++) out.push([c[0] + r * Math.cos((i / 72) * Math.PI * 2), c[1] + r * Math.sin((i / 72) * Math.PI * 2)]);
  return out;
}

/** Wspólna obsługa: kursor z przyciąganiem, przeciąganie punktów, pole wymiarów. */
export abstract class SketchToolBase implements Tool {
  protected pts: PointSpec[] = [];
  protected cur: SnapResult | null = null;
  protected typed: Record<string, number> = {};
  private dragPt: string | null = null;
  protected viewer: Viewer;
  protected layer: SketchLayer;
  abstract readonly hint: string;

  constructor(v: Viewer, l: SketchLayer) {
    this.viewer = v;
    this.layer = l;
  }

  activate() {
    this.reset();
  }

  deactivate() {
    this.layer.setPreview(null, []);
    useApp.getState().setToolState({ dims: null, hint: null });
  }

  reset() {
    this.pts = [];
    this.typed = {};
    this.cur = null;
    this.layer.setPreview(null, []);
    this.publish();
  }

  protected snapAt(e: PointerInfo, exclude?: Set<string>): SnapResult | null {
    const sk = activeSketch();
    if (!sk) return null;
    const c = sketchCursor(this.viewer, e, sk);
    if (!c) return null;
    const st = useApp.getState();
    const tol = c.mmPerPx * (e.pointerType === 'touch' ? 24 : 12);
    return snap(sk, c.p, tol, { grid: st.settings.gridSnap ? st.settings.gridStep : null, points: st.settings.pointSnap, exclude });
  }

  protected spec(s: SnapResult): PointSpec {
    return { id: s.pointId, x: s.p[0], y: s.p[1] };
  }

  protected edit(fn: (sk: Sketch) => void) {
    const st = useApp.getState();
    const id = st.activeSketchId;
    if (!id) return;
    try {
      st.commit(updateSketch(st.doc, id, fn));
    } catch (err) {
      st.notify(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  /** Wymiary pokazywane w polu wymiarów podczas rysowania. */
  dims(): DimDef[] {
    return [];
  }

  protected publish() {
    const st = useApp.getState();
    st.setToolState({ dims: this.dims(), hint: this.hint, step: this.pts.length });
  }

  setDim(_key: string, _value: number) {
    /* nadpisywane */
  }

  pointerDown(e: PointerInfo): boolean {
    // przeciąganie istniejących punktów, gdy narzędzie nie ma rozpoczętego elementu
    if (this.pts.length) return false;
    const sk = activeSketch();
    if (!sk) return false;
    const h = hitSketch(this.viewer, e, sk, 10, false);
    if (h?.kind === 'point') {
      this.dragPt = h.id;
      useApp.getState().beginGesture();
      return true;
    }
    return false;
  }

  drag(e: PointerInfo) {
    if (!this.dragPt) return;
    const id = this.dragPt;
    const s = this.snapAt(e, new Set([id]));
    if (!s) return;
    this.cur = s;
    const st = useApp.getState();
    st.live(updateSketch(st.doc, st.activeSketchId!, (sk) => movePoint(sk, id, s.p)));
    const sk = activeSketch();
    if (sk) this.layer.setPreview(sk.plane, [], [], s.kind !== 'none' && s.kind !== 'grid' ? s.p : null);
    st.setDragInfo({ text: `${fmt(s.p[0])}; ${fmt(s.p[1])} mm`, x: e.x, y: e.y });
  }

  pointerUp() {
    const id = this.dragPt;
    this.dragPt = null;
    const st = useApp.getState();
    if (id && this.cur?.pointId && this.cur.pointId !== id) {
      const into = this.cur.pointId;
      st.live(updateSketch(st.doc, st.activeSketchId!, (sk) => mergePoints(sk, id, into)));
      st.notify('Punkty połączone', 'ok');
    }
    st.endGesture();
    st.setDragInfo(null);
    this.layer.setPreview(null, []);
  }

  hover(e: PointerInfo) {
    const s = this.snapAt(e);
    if (!s) return;
    this.cur = s;
    this.preview();
    this.publish();
  }

  click(e: PointerInfo) {
    const s = this.snapAt(e);
    if (!s) return;
    this.cur = s;
    this.onPoint(s);
    this.preview();
    this.publish();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.pts.length) {
      this.reset();
      return true;
    }
    return false;
  }

  protected abstract onPoint(s: SnapResult): void;
  protected abstract previewShapes(): Vec2[][];

  protected preview() {
    const sk = activeSketch();
    if (!sk) return;
    const marks = this.pts.map((p) => [p.x, p.y] as Vec2);
    const snapMark = this.cur && this.cur.kind !== 'none' && this.cur.kind !== 'grid' ? this.cur.p : null;
    this.layer.setPreview(sk.plane, this.cur ? this.previewShapes() : [], marks, snapMark);
    this.viewer.requestRender();
  }
}

// ------------------------------------------------------------------------- linia

export class LineTool extends SketchToolBase {
  hint = 'Kliknij punkt początkowy, potem kolejne punkty. Kliknięcie w istniejący punkt łączy linie i kończy łańcuch. Esc – koniec.';
  private end(): Vec2 | null {
    if (!this.pts.length || !this.cur) return null;
    const a: Vec2 = [this.pts[0].x, this.pts[0].y];
    const dirAng = this.typed.angle !== undefined ? rad(this.typed.angle) : Math.atan2(this.cur.p[1] - a[1], this.cur.p[0] - a[0]);
    const len = this.typed.length ?? v2.dist(a, this.cur.p);
    if (this.typed.angle === undefined && this.typed.length === undefined) return this.cur.p;
    return [a[0] + len * Math.cos(dirAng), a[1] + len * Math.sin(dirAng)];
  }
  dims(): DimDef[] {
    const e = this.end();
    if (!e || !this.pts.length) return [];
    const a: Vec2 = [this.pts[0].x, this.pts[0].y];
    return [
      { key: 'length', label: 'Długość', value: v2.dist(a, e), unit: 'mm' },
      { key: 'angle', label: 'Kąt', value: deg(Math.atan2(e[1] - a[1], e[0] - a[0])), unit: '°' },
    ];
  }
  setDim(key: string, value: number) {
    if (!this.pts.length) return;
    if (key === 'length' && !(value > 0)) return;
    this.typed[key] = value;
    // długość zatwierdza linię; kąt tylko ustawia kierunek
    if (key === 'length') {
      const e = this.end();
      if (e) this.onPoint({ p: e, kind: 'none' });
      this.typed = {};
    }
    this.preview();
    this.publish();
  }
  protected onPoint(s: SnapResult) {
    if (!this.pts.length) {
      this.pts = [this.spec(s)];
      return;
    }
    const a = this.pts[0];
    const b = this.spec(s);
    let newB: string | null = null;
    this.edit((sk) => {
      const r = addLine(sk, a, b);
      newB = r?.b ?? null;
      if (r) a.id = r.a;
    });
    this.typed = {};
    if (!newB || s.pointId) this.pts = [];
    else this.pts = [{ id: newB, x: b.x, y: b.y }];
  }
  protected previewShapes(): Vec2[][] {
    const e = this.end();
    return e && this.pts.length ? [[[this.pts[0].x, this.pts[0].y], e]] : [];
  }
}

// --------------------------------------------------------------------- prostokąt

export class RectTool extends SketchToolBase {
  hint = 'Kliknij pierwszy narożnik, potem przeciwległy (albo wpisz szerokość i wysokość).';
  private corner(): Vec2 | null {
    if (!this.pts.length || !this.cur) return null;
    const a = this.pts[0];
    let w = this.cur.p[0] - a.x;
    let h = this.cur.p[1] - a.y;
    if (this.typed.width !== undefined) w = Math.sign(w || 1) * this.typed.width;
    if (this.typed.height !== undefined) h = Math.sign(h || 1) * this.typed.height;
    return [a.x + w, a.y + h];
  }
  dims(): DimDef[] {
    const c = this.corner();
    if (!c) return [];
    return [
      { key: 'width', label: 'Szerokość', value: Math.abs(c[0] - this.pts[0].x), unit: 'mm' },
      { key: 'height', label: 'Wysokość', value: Math.abs(c[1] - this.pts[0].y), unit: 'mm' },
    ];
  }
  setDim(key: string, value: number) {
    if (!(value > 0) || !this.pts.length) return;
    this.typed[key] = value;
    if (this.typed.width !== undefined && this.typed.height !== undefined) {
      const c = this.corner();
      if (c) this.onPoint({ p: c, kind: 'none' });
    }
    this.preview();
    this.publish();
  }
  protected onPoint(s: SnapResult) {
    if (!this.pts.length) {
      this.pts = [this.spec(s)];
      return;
    }
    const c = s.kind === 'none' ? s.p : (this.corner() ?? s.p);
    const a = this.pts[0];
    const b: PointSpec = s.kind === 'none' || this.typed.width !== undefined || this.typed.height !== undefined ? { x: c[0], y: c[1] } : this.spec(s);
    this.edit((sk) => {
      if (!addRect(sk, a, b)) throw new Error('Prostokąt musi mieć niezerową szerokość i wysokość');
    });
    this.pts = [];
    this.typed = {};
  }
  protected previewShapes(): Vec2[][] {
    const c = this.corner();
    if (!c) return [];
    const a = this.pts[0];
    return [[[a.x, a.y], [c[0], a.y], c, [a.x, c[1]], [a.x, a.y]]];
  }
}

// -------------------------------------------------------------------------- okrąg

export class CircleTool extends SketchToolBase {
  hint = 'Kliknij środek okręgu, potem punkt na okręgu (albo wpisz promień lub średnicę).';
  private radius(): number {
    if (!this.pts.length || !this.cur) return 0;
    if (this.typed.r !== undefined) return this.typed.r;
    return v2.dist([this.pts[0].x, this.pts[0].y], this.cur.p);
  }
  dims(): DimDef[] {
    if (!this.pts.length) return [];
    const r = this.radius();
    return [
      { key: 'r', label: 'Promień', value: r, unit: 'mm' },
      { key: 'd', label: 'Średnica', value: r * 2, unit: 'mm' },
    ];
  }
  setDim(key: string, value: number) {
    if (!(value > 0) || !this.pts.length) return;
    this.typed.r = key === 'd' ? value / 2 : value;
    this.onPoint({ p: [0, 0], kind: 'none' });
    this.preview();
    this.publish();
  }
  protected onPoint(s: SnapResult) {
    if (!this.pts.length) {
      this.pts = [s.kind === 'center' ? { x: s.p[0], y: s.p[1] } : this.spec(s)];
      return;
    }
    const r = this.typed.r ?? v2.dist([this.pts[0].x, this.pts[0].y], s.p);
    const c = this.pts[0];
    this.edit((sk) => {
      if (!addCircle(sk, c, r)) throw new Error('Promień musi być większy od zera');
    });
    this.pts = [];
    this.typed = {};
  }
  protected previewShapes(): Vec2[][] {
    if (!this.pts.length) return [];
    return [circlePoly([this.pts[0].x, this.pts[0].y], this.radius())];
  }
}

// ----------------------------------------------------------------------- wielokąt

export class PolygonTool extends SketchToolBase {
  hint = 'Kliknij środek wielokąta, potem wierzchołek. Liczbę boków ustawisz w polu wymiarów.';
  static sides = 6;
  private geom(): { r: number; rot: number } | null {
    if (!this.pts.length || !this.cur) return null;
    const c: Vec2 = [this.pts[0].x, this.pts[0].y];
    const rot = deg(Math.atan2(this.cur.p[1] - c[1], this.cur.p[0] - c[0]));
    return { r: this.typed.r ?? v2.dist(c, this.cur.p), rot };
  }
  dims(): DimDef[] {
    const g = this.geom();
    const out: DimDef[] = [{ key: 'n', label: 'Boki', value: PolygonTool.sides, unit: '', integer: true }];
    if (g) out.push({ key: 'r', label: 'Promień opisany', value: g.r, unit: 'mm' });
    return out;
  }
  setDim(key: string, value: number) {
    if (key === 'n') {
      PolygonTool.sides = Math.max(3, Math.min(200, Math.round(value)));
    } else if (key === 'r' && value > 0 && this.pts.length) {
      this.typed.r = value;
      const g = this.geom();
      if (g) this.create(g.r, g.rot);
    }
    this.preview();
    this.publish();
  }
  private create(r: number, rot: number) {
    const c: Vec2 = [this.pts[0].x, this.pts[0].y];
    this.edit((sk) => {
      if (!addPolygon(sk, c, r, PolygonTool.sides, rot)) throw new Error('Promień musi być większy od zera');
    });
    this.pts = [];
    this.typed = {};
  }
  protected onPoint(s: SnapResult) {
    if (!this.pts.length) {
      this.pts = [{ x: s.p[0], y: s.p[1] }];
      return;
    }
    const g = this.geom();
    if (g) this.create(g.r, g.rot);
  }
  protected previewShapes(): Vec2[][] {
    const g = this.geom();
    if (!g) return [];
    const pts = polygonPoints([this.pts[0].x, this.pts[0].y], g.r, PolygonTool.sides, g.rot);
    return [[...pts, pts[0]]];
  }
}

// --------------------------------------------------------------- łuk przez 3 punkty

export class Arc3Tool extends SketchToolBase {
  hint = 'Kliknij początek łuku, potem koniec, a na końcu punkt, przez który łuk ma przechodzić.';
  private bulge(): number | null {
    if (this.pts.length < 2 || !this.cur) return null;
    const a: Vec2 = [this.pts[0].x, this.pts[0].y];
    const b: Vec2 = [this.pts[1].x, this.pts[1].y];
    if (this.typed.r !== undefined) {
      const half = v2.dist(a, b) / 2;
      if (this.typed.r < half) return null;
      const side = v2.cross(v2.sub(b, a), v2.sub(this.cur.p, a)) > 0 ? -1 : 1;
      return side * Math.tan(Math.asin(half / this.typed.r) / 2);
    }
    return bulgeFrom3(a, this.cur.p, b);
  }
  dims(): DimDef[] {
    if (this.pts.length < 2) return [];
    const bl = this.bulge();
    if (bl === null) return [];
    const g = arcGeometry([this.pts[0].x, this.pts[0].y], [this.pts[1].x, this.pts[1].y], bl);
    return [{ key: 'r', label: 'Promień', value: g.r, unit: 'mm' }];
  }
  setDim(key: string, value: number) {
    if (key !== 'r' || this.pts.length < 2) return;
    const half = v2.dist([this.pts[0].x, this.pts[0].y], [this.pts[1].x, this.pts[1].y]) / 2;
    if (value < half) {
      useApp.getState().notify(`Promień musi być ≥ ${fmt(half)} mm (połowa odległości końców)`, 'error');
      return;
    }
    this.typed.r = value;
    const bl = this.bulge();
    if (bl !== null) this.finish(bl);
    this.preview();
    this.publish();
  }
  private finish(bl: number) {
    const [a, b] = this.pts;
    this.edit((sk) => {
      if (!addArc(sk, a, b, bl)) throw new Error('Nie można utworzyć łuku');
    });
    this.pts = [];
    this.typed = {};
  }
  protected onPoint(s: SnapResult) {
    if (this.pts.length < 2) {
      this.pts.push(this.spec(s));
      return;
    }
    const bl = this.bulge();
    if (bl === null) {
      useApp.getState().notify('Trzy punkty leżą na prostej – wskaż punkt poza linią', 'error');
      return;
    }
    this.finish(bl);
  }
  protected previewShapes(): Vec2[][] {
    if (this.pts.length === 1 && this.cur) return [[[this.pts[0].x, this.pts[0].y], this.cur.p]];
    const bl = this.bulge();
    if (bl === null) return [];
    return [sampleArc([this.pts[0].x, this.pts[0].y], [this.pts[1].x, this.pts[1].y], bl)];
  }
}

// ------------------------------------------------------- łuk środek–początek–koniec

export class ArcCenterTool extends SketchToolBase {
  hint = 'Kliknij środek łuku, potem początek, potem koniec (łuk rysowany przeciwnie do wskazówek zegara; ujemny kąt – zgodnie).';
  private cw = false;
  private endPt(): Vec2 | null {
    if (this.pts.length < 2 || !this.cur) return null;
    const c: Vec2 = [this.pts[0].x, this.pts[0].y];
    const a: Vec2 = [this.pts[1].x, this.pts[1].y];
    const r = v2.dist(c, a);
    let ang: number;
    if (this.typed.angle !== undefined) ang = Math.atan2(a[1] - c[1], a[0] - c[0]) + rad(this.typed.angle);
    else ang = Math.atan2(this.cur.p[1] - c[1], this.cur.p[0] - c[0]);
    return [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)];
  }
  private currentBulge(): number | null {
    const e = this.endPt();
    if (!e) return null;
    const c: Vec2 = [this.pts[0].x, this.pts[0].y];
    const a: Vec2 = [this.pts[1].x, this.pts[1].y];
    if (v2.dist(a, e) < 1e-6) return null;
    const dir = this.typed.angle !== undefined ? (this.typed.angle >= 0 ? 1 : -1) : this.cw ? -1 : 1;
    return bulgeFromCenter(c, a, e, dir);
  }
  dims(): DimDef[] {
    if (this.pts.length === 1 && this.cur) return [{ key: 'r', label: 'Promień', value: v2.dist([this.pts[0].x, this.pts[0].y], this.cur.p), unit: 'mm' }];
    const bl = this.currentBulge();
    if (bl === null) return [];
    return [{ key: 'angle', label: 'Kąt łuku', value: deg(4 * Math.atan(bl)), unit: '°' }];
  }
  setDim(key: string, value: number) {
    if (key === 'r' && this.pts.length === 1 && value > 0 && this.cur) {
      const c: Vec2 = [this.pts[0].x, this.pts[0].y];
      const d = v2.norm(v2.sub(this.cur.p, c));
      const dd: Vec2 = v2.len(d) > 0 ? d : [1, 0];
      this.pts.push({ x: c[0] + dd[0] * value, y: c[1] + dd[1] * value });
    } else if (key === 'angle' && this.pts.length === 2 && Math.abs(value) > 1e-6 && Math.abs(value) < 360) {
      this.typed.angle = value;
      this.finish();
    }
    this.preview();
    this.publish();
  }
  key(e: KeyboardEvent): boolean {
    if (e.key.toLowerCase() === 'r' && this.pts.length === 2) {
      this.cw = !this.cw;
      this.preview();
      return true;
    }
    return super.key(e);
  }
  private finish() {
    const bl = this.currentBulge();
    const e = this.endPt();
    if (bl === null || !e) return;
    const a = this.pts[1];
    const endSpec: PointSpec = this.typed.angle === undefined && this.cur?.pointId ? { id: this.cur.pointId, x: e[0], y: e[1] } : { x: e[0], y: e[1] };
    this.edit((sk) => {
      if (!addArc(sk, a, endSpec, bl)) throw new Error('Nie można utworzyć łuku');
    });
    this.pts = [];
    this.typed = {};
  }
  protected onPoint(s: SnapResult) {
    if (this.pts.length === 0) {
      this.pts.push({ x: s.p[0], y: s.p[1] });
    } else if (this.pts.length === 1) {
      this.pts.push(this.spec(s));
    } else this.finish();
  }
  protected previewShapes(): Vec2[][] {
    if (this.pts.length === 1 && this.cur) {
      const c: Vec2 = [this.pts[0].x, this.pts[0].y];
      return [circlePoly(c, v2.dist(c, this.cur.p)), [c, this.cur.p]];
    }
    const bl = this.currentBulge();
    const e = this.endPt();
    if (bl === null || !e) return [];
    return [sampleArc([this.pts[1].x, this.pts[1].y], e, bl)];
  }
}

// ----------------------------------------------------------- zaokrąglenie narożnika

export class SketchFilletTool extends SketchToolBase {
  hint = 'Ustaw promień i kliknij narożnik (punkt wspólny dwóch linii).';
  static radius = 3;
  dims(): DimDef[] {
    return [{ key: 'r', label: 'Promień', value: SketchFilletTool.radius, unit: 'mm' }];
  }
  setDim(key: string, value: number) {
    if (key === 'r' && value > 0) SketchFilletTool.radius = value;
    this.publish();
  }
  pointerDown() {
    return false;
  }
  click(e: PointerInfo) {
    const sk = activeSketch();
    if (!sk) return;
    const h = hitSketch(this.viewer, e, sk, 14, false);
    if (h?.kind !== 'point') {
      useApp.getState().notify('Kliknij narożnik – punkt, w którym spotykają się dwie linie', 'info');
      return;
    }
    const r = SketchFilletTool.radius;
    this.edit((s) => {
      filletCorner(s, h.id, r);
    });
  }
  protected onPoint() {}
  protected previewShapes(): Vec2[][] {
    return [];
  }
}

// -------------------------------------------------------------------- wypełnianie

export class FillTool extends SketchToolBase {
  hint = 'Kliknij wolną przestrzeń otoczoną liniami (także przecinającymi się), aby ją wypełnić – potem „Wyciągnij”.';
  pointerDown() {
    return false;
  }
  hover(e: PointerInfo) {
    const sk = activeSketch();
    if (!sk) return;
    const c = sketchCursor(this.viewer, e, sk);
    const polys = c ? fillableRegionAt(sk, c.p) : null;
    this.layer.setPreview(sk.plane, polys ?? []);
    this.viewer.requestRender();
  }
  click(e: PointerInfo) {
    const sk = activeSketch();
    if (!sk) return;
    const c = sketchCursor(this.viewer, e, sk);
    if (!c) return;
    let pid: string | null = null;
    const st = useApp.getState();
    const next = updateSketch(st.doc, sk.id, (s) => {
      pid = fillAt(s, c.p);
    });
    if (pid) {
      st.commit(next);
      st.setSelection({ kind: 'profile', sketchId: sk.id, profileId: pid });
      this.layer.setPreview(null, []);
      st.notify('Wypełniono obszar – kliknij „Wyciągnij”, aby zrobić z niego bryłę 3D.', 'ok');
    } else {
      const g = gaps(sk).filter((x) => x.distance > 0);
      if (g.length) {
        const worst = g.sort((a, b) => a.distance - b.distance)[0];
        st.notify(
          `Kontur jest niedomknięty – przerwy zaznaczone na czerwono (najbliższa: ${fmt(worst.distance)} mm między (${fmt(worst.a[0])}; ${fmt(worst.a[1])}) a (${fmt(worst.b[0])}; ${fmt(worst.b[1])})). Przeciągnij koniec linii na drugi punkt, aby je połączyć.`,
          'error',
        );
      } else st.notify('W tym miejscu nie ma zamkniętego konturu.', 'error');
    }
  }
  protected onPoint() {}
  protected previewShapes(): Vec2[][] {
    return [];
  }
}

/** Pomocnik przeciągania punktów szkicu (używany przez narzędzie zaznaczania). */
export class SketchPointDragger extends SketchToolBase {
  hint = '';
  protected onPoint() {}
  protected previewShapes(): Vec2[][] {
    return [];
  }
  protected publish() {}
}
