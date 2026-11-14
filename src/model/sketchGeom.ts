// Geometria szkicu: łuki, uporządkowanie pętli, wykrywanie zamkniętych konturów i przerw.
import { v2, v3, planeY } from './math';
import type { Plane, Sketch, SketchEntity, Vec2, Vec3 } from './types';

export const SKETCH_TOL = 1e-6;

export function pointMap(sk: Sketch): Map<string, Vec2> {
  const m = new Map<string, Vec2>();
  for (const p of sk.points) m.set(p.id, [p.x, p.y]);
  return m;
}

/** Środek, promień i kąty łuku a→b o danym bulge. */
export function arcGeometry(a: Vec2, b: Vec2, bulge: number) {
  const chord = v2.sub(b, a);
  const h = v2.len(chord) / 2;
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const left = v2.perp(v2.norm(chord));
  const d = (h * (1 - bulge * bulge)) / (2 * bulge);
  const center = v2.add(mid, v2.scale(left, d));
  const r = Math.hypot(a[0] - center[0], a[1] - center[1]);
  const a0 = Math.atan2(a[1] - center[1], a[0] - center[0]);
  const sweep = 4 * Math.atan(bulge); // >0 CCW
  const midPt = v2.sub(mid, v2.scale(left, bulge * h));
  return { center, r, a0, sweep, mid: midPt };
}

/** bulge łuku przez trzy punkty (start, punkt pośredni, koniec). */
export function bulgeFrom3(a: Vec2, m: Vec2, b: Vec2): number | null {
  const cr = v2.cross(v2.sub(m, a), v2.sub(b, a));
  if (Math.abs(cr) < 1e-12) return null;
  // Środek okręgu przez 3 punkty
  const ax = a[0], ay = a[1], bx = m[0], by = m[1], cx = b[0], cy = b[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const c: Vec2 = [ux, uy];
  return bulgeFromCenter(c, a, b, cr > 0 ? 1 : -1);
}

/** bulge łuku o środku c od a do b; dir=1 przeciwnie do wskazówek zegara. */
export function bulgeFromCenter(c: Vec2, a: Vec2, b: Vec2, dir: 1 | -1): number {
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  const a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  let sweep = a1 - a0;
  if (dir > 0) {
    while (sweep <= 0) sweep += 2 * Math.PI;
  } else {
    while (sweep >= 0) sweep -= 2 * Math.PI;
  }
  return Math.tan(sweep / 4);
}

/** Próbkowanie łuku do wyświetlania. */
export function sampleArc(a: Vec2, b: Vec2, bulge: number, segs = 32): Vec2[] {
  const g = arcGeometry(a, b, bulge);
  const n = Math.max(4, Math.ceil((segs * Math.abs(g.sweep)) / Math.PI));
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = g.a0 + (g.sweep * i) / n;
    pts.push([g.center[0] + g.r * Math.cos(t), g.center[1] + g.r * Math.sin(t)]);
  }
  pts[0] = a;
  pts[n] = b;
  return pts;
}

export function toWorld(plane: Plane, p: Vec2): Vec3 {
  const y = planeY(plane.normal, plane.xDir);
  return v3.add(plane.origin, v3.add(v3.scale(plane.xDir, p[0]), v3.scale(y, p[1])));
}

export function toPlane(plane: Plane, p: Vec3): Vec2 {
  const y = planeY(plane.normal, plane.xDir);
  const d = v3.sub(p, plane.origin);
  return [v3.dot(d, plane.xDir), v3.dot(d, y)];
}

// ---------------- Pętle ----------------

export type LoopSeg =
  | { type: 'line'; p0: Vec2; p1: Vec2 }
  | { type: 'arc'; p0: Vec2; p1: Vec2; bulge: number }
  | { type: 'circle'; c: Vec2; r: number };

/** Porządkuje elementy pętli w ciągłą ścieżkę. Rzuca błąd, gdy pętla nie jest zamknięta. */
export function orderLoop(sk: Sketch, ids: string[]): LoopSeg[] {
  const pts = pointMap(sk);
  const ents = ids.map((id) => {
    const e = sk.entities.find((x) => x.id === id);
    if (!e) throw new Error('Brak elementu szkicu ' + id);
    return e;
  });
  if (ents.length === 1 && ents[0].type === 'circle') {
    const c = ents[0];
    return [{ type: 'circle', c: pts.get(c.c)!, r: c.r }];
  }
  const rest = ents.slice();
  const first = rest.shift()!;
  if (first.type === 'circle') throw new Error('Okrąg nie może być częścią pętli z innymi elementami');
  const out: { e: SketchEntity; rev: boolean }[] = [{ e: first, rev: false }];
  let cur = first.b;
  const start = first.a;
  while (rest.length) {
    const i = rest.findIndex((e) => e.type !== 'circle' && (e.a === cur || e.b === cur));
    if (i < 0) throw new Error('Kontur nie jest ciągły');
    const e = rest.splice(i, 1)[0] as Exclude<SketchEntity, { type: 'circle' }>;
    const rev = e.b === cur;
    out.push({ e, rev });
    cur = rev ? e.a : e.b;
  }
  if (cur !== start) throw new Error('Kontur nie jest zamknięty');
  return out.map(({ e, rev }) => {
    const ee = e as Exclude<SketchEntity, { type: 'circle' }>;
    const p0 = pts.get(rev ? ee.b : ee.a)!;
    const p1 = pts.get(rev ? ee.a : ee.b)!;
    if (ee.type === 'line') return { type: 'line', p0, p1 };
    return { type: 'arc', p0, p1, bulge: rev ? -ee.bulge : ee.bulge };
  });
}

/** Wielokąt przybliżający pętlę (do testów zawierania i pola). */
export function loopPolygon(segs: LoopSeg[]): Vec2[] {
  const poly: Vec2[] = [];
  for (const s of segs) {
    if (s.type === 'circle') {
      for (let i = 0; i < 64; i++) {
        const t = (i / 64) * Math.PI * 2;
        poly.push([s.c[0] + s.r * Math.cos(t), s.c[1] + s.r * Math.sin(t)]);
      }
    } else if (s.type === 'line') {
      poly.push(s.p0);
    } else {
      const pts = sampleArc(s.p0, s.p1, s.bulge, 24);
      pts.pop();
      poly.push(...pts);
    }
  }
  return poly;
}

export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Krawędzie grafu szkicu (bez okręgów). */
function graph(sk: Sketch) {
  const adj = new Map<string, string[]>(); // punkt -> elementy
  for (const e of sk.entities) {
    if (e.type === 'circle') continue;
    if (e.a === e.b) continue;
    for (const p of [e.a, e.b]) {
      if (!adj.has(p)) adj.set(p, []);
      adj.get(p)!.push(e.id);
    }
  }
  return adj;
}

/** Punkty, w których kontur się urywa (stopień 1). */
export function danglingPoints(sk: Sketch): string[] {
  const adj = graph(sk);
  return [...adj.entries()].filter(([, es]) => es.length === 1).map(([p]) => p);
}

/** Pary niedomkniętych końców leżących najbliżej siebie (wskazanie przerwy). */
export function gaps(sk: Sketch): { a: Vec2; b: Vec2; distance: number }[] {
  const pts = pointMap(sk);
  const ends = danglingPoints(sk).map((id) => ({ id, p: pts.get(id)! }));
  const used = new Set<string>();
  const out: { a: Vec2; b: Vec2; distance: number }[] = [];
  const pairs: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) pairs.push({ i, j, d: v2.dist(ends[i].p, ends[j].p) });
  pairs.sort((x, y) => x.d - y.d);
  for (const pr of pairs) {
    if (used.has(ends[pr.i].id) || used.has(ends[pr.j].id)) continue;
    used.add(ends[pr.i].id);
    used.add(ends[pr.j].id);
    out.push({ a: ends[pr.i].p, b: ends[pr.j].p, distance: pr.d });
  }
  for (const e of ends) if (!used.has(e.id)) out.push({ a: e.p, b: e.p, distance: 0 });
  return out;
}

/**
 * Wszystkie proste zamknięte pętle szkicu (cykle grafu w składowych, w których każdy punkt ma
 * stopień 2) oraz okręgi. Składowe z rozgałęzieniami rozwiązywane są przez wybór najmniejszych
 * obszarów (ściany grafu płaskiego).
 */
export function findLoops(sk: Sketch): { ids: string[]; poly: Vec2[]; area: number }[] {
  const pts = pointMap(sk);
  const loops: { ids: string[]; poly: Vec2[]; area: number }[] = [];
  for (const e of sk.entities) {
    if (e.type === 'circle') {
      const poly = loopPolygon([{ type: 'circle', c: pts.get(e.c)!, r: e.r }]);
      loops.push({ ids: [e.id], poly, area: Math.abs(polygonArea(poly)) });
    }
  }
  // Ściany grafu płaskiego: dla każdej półkrawędzi idziemy, skręcając maksymalnie w prawo.
  type Half = { ent: string; from: string; to: string; angOut: number; angIn: number };
  const halves: Half[] = [];
  for (const e of sk.entities) {
    if (e.type === 'circle' || e.a === e.b) continue;
    const a = pts.get(e.a)!;
    const b = pts.get(e.b)!;
    let dirA: Vec2, dirB: Vec2; // kierunki wyjścia z a oraz z b
    if (e.type === 'line') {
      dirA = v2.sub(b, a);
      dirB = v2.sub(a, b);
    } else {
      const s = sampleArc(a, b, e.bulge, 16);
      dirA = v2.sub(s[1], s[0]);
      dirB = v2.sub(s[s.length - 2], s[s.length - 1]);
    }
    const angA = Math.atan2(dirA[1], dirA[0]);
    const angB = Math.atan2(dirB[1], dirB[0]);
    halves.push({ ent: e.id, from: e.a, to: e.b, angOut: angA, angIn: angB });
    halves.push({ ent: e.id, from: e.b, to: e.a, angOut: angB, angIn: angA });
  }
  const outOf = new Map<string, Half[]>();
  for (const h of halves) {
    if (!outOf.has(h.from)) outOf.set(h.from, []);
    outOf.get(h.from)!.push(h);
  }
  const visited = new Set<Half>();
  for (const h0 of halves) {
    if (visited.has(h0)) continue;
    const cycle: Half[] = [];
    let h = h0;
    let ok = true;
    for (let guard = 0; guard < 10000; guard++) {
      visited.add(h);
      cycle.push(h);
      const outs = outOf.get(h.to) ?? [];
      // kierunek przyjścia (odwrócony): z punktu docelowego wstecz
      const back = h.angIn;
      // wybieramy krawędź najbliższą zgodnie z ruchem wskazówek od kierunku powrotu,
      // dzięki czemu obszar ograniczony leży po lewej stronie (obieg przeciwny do wskazówek)
      let best: Half | null = null;
      let bestTurn = -Infinity;
      for (const o of outs) {
        if (o.ent === h.ent && outs.length > 1) continue;
        let turn = o.angOut - back; // kąt CCW od kierunku wstecz
        while (turn <= 1e-9) turn += 2 * Math.PI;
        while (turn > 2 * Math.PI + 1e-9) turn -= 2 * Math.PI;
        if (turn > bestTurn) {
          bestTurn = turn;
          best = o;
        }
      }
      if (!best || (best.ent === h.ent && outs.length === 1)) {
        ok = false;
        break;
      }
      h = best;
      if (h === h0) break;
      if (visited.has(h)) {
        ok = false;
        break;
      }
    }
    if (!ok || cycle.length < 2) continue;
    const ids = cycle.map((c) => c.ent);
    if (new Set(ids).size !== ids.length) continue;
    // wielokąt w kierunku obiegu (znak pola rozróżnia obszary ograniczone od zewnętrznego)
    const segs: LoopSeg[] = cycle.map((c) => {
      const e = sk.entities.find((x) => x.id === c.ent)!;
      const p0 = pts.get(c.from)!;
      const p1 = pts.get(c.to)!;
      if (e.type === 'arc') return { type: 'arc', p0, p1, bulge: c.from === e.a ? e.bulge : -e.bulge };
      return { type: 'line', p0, p1 };
    });
    const poly = loopPolygon(segs);
    const area = polygonArea(poly);
    // Ściany wewnętrzne mają dodatnie pole przy tej konwencji obchodzenia; zewnętrzna – ujemne.
    if (area > 1e-9) loops.push({ ids, poly, area });
  }
  return loops;
}

/** Wybór obszaru do wypełnienia wskazanego punktem: najmniejsza pętla zawierająca punkt + otwory w niej. */
export function regionAt(sk: Sketch, pt: Vec2): string[][] | null {
  const loops = findLoops(sk);
  const containing = loops.filter((l) => pointInPolygon(pt, l.poly)).sort((a, b) => a.area - b.area);
  if (!containing.length) return null;
  const outer = containing[0];
  // otwory: pętle wewnątrz outer, nie zawierające punktu, maksymalne (nie zawarte w innych otworach)
  const inner = loops.filter(
    (l) => l !== outer && l.area < outer.area && pointInPolygon(l.poly[0], outer.poly) && !pointInPolygon(pt, l.poly) && !shareEntity(l.ids, outer.ids),
  );
  const holes = inner.filter((l) => !inner.some((o) => o !== l && o.area > l.area && pointInPolygon(l.poly[0], o.poly)));
  return [outer.ids, ...holes.map((h) => h.ids)];
}

function shareEntity(a: string[], b: string[]) {
  return a.some((x) => b.includes(x));
}

/** Wszystkie obszary szkicu (każda najmniejsza pętla z otworami). */
export function allRegions(sk: Sketch): string[][][] {
  const loops = findLoops(sk);
  return loops.map((outer) => {
    const inner = loops.filter(
      (l) => l !== outer && l.area < outer.area && pointInPolygon(l.poly[0], outer.poly) && !shareEntity(l.ids, outer.ids),
    );
    const holes = inner.filter((l) => !inner.some((o) => o !== l && o.area > l.area && pointInPolygon(l.poly[0], o.poly)));
    return [outer.ids, ...holes.map((h) => h.ids)];
  });
}

/** Dokładne pole pętli (wielokąt cięciw + odcinki kołowe łuków); znak zgodny z kierunkiem obiegu. */
export function loopArea(segs: LoopSeg[]): number {
  let a = 0;
  for (const s of segs) {
    if (s.type === 'circle') return Math.PI * s.r * s.r;
    a += (s.p0[0] * s.p1[1] - s.p1[0] * s.p0[1]) / 2;
    if (s.type === 'arc') {
      const g = arcGeometry(s.p0, s.p1, s.bulge);
      const th = Math.abs(g.sweep);
      a += Math.sign(g.sweep) * ((g.r * g.r) / 2) * (th - Math.sin(th));
    }
  }
  return a;
}
