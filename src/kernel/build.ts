// Odtwarzanie historii operacji w jądrze OpenCascade (occt-wasm). Działa w workerze i w testach Node.
import type { OcctKernel, ShapeHandle } from 'occt-wasm';
import type {
  Asset,
  EdgeRef,
  ExtrudeFeature,
  FaceRef,
  Feature,
  FilletFeature,
  HoleFeature,
  Mat4,
  PrimitiveFeature,
  ProjectDoc,
  Sketch,
  Vec2,
  Vec3,
} from '../model/types';
import { anyPerp, isIdentity, isSimilarity, toOcct, v3, planeY, rotationAxis, mul, translation } from '../model/math';
import { arcGeometry, orderLoop, toWorld, type LoopSeg } from '../model/sketchGeom';
import type { BodyResult, BuildResult, EdgeInfo, FaceInfo, MeshExportOptions, TessellatedBody } from './protocol';
import { flatNormals, isClosedMesh, meshBBox, meshBoolean, meshVolume, transformMesh, weld, type MeshData } from './meshOps';

type Geom =
  | { kind: 'brep'; shape: ShapeHandle; uid: number }
  | { kind: 'mesh'; mesh: MeshData; uid: number };

type State = Map<string, Geom>;

let uidCounter = 1;
const nextUid = () => uidCounter++;

function hashStr(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

const HASH_MAX = 2147483647;

export interface BuilderOptions {
  /** Dokładność siatki do wyświetlania (mm). */
  displayDeflection?: number;
}

interface FaceSig {
  handle: ShapeHandle;
  centroid: Vec3;
  normal: Vec3 | null;
  kind: string;
}

export class Builder {
  private keys: string[] = [];
  private marks: number[] = [];
  private states: State[] = [];
  private errs: (string | null)[] = [];
  private outCache = new Map<string, { uid: number; result: BodyResult }>();
  private assets = new Map<string, Asset>();
  private finalState: State = new Map();

  constructor(
    readonly k: OcctKernel,
    private opts: BuilderOptions = {},
  ) {}

  addAssets(assets: Asset[]) {
    for (const a of assets) this.assets.set(a.id, a);
  }

  hasAsset(id: string) {
    return this.assets.has(id);
  }

  // ------------------------------------------------------------------ build

  build(doc: ProjectDoc): BuildResult {
    const t0 = performance.now();
    const feats = doc.features;
    const keys: string[] = [];
    let prev = '';
    for (const f of feats) {
      let fk = JSON.stringify(f);
      if (f.type === 'extrude' && f.source.kind === 'profile') {
        const src = f.source;
        const sk = doc.sketches.find((s) => s.id === src.sketchId);
        fk += JSON.stringify(sk ? { p: sk.plane, pts: sk.points, e: sk.entities, pr: sk.profiles } : null);
      }
      prev = hashStr(prev + fk);
      keys.push(prev);
    }
    let k0 = 0;
    while (k0 < keys.length && k0 < this.keys.length && keys[k0] === this.keys[k0]) k0++;
    if (k0 < this.keys.length) {
      // unieważnienie operacji od k0 – zwalniamy kształty utworzone przez nie
      this.k.releaseSince(this.marks[k0]);
      this.faceSigCache.clear();
      this.keys.length = k0;
      this.marks.length = k0;
      this.states.length = k0;
      this.errs.length = k0;
    }
    let state: State = k0 === 0 ? new Map() : new Map(this.states[k0 - 1]);
    for (let i = k0; i < feats.length; i++) {
      const f = feats[i];
      this.marks[i] = this.k.checkpoint();
      let err: string | null = null;
      if (!f.suppressed) {
        try {
          state = this.apply(doc, f, state);
        } catch (e) {
          err = errorMessage(e);
        }
      }
      this.keys[i] = keys[i];
      this.states[i] = new Map(state);
      this.errs[i] = err;
    }
    this.finalState = state;

    const errors: Record<string, string> = {};
    feats.forEach((f, i) => {
      const e = this.errs[i];
      if (e) errors[f.id] = e;
    });

    const bodies: BodyResult[] = [];
    const mark = this.k.checkpoint();
    for (const [id, g] of state) {
      const cached = this.outCache.get(id);
      if (cached && cached.uid === g.uid) {
        bodies.push(cached.result);
        continue;
      }
      try {
        const r = this.extract(id, g);
        this.outCache.set(id, { uid: g.uid, result: r });
        bodies.push(r);
      } catch (e) {
        errors['body:' + id] = errorMessage(e);
      }
    }
    this.k.releaseSince(mark);
    this.faceSigCache.clear();
    for (const id of [...this.outCache.keys()]) if (!state.has(id)) this.outCache.delete(id);
    return { bodies, errors, timeMs: performance.now() - t0 };
  }

  /** Kształt bryły po ostatniej przebudowie. */
  getGeom(id: string): Geom | undefined {
    return this.finalState.get(id);
  }

  bodyIds(): string[] {
    return [...this.finalState.keys()];
  }

  // ------------------------------------------------------------------ operacje

  private apply(doc: ProjectDoc, f: Feature, s: State): State {
    const k = this.k;
    const st = new Map(s);
    switch (f.type) {
      case 'primitive': {
        let sh = this.makePrimitive(f);
        if (!isIdentity(f.matrix)) sh = k.transform(sh, toOcct(f.matrix));
        st.set(f.bodyId, { kind: 'brep', shape: sh, uid: nextUid() });
        return st;
      }
      case 'transform': {
        const g = need(st, f.bodyId);
        st.set(f.bodyId, this.transformGeom(g, f.matrix));
        return st;
      }
      case 'extrude':
        return this.applyExtrude(doc, f, st);
      case 'hole':
        return this.applyHole(f, st);
      case 'boolean': {
        const target = need(st, f.bodyId);
        const tools = f.tools.filter((t) => t !== f.bodyId).map((t) => need(st, t));
        if (!tools.length) throw new Error('Wybierz co najmniej jedną bryłę-narzędzie');
        st.set(f.bodyId, this.boolean(f.op, target, tools));
        for (const t of f.tools) if (t !== f.bodyId) st.delete(t);
        return st;
      }
      case 'fillet':
      case 'chamfer':
        st.set(f.bodyId, this.applyFillet(f, need(st, f.bodyId)));
        return st;
      case 'import': {
        const a = this.assets.get(f.assetId);
        if (!a) throw new Error('Brak danych zaimportowanego pliku (zasób ' + f.assetId + ')');
        if (a.brep) {
          st.set(f.bodyId, { kind: 'brep', shape: k.fromBREP(a.brep), uid: nextUid() });
        } else if (a.mesh) {
          st.set(f.bodyId, { kind: 'mesh', mesh: a.mesh, uid: nextUid() });
        } else throw new Error('Pusty zasób');
        return st;
      }
      case 'delete':
        st.delete(f.bodyId);
        return st;
    }
  }

  private makePrimitive(f: PrimitiveFeature): ShapeHandle {
    const k = this.k;
    const p = f.params;
    const pos = (...names: string[]) => {
      for (const n of names) if (!(p[n] > 0)) throw new Error(`Wymiar „${n}” musi być większy od zera`);
    };
    switch (f.kind) {
      case 'box':
        pos('w', 'd', 'h');
        return k.translate(k.makeBox(p.w, p.d, p.h), -p.w / 2, -p.d / 2, 0);
      case 'cylinder':
        pos('r', 'h');
        return k.makeCylinder(p.r, p.h);
      case 'sphere':
        pos('r');
        return k.translate(k.makeSphere(p.r), 0, 0, p.r);
      case 'cone':
        pos('h');
        if (p.r1 < 0 || p.r2 < 0 || (p.r1 === 0 && p.r2 === 0)) throw new Error('Nieprawidłowe promienie stożka');
        if (Math.abs(p.r1 - p.r2) < 1e-9) return k.makeCylinder(p.r1, p.h);
        return k.makeCone(p.r1, p.r2, p.h);
      case 'torus':
        pos('R', 'r');
        if (p.r >= p.R) throw new Error('Promień przekroju musi być mniejszy od promienia torusa');
        return k.translate(k.makeTorus(p.R, p.r), 0, 0, p.r);
      case 'prism': {
        pos('r', 'h');
        const n = Math.round(p.n);
        if (n < 3 || n > 200) throw new Error('Liczba boków: 3–200');
        const pts: Vec3[] = [];
        for (let i = 0; i < n; i++) {
          const a = Math.PI / 2 + (i / n) * Math.PI * 2;
          pts.push([p.r * Math.cos(a), p.r * Math.sin(a), 0]);
        }
        return k.extrude(this.polyFace(pts), 0, 0, p.h);
      }
      case 'wedge': {
        pos('w', 'd', 'h');
        const top = Math.max(0, Math.min(p.top ?? 0, p.w));
        const pts: Vec3[] =
          top > 1e-9
            ? [[-p.w / 2, -p.d / 2, 0], [p.w / 2, -p.d / 2, 0], [-p.w / 2 + top, -p.d / 2, p.h], [-p.w / 2, -p.d / 2, p.h]]
            : [[-p.w / 2, -p.d / 2, 0], [p.w / 2, -p.d / 2, 0], [-p.w / 2, -p.d / 2, p.h]];
        return k.extrude(this.polyFace(pts), 0, p.d, 0);
      }
    }
  }

  private polyFace(pts: Vec3[]): ShapeHandle {
    const k = this.k;
    const edges = pts.map((a, i) => k.makeLineEdge(vec(a), vec(pts[(i + 1) % pts.length])));
    return k.makeFace(k.makeWire(edges));
  }

  private transformGeom(g: Geom, m: Mat4): Geom {
    if (g.kind === 'mesh') return { kind: 'mesh', mesh: transformMesh(g.mesh, m), uid: nextUid() };
    const sh = isSimilarity(m) ? this.k.transform(g.shape, toOcct(m)) : this.k.generalTransform(g.shape, toOcct(m));
    return { kind: 'brep', shape: sh, uid: nextUid() };
  }

  private profileFace(sk: Sketch, profileId: string): ShapeHandle {
    const k = this.k;
    const pr = sk.profiles.find((p) => p.id === profileId);
    if (!pr) throw new Error('Nie znaleziono wypełnionego konturu w szkicu');
    const wires = pr.loops.map((ids) => this.loopWire(sk, orderLoop(sk, ids)));
    let face = k.makeFace(wires[0]);
    if (wires.length > 1) face = k.addHolesInFace(face, wires.slice(1));
    return face;
  }

  private loopWire(sk: Sketch, segs: LoopSeg[]): ShapeHandle {
    const k = this.k;
    const w = (p: Vec2) => vec(toWorld(sk.plane, p));
    const edges = segs.map((s) => {
      if (s.type === 'circle') return k.makeCircleEdge(w(s.c), vec(sk.plane.normal), s.r);
      if (s.type === 'line') return k.makeLineEdge(w(s.p0), w(s.p1));
      const g = arcGeometry(s.p0, s.p1, s.bulge);
      return k.makeArcEdge(w(s.p0), w(g.mid), w(s.p1));
    });
    return k.makeWire(edges);
  }

  private applyExtrude(doc: ProjectDoc, f: ExtrudeFeature, st: State): State {
    const k = this.k;
    if (!Number.isFinite(f.distance) || Math.abs(f.distance) < 1e-6) throw new Error('Wysokość wyciągnięcia nie może być zerowa');
    let face: ShapeHandle;
    let n: Vec3;
    if (f.source.kind === 'profile') {
      const src = f.source;
      const sk = doc.sketches.find((s) => s.id === src.sketchId);
      if (!sk) throw new Error('Nie znaleziono szkicu');
      face = this.profileFace(sk, src.profileId);
      n = v3.norm(sk.plane.normal);
    } else {
      const g = need(st, f.source.bodyId);
      if (g.kind !== 'brep') throw new Error('Wyciąganie ścian siatki nie jest obsługiwane – użyj szkicu na płaszczyźnie');
      const sig = this.resolveFace(g, f.source.face);
      if (!sig.normal) throw new Error('Wyciągać można tylko płaskie ściany');
      face = sig.handle;
      n = sig.normal;
    }
    const d = f.distance;
    let prism = k.extrude(face, n[0] * d, n[1] * d, n[2] * d);
    if (f.symmetric) prism = k.translate(prism, (-n[0] * d) / 2, (-n[1] * d) / 2, (-n[2] * d) / 2);
    const tool: Geom = { kind: 'brep', shape: prism, uid: nextUid() };
    if (f.mode === 'new') {
      st.set(f.bodyId, tool);
      return st;
    }
    const target = st.get(f.bodyId);
    if (!target) {
      if (f.mode === 'join') {
        st.set(f.bodyId, tool);
        return st;
      }
      throw new Error('Brak bryły do wycięcia');
    }
    st.set(f.bodyId, this.boolean(f.mode === 'join' ? 'union' : 'subtract', target, [tool]));
    return st;
  }

  private applyHole(f: HoleFeature, st: State): State {
    const k = this.k;
    const g = need(st, f.bodyId);
    if (!(f.diameter > 0)) throw new Error('Średnica otworu musi być większa od zera');
    if (!f.through && !(f.depth > 0)) throw new Error('Głębokość otworu musi być większa od zera');
    if (g.kind !== 'brep') throw new Error('Otwory w siatkach: użyj walca i operacji „różnica”');
    const sig = this.resolveFace(g, f.face);
    if (!sig.normal) throw new Error('Otwór można wykonać tylko w płaskiej ścianie');
    const n = sig.normal;
    const center = this.holeCenter(sig, f);
    const bb = k.getBoundingBox(g.shape);
    const diag = Math.hypot(bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin);
    const extra = 0.05;
    const len = f.through ? diag * 2 + 2 : f.depth + extra;
    // walec wzdłuż +Z, obrócony tak, by oś wskazywała -n, z początkiem nieco ponad ścianą
    let cyl = k.makeCylinder(f.diameter / 2, len);
    const m = mul(translation(v3.add(center, v3.scale(n, extra))), alignZTo(v3.scale(n, -1)));
    cyl = k.transform(cyl, toOcct(m));
    st.set(f.bodyId, this.boolean('subtract', g, [{ kind: 'brep', shape: cyl, uid: nextUid() }]));
    return st;
  }

  /** Środek otworu na podstawie odległości od dwóch krawędzi ściany. */
  holeCenter(sig: FaceSig, f: Pick<HoleFeature, 'edges' | 'offsets'>): Vec3 {
    const k = this.k;
    const n = sig.normal!;
    if (!f.edges) {
      const sd = k.surfaceData(sig.handle) as { xDirection?: { x: number; y: number; z: number } };
      const xd: Vec3 = sd.xDirection ? [sd.xDirection.x, sd.xDirection.y, sd.xDirection.z] : anyPerp(n);
      const yd = planeY(n, xd);
      return v3.add(sig.centroid, v3.add(v3.scale(xd, f.offsets[0]), v3.scale(yd, f.offsets[1])));
    }
    const faceEdges = k.getSubShapes(sig.handle, 'edge');
    const lines = f.edges.map((ref) => {
      const best = this.bestEdge(faceEdges, ref);
      const cd = k.curveData(best) as { kind: string; point?: { x: number; y: number; z: number }; direction?: { x: number; y: number; z: number } };
      if (cd.kind !== 'line') throw new Error('Krawędzie odniesienia otworu muszą być proste');
      const p: Vec3 = [cd.point!.x, cd.point!.y, cd.point!.z];
      const d = v3.norm([cd.direction!.x, cd.direction!.y, cd.direction!.z]);
      let m = v3.norm(v3.cross(n, d));
      if (v3.dot(v3.sub(sig.centroid, p), m) < 0) m = v3.scale(m, -1);
      return { p, m };
    });
    // m_i · c = off_i + m_i · p_i, c = c0 + a*m1' ... rozwiązanie w płaszczyźnie ściany
    const xd = lines[0].m;
    const yd = planeY(n, xd);
    const o = sig.centroid;
    const to2 = (q: Vec3): Vec2 => [v3.dot(v3.sub(q, o), xd), v3.dot(v3.sub(q, o), yd)];
    const m1: Vec2 = [v3.dot(lines[0].m, xd), v3.dot(lines[0].m, yd)];
    const m2: Vec2 = [v3.dot(lines[1].m, xd), v3.dot(lines[1].m, yd)];
    const p1 = to2(lines[0].p), p2 = to2(lines[1].p);
    const r1 = f.offsets[0] + m1[0] * p1[0] + m1[1] * p1[1];
    const r2 = f.offsets[1] + m2[0] * p2[0] + m2[1] * p2[1];
    const det = m1[0] * m2[1] - m1[1] * m2[0];
    if (Math.abs(det) < 1e-6) throw new Error('Krawędzie odniesienia są równoległe – wybierz dwie nierównoległe');
    const cx = (r1 * m2[1] - m1[1] * r2) / det;
    const cy = (m1[0] * r2 - r1 * m2[0]) / det;
    return v3.add(o, v3.add(v3.scale(xd, cx), v3.scale(yd, cy)));
  }

  private applyFillet(f: FilletFeature, g: Geom): Geom {
    const k = this.k;
    if (g.kind !== 'brep') throw new Error('Zaokrąglenia i fazowania działają tylko na bryłach B-rep (nie na zaimportowanych siatkach)');
    if (!(f.radius > 0)) throw new Error('Promień musi być większy od zera');
    const solids = k.getSubShapes(g.shape, 'solid');
    if (!solids.length) throw new Error('Bryła nie zawiera brył zamkniętych');
    const perSolid = solids.map((s) => ({ s, edges: k.getSubShapes(s, 'edge'), chosen: [] as ShapeHandle[] }));
    if (f.allEdges) {
      for (const p of perSolid) {
        const faceCount = new Map<number, number>();
        for (const fc of k.getSubShapes(p.s, 'face'))
          for (const e of k.getSubShapes(fc, 'edge')) {
            const h = k.hashCode(e, HASH_MAX);
            faceCount.set(h, (faceCount.get(h) ?? 0) + 1);
          }
        // pomijamy szwy (krawędź należąca tylko do jednej ściany) i krawędzie zdegenerowane
        p.chosen = p.edges.filter((e) => (faceCount.get(k.hashCode(e, HASH_MAX)) ?? 0) >= 2 && !isSeamOrDegenerate(k, e));
      }
    } else {
      if (!f.edges.length) throw new Error('Wybierz krawędzie');
      for (const ref of f.edges) {
        let best: { p: (typeof perSolid)[number]; e: ShapeHandle; score: number } | null = null;
        for (const p of perSolid)
          for (const e of p.edges) {
            const sc = edgeScore(k, e, ref);
            if (!best || sc < best.score) best = { p, e, score: sc };
          }
        if (best && !best.p.chosen.includes(best.e)) best.p.chosen.push(best.e);
      }
    }
    const results: ShapeHandle[] = [];
    for (const p of perSolid) {
      if (!p.chosen.length) {
        results.push(p.s);
        continue;
      }
      try {
        results.push(f.type === 'fillet' ? k.fillet(p.s, p.chosen, f.radius) : k.chamfer(p.s, p.chosen, f.radius));
      } catch (e) {
        throw new Error(
          (f.type === 'fillet' ? 'Nie udało się zaokrąglić' : 'Nie udało się sfazować') +
            ' krawędzi – zwykle promień jest za duży względem sąsiednich ścian. ' +
            errorMessage(e),
        );
      }
    }
    const sh = results.length === 1 ? results[0] : k.makeCompound(results);
    return { kind: 'brep', shape: sh, uid: nextUid() };
  }

  boolean(op: 'union' | 'subtract' | 'intersect', target: Geom, tools: Geom[]): Geom {
    const k = this.k;
    if (target.kind === 'brep' && tools.every((t) => t.kind === 'brep')) {
      let acc = target.shape;
      for (const t of tools) {
        const ts = (t as { shape: ShapeHandle }).shape;
        acc = op === 'union' ? k.fuse(acc, ts) : op === 'subtract' ? k.cut(acc, ts) : k.common(acc, ts);
      }
      return { kind: 'brep', shape: this.clean(acc), uid: nextUid() };
    }
    // co najmniej jedna siatka – liczymy na siatkach (manifold)
    const toMesh = (g: Geom): MeshData => (g.kind === 'mesh' ? g.mesh : this.brepToMesh(g.shape, 0.02, 0.2));
    const res = meshBoolean(op, toMesh(target), tools.map(toMesh));
    return { kind: 'mesh', mesh: res, uid: nextUid() };
  }

  private clean(sh: ShapeHandle): ShapeHandle {
    const k = this.k;
    let r = sh;
    try {
      r = k.unifySameDomain(sh);
    } catch {
      r = sh;
    }
    const solids = k.getSubShapes(r, 'solid');
    if (solids.length === 1) return solids[0];
    if (solids.length === 0) {
      const faces = k.getSubShapes(r, 'face');
      if (!faces.length) throw new Error('Wynik operacji jest pusty');
    }
    return r;
  }

  brepToMesh(sh: ShapeHandle, deflection: number, angular: number): MeshData {
    const m = this.k.tessellate(sh, { linearDeflection: deflection, angularDeflection: angular });
    return weld(m.positions, m.indices, 1e-5);
  }

  // ------------------------------------------------------------------ odwołania

  private faceSigCache = new Map<number, FaceSig[]>();

  private faceSigs(g: Geom & { kind: 'brep' }): FaceSig[] {
    const c = this.faceSigCache.get(g.uid);
    if (c) return c;
    const k = this.k;
    const sigs = k.getSubShapes(g.shape, 'face').map((h) => {
      const kind = k.surfaceType(h);
      const cm = k.getSurfaceCenterOfMass(h);
      let normal: Vec3 | null = null;
      if (kind === 'plane') {
        const sd = k.surfaceData(h) as { normal: { x: number; y: number; z: number } };
        normal = [sd.normal.x, sd.normal.y, sd.normal.z];
        if (k.shapeOrientation(h) === 'reversed') normal = v3.scale(normal, -1);
        normal = v3.norm(normal);
      }
      return { handle: h, centroid: [cm.x, cm.y, cm.z] as Vec3, normal, kind };
    });
    if (this.faceSigCache.size > 200) this.faceSigCache.clear();
    this.faceSigCache.set(g.uid, sigs);
    return sigs;
  }

  resolveFace(g: Geom, ref: FaceRef): FaceSig {
    if (g.kind !== 'brep') throw new Error('Ściany siatek nie są obsługiwane w tej operacji');
    const sigs = this.faceSigs(g);
    let best: FaceSig | null = null;
    let bestScore = Infinity;
    for (const s of sigs) {
      let sc = v3.dist(s.centroid, ref.centroid);
      if (ref.normal) {
        if (!s.normal) sc += 1e4;
        else sc += 1e3 * (1 - v3.dot(s.normal, ref.normal));
      } else if (s.normal) sc += 1e4;
      if (s.kind !== ref.kind) sc += 100;
      if (sc < bestScore) {
        bestScore = sc;
        best = s;
      }
    }
    if (!best) throw new Error('Nie znaleziono ściany');
    return best;
  }

  private bestEdge(edges: ShapeHandle[], ref: EdgeRef): ShapeHandle {
    let best: ShapeHandle | null = null;
    let bs = Infinity;
    for (const e of edges) {
      const sc = edgeScore(this.k, e, ref);
      if (sc < bs) {
        bs = sc;
        best = e;
      }
    }
    if (best === null) throw new Error('Nie znaleziono krawędzi');
    return best;
  }

  // ------------------------------------------------------------------ wynik

  private extract(id: string, g: Geom): BodyResult {
    if (g.kind === 'mesh') return this.extractMesh(id, g);
    const k = this.k;
    const sh = g.shape;
    const bb = k.getBoundingBox(sh);
    const diag = Math.hypot(bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin);
    const defl = this.opts.displayDeflection ?? Math.min(0.1, Math.max(0.005, diag * 0.0008));
    const mesh = k.meshShape(sh, { linearDeflection: defl, angularDeflection: 0.25 });
    const faceHandles = k.getSubShapes(sh, 'face');
    const faceIndexByHash = new Map<number, number>();
    faceHandles.forEach((h, i) => faceIndexByHash.set(k.hashCode(h, HASH_MAX), i));
    const edgeHandles = k.getSubShapes(sh, 'edge');
    const edgeIndexByHash = new Map<number, number>();
    edgeHandles.forEach((h, i) => edgeIndexByHash.set(k.hashCode(h, HASH_MAX), i));

    const sigs = this.faceSigs(g);
    const faces: FaceInfo[] = faceHandles.map((h, i) => {
      const sd = sigs[i].kind === 'plane' ? (k.surfaceData(h) as { xDirection?: { x: number; y: number; z: number } }) : null;
      return {
        kind: sigs[i].kind,
        centroid: sigs[i].centroid,
        normal: sigs[i].normal,
        xDir: sd?.xDirection ? [sd.xDirection.x, sd.xDirection.y, sd.xDirection.z] : null,
        area: k.getSurfaceArea(h),
        start: 0,
        count: 0,
        edges: k
          .getSubShapes(h, 'edge')
          .map((e) => edgeIndexByHash.get(k.hashCode(e, HASH_MAX)) ?? -1)
          .filter((x, j, arr) => x >= 0 && arr.indexOf(x) === j),
      };
    });
    const fg = mesh.faceGroups;
    if (fg) {
      for (let i = 0; i < fg.length; i += 3) {
        const fi = faceIndexByHash.get(fg[i + 2]);
        if (fi !== undefined) {
          faces[fi].start = fg[i];
          faces[fi].count = fg[i + 1];
        }
      }
    }

    const wf = k.wireframe(sh, { source: 'curve', deflection: defl });
    const edges: EdgeInfo[] = edgeHandles.map((h) => edgeInfo(k, h));
    const eg = wf.edgeGroups;
    for (let i = 0; i < eg.length; i += 3) {
      const ei = edgeIndexByHash.get(eg[i + 2]);
      if (ei !== undefined) {
        edges[ei].start = eg[i];
        edges[ei].count = eg[i + 1];
      }
    }
    const vh = k.getSubShapes(sh, 'vertex');
    const vertices = new Float32Array(vh.length * 3);
    vh.forEach((h, i) => {
      const p = k.vertexPosition(h);
      vertices[i * 3] = p.x;
      vertices[i * 3 + 1] = p.y;
      vertices[i * 3 + 2] = p.z;
    });
    let volume = 0;
    try {
      volume = k.getVolume(sh);
    } catch {
      volume = 0;
    }
    const solids = k.getSubShapes(sh, 'solid');
    let closed = false;
    try {
      closed = solids.length > 0 && k.isValid(sh) && volume > 0;
    } catch {
      closed = false;
    }
    return {
      id,
      geometry: 'brep',
      positions: mesh.positions.slice(),
      normals: mesh.normals.slice(),
      indices: mesh.indices.slice(),
      faces,
      edgePoints: wf.points.slice(),
      edges,
      vertices,
      bbox: { min: [bb.xmin, bb.ymin, bb.zmin], max: [bb.xmax, bb.ymax, bb.zmax] },
      volume,
      closed,
      version: g.uid,
    };
  }

  private extractMesh(id: string, g: Geom & { kind: 'mesh' }): BodyResult {
    const flat = flatNormals(g.mesh);
    const bb = meshBBox(g.mesh.positions);
    return {
      id,
      geometry: 'mesh',
      positions: flat.positions,
      normals: flat.normals,
      indices: flat.indices,
      faces: [
        {
          kind: 'mesh',
          centroid: v3.scale(v3.add(bb.min, bb.max), 0.5),
          normal: null,
          xDir: null,
          area: 0,
          start: 0,
          count: flat.indices.length,
          edges: [],
        },
      ],
      edgePoints: new Float32Array(0),
      edges: [],
      vertices: new Float32Array(0),
      bbox: bb,
      volume: meshVolume(g.mesh),
      closed: isClosedMesh(g.mesh),
      version: g.uid,
    };
  }

  // ------------------------------------------------------------------ eksport

  tessellate(bodyIds: string[], o: MeshExportOptions): TessellatedBody[] {
    const out: TessellatedBody[] = [];
    const mark = this.k.checkpoint();
    for (const id of bodyIds) {
      const g = this.finalState.get(id);
      if (!g) continue;
      const m = g.kind === 'mesh' ? g.mesh : this.brepToMesh(g.shape, o.deflection, o.angular);
      out.push({ id, positions: m.positions.slice(), indices: m.indices.slice() });
    }
    this.k.releaseSince(mark);
    return out;
  }

  /** Kształt do eksportu CAD (siatki zamieniane na ściany trójkątne). */
  cadShape(bodyIds: string[]): ShapeHandle {
    const k = this.k;
    const shapes: ShapeHandle[] = [];
    for (const id of bodyIds) {
      const g = this.finalState.get(id);
      if (!g) continue;
      if (g.kind === 'brep') shapes.push(g.shape);
      else shapes.push(this.meshToBrep(g.mesh));
    }
    if (!shapes.length) throw new Error('Brak brył do eksportu');
    return shapes.length === 1 ? shapes[0] : k.makeCompound(shapes);
  }

  meshToBrep(m: MeshData): ShapeHandle {
    const k = this.k;
    const nt = m.indices.length / 3;
    if (nt > 20000) throw new Error(`Siatka ma ${nt} trójkątów – zamiana na B-rep jest ograniczona do 20 000 trójkątów`);
    const p = m.positions;
    const faces: ShapeHandle[] = [];
    for (let t = 0; t < nt; t++) {
      const a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3;
      try {
        faces.push(k.buildTriFace({ x: p[a], y: p[a + 1], z: p[a + 2] }, { x: p[b], y: p[b + 1], z: p[b + 2] }, { x: p[c], y: p[c + 1], z: p[c + 2] }));
      } catch {
        /* trójkąt zdegenerowany */
      }
    }
    try {
      return k.sewAndSolidify(faces, 1e-4);
    } catch {
      return k.sew(faces, 1e-4);
    }
  }

  exportStep(bodyIds: string[]): string {
    const mark = this.k.checkpoint();
    try {
      return this.k.exportStep(this.cadShape(bodyIds), { unit: 'mm' });
    } finally {
      this.k.releaseSince(mark);
    }
  }

  exportBrep(bodyIds: string[]): string {
    const mark = this.k.checkpoint();
    try {
      return this.k.toBREP(this.cadShape(bodyIds));
    } finally {
      this.k.releaseSince(mark);
    }
  }
}

// ------------------------------------------------------------------ pomocnicze

function need(st: State, id: string): Geom {
  const g = st.get(id);
  if (!g) throw new Error('Bryła nie istnieje (została usunięta lub połączona z inną)');
  return g;
}

function vec(p: Vec3) {
  return { x: p[0], y: p[1], z: p[2] };
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Macierz obracająca oś Z na kierunek d. */
export function alignZTo(d: Vec3): Mat4 {
  const z: Vec3 = [0, 0, 1];
  const n = v3.norm(d);
  const c = v3.dot(z, n);
  if (c > 1 - 1e-12) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  if (c < -1 + 1e-12) return rotationAxis([1, 0, 0], Math.PI);
  const axis = v3.cross(z, n);
  return rotationAxis(axis, Math.acos(c));
}

function edgeInfo(k: OcctKernel, h: ShapeHandle): EdgeInfo {
  const kind = k.curveType(h);
  const { first, last } = k.curveParameters(h);
  const pa = k.curvePointAtParam(h, first);
  const pb = k.curvePointAtParam(h, last);
  const pm = k.curvePointAtParam(h, (first + last) / 2);
  const t = k.curveTangent(h, (first + last) / 2);
  let length = 0;
  try {
    length = k.getLength(h);
  } catch {
    length = 0;
  }
  const info: EdgeInfo = {
    kind,
    mid: [pm.x, pm.y, pm.z],
    dir: v3.norm([t.x, t.y, t.z]),
    a: [pa.x, pa.y, pa.z],
    b: [pb.x, pb.y, pb.z],
    length,
    start: 0,
    count: 0,
  };
  if (kind === 'circle') {
    try {
      const cd = k.curveData(h) as { center: { x: number; y: number; z: number }; radius: number };
      info.center = [cd.center.x, cd.center.y, cd.center.z];
      info.radius = cd.radius;
    } catch {
      /* ignoruj */
    }
  }
  return info;
}

function edgeScore(k: OcctKernel, e: ShapeHandle, ref: EdgeRef): number {
  const { first, last } = k.curveParameters(e);
  const pm = k.curvePointAtParam(e, (first + last) / 2);
  const t = k.curveTangent(e, (first + last) / 2);
  const dir = v3.norm([t.x, t.y, t.z]);
  let sc = v3.dist([pm.x, pm.y, pm.z], ref.mid) + 50 * (1 - Math.abs(v3.dot(dir, ref.dir)));
  if (k.curveType(e) !== ref.kind) sc += 20;
  return sc;
}

function isSeamOrDegenerate(k: OcctKernel, e: ShapeHandle): boolean {
  try {
    return k.getLength(e) < 1e-7;
  } catch {
    return true;
  }
}
