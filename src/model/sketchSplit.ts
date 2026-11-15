// Podział elementów szkicu w punktach przecięć – dzięki temu przecinające się linie, okręgi i łuki
// oraz linie kończące się w połowie innej linii tworzą zamknięte obszary, które można wypełnić.
import { uid, v2 } from './math';
import { arcGeometry, pointMap } from './sketchGeom';
import type { Sketch, SketchEntity, Vec2 } from './types';

/** Tolerancja łączenia punktów i wykrywania styku (mm). */
export const JOIN_TOL = 1e-4;

export type Curve =
  | { kind: 'seg'; a: Vec2; b: Vec2; len: number }
  | { kind: 'circ'; c: Vec2; r: number; a0: number; sweep: number; full: boolean };

export function curveOf(e: SketchEntity, pts: Map<string, Vec2>): Curve | null {
  if (e.type === 'circle') return { kind: 'circ', c: pts.get(e.c)!, r: e.r, a0: 0, sweep: 2 * Math.PI, full: true };
  const a = pts.get(e.a)!, b = pts.get(e.b)!;
  if (e.type === 'line') return { kind: 'seg', a, b, len: v2.dist(a, b) };
  const g = arcGeometry(a, b, e.bulge);
  if (!Number.isFinite(g.r)) return null;
  return { kind: 'circ', c: g.center, r: g.r, a0: g.a0, sweep: g.sweep, full: false };
}

/** Parametr t ∈ [0,1] punktu na krzywej oraz odległość punktu od niej. */
export function project(c: Curve, p: Vec2): { t: number; d: number } {
  if (c.kind === 'seg') {
    const ab = v2.sub(c.b, c.a);
    const l2 = v2.dot(ab, ab);
    const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, v2.dot(v2.sub(p, c.a), ab) / l2));
    return { t, d: v2.dist(p, v2.add(c.a, v2.scale(ab, t))) };
  }
  const ang = Math.atan2(p[1] - c.c[1], p[0] - c.c[0]);
  const t = angleParam(c, ang);
  const radial = Math.abs(v2.dist(p, c.c) - c.r);
  if (t !== null) return { t, d: radial };
  // poza zakresem łuku – najbliższy koniec
  const e0 = pointAt(c, 0), e1 = pointAt(c, 1);
  const d0 = v2.dist(p, e0), d1 = v2.dist(p, e1);
  return d0 < d1 ? { t: 0, d: d0 } : { t: 1, d: d1 };
}

/** Parametr kąta na łuku/okręgu albo null, gdy kąt leży poza łukiem. */
function angleParam(c: Extract<Curve, { kind: 'circ' }>, ang: number): number | null {
  const tw = 2 * Math.PI;
  if (c.full) return (((ang % tw) + tw) % tw) / tw;
  let d = (ang - c.a0) * Math.sign(c.sweep);
  d = ((d % tw) + tw) % tw;
  const span = Math.abs(c.sweep);
  const tolAng = JOIN_TOL / Math.max(c.r, 1e-9);
  if (d <= span + tolAng) return Math.min(1, d / span);
  if (d >= tw - tolAng) return 0;
  return null;
}

export function pointAt(c: Curve, t: number): Vec2 {
  if (c.kind === 'seg') return v2.add(c.a, v2.scale(v2.sub(c.b, c.a), t));
  const ang = c.a0 + c.sweep * t;
  return [c.c[0] + c.r * Math.cos(ang), c.c[1] + c.r * Math.sin(ang)];
}

function curveLength(c: Curve): number {
  return c.kind === 'seg' ? c.len : Math.abs(c.sweep) * c.r;
}

/** Punkty przecięcia dwóch krzywych (bez nakładania się odcinków współliniowych – to obsługuje test styku końców). */
export function intersections(p: Curve, q: Curve): Vec2[] {
  if (p.kind === 'seg' && q.kind === 'seg') {
    const r = v2.sub(p.b, p.a), s = v2.sub(q.b, q.a);
    const den = v2.cross(r, s);
    if (Math.abs(den) < 1e-12 * (p.len * q.len + 1e-12)) return [];
    const qp = v2.sub(q.a, p.a);
    const t = v2.cross(qp, s) / den;
    const u = v2.cross(qp, r) / den;
    const et = JOIN_TOL / Math.max(p.len, 1e-12), eu = JOIN_TOL / Math.max(q.len, 1e-12);
    if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) return [];
    return [pointAt(p, Math.max(0, Math.min(1, t)))];
  }
  if (p.kind === 'circ' && q.kind === 'seg') return intersections(q, p);
  if (p.kind === 'seg' && q.kind === 'circ') {
    const d = v2.sub(p.b, p.a);
    const f = v2.sub(p.a, q.c);
    const A = v2.dot(d, d), B = 2 * v2.dot(f, d), C = v2.dot(f, f) - q.r * q.r;
    if (A < 1e-18) return [];
    let disc = B * B - 4 * A * C;
    const tolDisc = 4 * A * 2 * q.r * JOIN_TOL;
    if (disc < -tolDisc) return [];
    disc = Math.max(0, disc);
    const sq = Math.sqrt(disc);
    const ts = disc === 0 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
    const et = JOIN_TOL / Math.sqrt(A);
    const out: Vec2[] = [];
    for (const t of ts) {
      if (t < -et || t > 1 + et) continue;
      const pt = pointAt(p, Math.max(0, Math.min(1, t)));
      if (angleParam(q, Math.atan2(pt[1] - q.c[1], pt[0] - q.c[0])) !== null) out.push(pt);
    }
    return out;
  }
  if (p.kind === 'circ' && q.kind === 'circ') {
    const dvec = v2.sub(q.c, p.c);
    const d = v2.len(dvec);
    if (d < 1e-12) return [];
    if (d > p.r + q.r + JOIN_TOL || d < Math.abs(p.r - q.r) - JOIN_TOL) return [];
    const a = (p.r * p.r - q.r * q.r + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, p.r * p.r - a * a));
    const u = v2.scale(dvec, 1 / d);
    const m = v2.add(p.c, v2.scale(u, a));
    const n = v2.perp(u);
    const cands: Vec2[] = h < JOIN_TOL ? [m] : [v2.add(m, v2.scale(n, h)), v2.sub(m, v2.scale(n, h))];
    return cands.filter(
      (pt) =>
        angleParam(p, Math.atan2(pt[1] - p.c[1], pt[0] - p.c[0])) !== null &&
        angleParam(q, Math.atan2(pt[1] - q.c[1], pt[0] - q.c[0])) !== null,
    );
  }
  return [];
}

function endpointIds(e: SketchEntity): string[] {
  return e.type === 'circle' ? [] : [e.a, e.b];
}

/**
 * Łączy pokrywające się punkty i dzieli elementy w miejscach przecięć oraz styku (koniec linii na innej
 * linii). Zachowuje wypełnienia: element podzielony w pętli zastępowany jest wszystkimi częściami.
 * Zwraca liczbę dodanych punktów podziału.
 */
export function splitAtIntersections(sk: Sketch): number {
  mergeCoincident(sk);
  const pts = pointMap(sk);
  const ents = sk.entities.filter((e) => e.type === 'circle' || e.a !== e.b);
  const curves = new Map<string, Curve>();
  for (const e of ents) {
    const c = curveOf(e, pts);
    if (c) curves.set(e.id, c);
  }
  // punkty podziału dla każdego elementu
  const cuts = new Map<string, Vec2[]>();
  const addCut = (id: string, p: Vec2) => {
    if (!cuts.has(id)) cuts.set(id, []);
    cuts.get(id)!.push(p);
  };
  const list = ents.filter((e) => curves.has(e.id));
  for (let i = 0; i < list.length; i++) {
    const ci = curves.get(list[i].id)!;
    for (let j = i + 1; j < list.length; j++) {
      const cj = curves.get(list[j].id)!;
      for (const p of intersections(ci, cj)) {
        addCut(list[i].id, p);
        addCut(list[j].id, p);
      }
    }
  }
  // styk: koniec jednego elementu leżący na innym
  for (const e of list) {
    for (const pid of endpointIds(e)) {
      const p = pts.get(pid)!;
      for (const o of list) {
        if (o === e) continue;
        if (project(curves.get(o.id)!, p).d < JOIN_TOL) addCut(o.id, p);
      }
    }
  }

  // rejestr punktów: istniejący punkt w tej samej pozycji albo nowy
  const used = new Set<string>();
  for (const e of sk.entities) for (const id of endpointIds(e)) used.add(id);
  const pointFor = (p: Vec2): string => {
    for (const q of sk.points) if (used.has(q.id) && Math.hypot(q.x - p[0], q.y - p[1]) < JOIN_TOL) return q.id;
    const id = uid('p');
    sk.points.push({ id, x: p[0], y: p[1] });
    used.add(id);
    return id;
  };

  let added = 0;
  const replaced = new Map<string, string[]>();
  const dissolved = new Set<string>();
  const out: SketchEntity[] = [];
  for (const e of sk.entities) {
    const c = curves.get(e.id);
    const raw = cuts.get(e.id);
    if (!c || !raw?.length) {
      out.push(e);
      continue;
    }
    const L = curveLength(c);
    const ts: number[] = [];
    for (const p of raw) {
      const { t } = project(c, p);
      if (c.kind === 'circ' && c.full) {
        ts.push(t);
        continue;
      }
      if (t * L > JOIN_TOL && (1 - t) * L > JOIN_TOL) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    const uniq: number[] = [];
    for (const t of ts) if (!uniq.length || (t - uniq[uniq.length - 1]) * L > JOIN_TOL) uniq.push(t);
    if (c.kind === 'circ' && c.full) {
      // zawinięcie: pierwszy i ostatni podział w tym samym miejscu
      if (uniq.length > 1 && (1 - uniq[uniq.length - 1] + uniq[0]) * L <= JOIN_TOL) uniq.pop();
      if (uniq.length < 2) {
        out.push(e);
        continue;
      }
    } else if (!uniq.length) {
      out.push(e);
      continue;
    }
    added += uniq.length;
    const pieces: SketchEntity[] = [];
    if (e.type === 'circle') {
      const ids = uniq.map((t) => pointFor(pointAt(c, t)));
      for (let k = 0; k < uniq.length; k++) {
        const t0 = uniq[k];
        const t1 = k + 1 < uniq.length ? uniq[k + 1] : uniq[0] + 1;
        const sweep = (t1 - t0) * 2 * Math.PI;
        pieces.push({ id: k === 0 ? e.id : uid('e'), type: 'arc', a: ids[k], b: ids[(k + 1) % ids.length], bulge: Math.tan(sweep / 4) });
      }
    } else {
      const chain = [e.a, ...uniq.map((t) => pointFor(pointAt(c, t))), e.b];
      const tt = [0, ...uniq, 1];
      for (let k = 0; k + 1 < chain.length; k++) {
        if (chain[k] === chain[k + 1]) continue;
        const id = k === 0 ? e.id : uid('e');
        if (e.type === 'line') pieces.push({ id, type: 'line', a: chain[k], b: chain[k + 1] });
        else if (c.kind === 'circ') pieces.push({ id, type: 'arc', a: chain[k], b: chain[k + 1], bulge: Math.tan(((tt[k + 1] - tt[k]) * c.sweep) / 4) });
      }
      if (e.group) dissolved.add(e.group);
    }
    replaced.set(e.id, pieces.map((p) => p.id));
    out.push(...pieces);
  }
  sk.entities = out;
  if (dissolved.size) {
    for (const x of sk.entities) if (x.group && dissolved.has(x.group)) delete x.group;
    sk.groups = sk.groups.filter((g) => !dissolved.has(g.id));
  }
  if (replaced.size)
    for (const pr of sk.profiles) pr.loops = pr.loops.map((l) => l.flatMap((id) => replaced.get(id) ?? [id]));
  dedupeLines(sk);
  // środki okręgów zamienionych na łuki nie są już potrzebne
  const live = new Set<string>();
  for (const e of sk.entities) for (const id of e.type === 'circle' ? [e.c] : [e.a, e.b]) live.add(id);
  sk.points = sk.points.filter((p) => live.has(p.id));
  return added;
}

/** Łączy różne punkty leżące w tym samym miejscu (np. narożniki dwóch prostokątów). */
function mergeCoincident(sk: Sketch) {
  const used = new Set<string>();
  for (const e of sk.entities) for (const id of endpointIds(e)) used.add(id);
  const pts = sk.points.filter((p) => used.has(p.id));
  const remap = new Map<string, string>();
  for (let i = 0; i < pts.length; i++) {
    if (remap.has(pts[i].id)) continue;
    for (let j = i + 1; j < pts.length; j++) {
      if (remap.has(pts[j].id)) continue;
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < JOIN_TOL) remap.set(pts[j].id, pts[i].id);
    }
  }
  if (!remap.size) return;
  const r = (id: string) => remap.get(id) ?? id;
  for (const e of sk.entities) {
    if (e.type !== 'circle') {
      e.a = r(e.a);
      e.b = r(e.b);
    }
  }
  sk.entities = sk.entities.filter((e) => e.type === 'circle' || e.a !== e.b);
  for (const g of sk.groups) g.points = g.points.map(r) as never;
  sk.groups = sk.groups.filter((g) => new Set(g.points).size === g.points.length);
  sk.points = sk.points.filter((p) => !remap.has(p.id));
}

const viewCache = new WeakMap<Sketch, { key: string; split: Sketch }>();

/**
 * Kopia szkicu po podziale w punktach przecięć (bez zmiany oryginału), z pamięcią podręczną
 * zależną od zawartości – do podglądu wypełnienia i wykrywania przerw.
 */
export function splitView(sk: Sketch): Sketch {
  const key = JSON.stringify([sk.points, sk.entities]);
  const c = viewCache.get(sk);
  if (c && c.key === key) return c.split;
  const split = structuredClone(sk);
  splitAtIntersections(split);
  viewCache.set(sk, { key, split });
  return split;
}

/** Usuwa zdublowane linie między tą samą parą punktów (np. po podziale nakładających się odcinków). */
function dedupeLines(sk: Sketch) {
  const seen = new Map<string, string>();
  const alias = new Map<string, string>();
  sk.entities = sk.entities.filter((e) => {
    if (e.type !== 'line') return true;
    const k = [e.a, e.b].sort().join('|');
    const prev = seen.get(k);
    if (prev) {
      alias.set(e.id, prev);
      return false;
    }
    seen.set(k, e.id);
    return true;
  });
  if (!alias.size) return;
  for (const pr of sk.profiles) pr.loops = pr.loops.map((l) => [...new Set(l.map((id) => alias.get(id) ?? id))]);
}
