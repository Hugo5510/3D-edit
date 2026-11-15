// Operacje edycji szkicu (czyste funkcje modyfikujące kopię szkicu w miejscu).
import { uid, v2, rad } from './math';
import type { ArcEntity, LineEntity, PolygonGroup, RectGroup, Sketch, SketchEntity, Vec2 } from './types';
import { arcGeometry, bulgeFromCenter, loopPolygon, orderLoop, pointMap, regionAt, allRegions } from './sketchGeom';
import { curveOf, pointAt, project, splitAtIntersections, splitView } from './sketchSplit';

export interface PointSpec {
  /** Istniejący punkt, z którym nowy punkt ma się połączyć (wspólny wierzchołek). */
  id?: string;
  x: number;
  y: number;
}

export function getPoint(sk: Sketch, id: string) {
  const p = sk.points.find((q) => q.id === id);
  if (!p) throw new Error('Brak punktu ' + id);
  return p;
}

/** Zwraca id punktu: istniejący (gdy spec.id) albo nowo dodany. */
export function ensurePoint(sk: Sketch, spec: PointSpec): string {
  if (spec.id && sk.points.some((p) => p.id === spec.id)) return spec.id;
  const id = uid('p');
  sk.points.push({ id, x: spec.x, y: spec.y });
  return id;
}

export function addLine(sk: Sketch, a: PointSpec, b: PointSpec): { line: LineEntity; a: string; b: string } | null {
  const ia = ensurePoint(sk, a);
  const ib = ensurePoint(sk, b);
  if (ia === ib) return null;
  const pa = getPoint(sk, ia), pb = getPoint(sk, ib);
  if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < 1e-6) return null;
  const line: LineEntity = { id: uid('e'), type: 'line', a: ia, b: ib };
  sk.entities.push(line);
  return { line, a: ia, b: ib };
}

export function addRect(sk: Sketch, c1: PointSpec, c2: PointSpec): RectGroup | null {
  if (Math.abs(c1.x - c2.x) < 1e-6 || Math.abs(c1.y - c2.y) < 1e-6) return null;
  const p0 = ensurePoint(sk, c1);
  const p1 = ensurePoint(sk, { x: c2.x, y: c1.y });
  const p2 = ensurePoint(sk, c2);
  const p3 = ensurePoint(sk, { x: c1.x, y: c2.y });
  const g: RectGroup = { id: uid('g'), kind: 'rect', points: [p0, p1, p2, p3] };
  const ids = [p0, p1, p2, p3];
  for (let i = 0; i < 4; i++) sk.entities.push({ id: uid('e'), type: 'line', a: ids[i], b: ids[(i + 1) % 4], group: g.id });
  sk.groups.push(g);
  return g;
}

export function addCircle(sk: Sketch, c: PointSpec, r: number) {
  if (!(r > 1e-6)) return null;
  const ic = ensurePoint(sk, c);
  const e: SketchEntity = { id: uid('e'), type: 'circle', c: ic, r };
  sk.entities.push(e);
  return e;
}

export function polygonPoints(center: Vec2, radius: number, n: number, rotationDeg: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = rad(rotationDeg) + (i / n) * Math.PI * 2;
    out.push([center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)]);
  }
  return out;
}

export function addPolygon(sk: Sketch, center: Vec2, radius: number, n: number, rotationDeg: number): PolygonGroup | null {
  if (!(radius > 1e-6) || n < 3) return null;
  const pts = polygonPoints(center, radius, n, rotationDeg).map((p) => ensurePoint(sk, { x: p[0], y: p[1] }));
  const g: PolygonGroup = { id: uid('g'), kind: 'polygon', points: pts, center, radius, rotation: rotationDeg };
  for (let i = 0; i < n; i++) sk.entities.push({ id: uid('e'), type: 'line', a: pts[i], b: pts[(i + 1) % n], group: g.id });
  sk.groups.push(g);
  return g;
}

export function addArc(sk: Sketch, a: PointSpec, b: PointSpec, bulge: number): ArcEntity | null {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-9) return null;
  const ia = ensurePoint(sk, a);
  const ib = ensurePoint(sk, b);
  if (ia === ib) return null;
  const e: ArcEntity = { id: uid('e'), type: 'arc', a: ia, b: ib, bulge };
  sk.entities.push(e);
  return e;
}

/** Łączy punkt `from` z punktem `into` (wszystkie odwołania przechodzą na `into`). */
export function mergePoints(sk: Sketch, from: string, into: string) {
  if (from === into) return;
  for (const e of sk.entities) {
    if (e.type === 'circle') {
      if (e.c === from) e.c = into;
    } else {
      if (e.a === from) e.a = into;
      if (e.b === from) e.b = into;
    }
  }
  // elementy zdegenerowane (linia z punktu do tego samego punktu)
  sk.entities = sk.entities.filter((e) => e.type === 'circle' || e.a !== e.b);
  // usunięcie duplikatów linii między tą samą parą punktów
  const seen = new Set<string>();
  sk.entities = sk.entities.filter((e) => {
    if (e.type !== 'line') return true;
    const k = [e.a, e.b].sort().join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const g of sk.groups) g.points = g.points.map((p) => (p === from ? into : p)) as never;
  sk.groups = sk.groups.filter((g) => new Set(g.points).size === g.points.length);
  sk.points = sk.points.filter((p) => p.id !== from);
  cleanupProfiles(sk);
}

/** Przesuwa punkt z zachowaniem grup (prostokąt pozostaje prostokątem, wielokąt foremnym). */
export function movePoint(sk: Sketch, id: string, to: Vec2) {
  const g = sk.groups.find((x) => x.points.includes(id as never));
  if (g?.kind === 'rect') {
    const pts = g.points.map((pid) => getPoint(sk, pid));
    const i = g.points.indexOf(id as never);
    const opp = pts[(i + 2) % 4];
    // lokalny układ prostokąta: u wzdłuż p0→p1
    const u = v2.norm([pts[1].x - pts[0].x, pts[1].y - pts[0].y]);
    const w: Vec2 = v2.perp(u);
    const d: Vec2 = [to[0] - opp.x, to[1] - opp.y];
    const du = v2.dot(d, u), dw = v2.dot(d, w);
    // narożniki sąsiednie: opp + du*u oraz opp + dw*w
    const nA: Vec2 = [opp.x + u[0] * du, opp.y + u[1] * du];
    const nB: Vec2 = [opp.x + w[0] * dw, opp.y + w[1] * dw];
    const cur = pts[i];
    cur.x = to[0];
    cur.y = to[1];
    // który sąsiad leży wzdłuż u od narożnika przeciwległego
    const nb1 = pts[(i + 1) % 4], nb3 = pts[(i + 3) % 4];
    const along1 = Math.abs(v2.dot([nb1.x - opp.x, nb1.y - opp.y], u)) > Math.abs(v2.dot([nb1.x - opp.x, nb1.y - opp.y], w));
    const [pu, pw] = along1 ? [nb1, nb3] : [nb3, nb1];
    pu.x = nA[0];
    pu.y = nA[1];
    pw.x = nB[0];
    pw.y = nB[1];
    return;
  }
  if (g?.kind === 'polygon') {
    const r = v2.dist(to, g.center);
    if (r < 1e-6) return;
    const i = g.points.indexOf(id);
    const ang = (Math.atan2(to[1] - g.center[1], to[0] - g.center[0]) * 180) / Math.PI - (360 * i) / g.points.length;
    g.radius = r;
    g.rotation = ang;
    applyPolygon(sk, g);
    return;
  }
  const p = getPoint(sk, id);
  p.x = to[0];
  p.y = to[1];
}

export function applyPolygon(sk: Sketch, g: PolygonGroup) {
  const pts = polygonPoints(g.center, g.radius, g.points.length, g.rotation);
  g.points.forEach((pid, i) => {
    const p = getPoint(sk, pid);
    p.x = pts[i][0];
    p.y = pts[i][1];
  });
}

/** Zmienia liczbę boków wielokąta (przebudowuje jego linie). */
export function setPolygonSides(sk: Sketch, groupId: string, n: number) {
  const g = sk.groups.find((x) => x.id === groupId) as PolygonGroup | undefined;
  if (!g || n < 3 || n > 200) return;
  removeGroupEntities(sk, g.id);
  const ng = addPolygon(sk, g.center, g.radius, n, g.rotation);
  if (ng) ng.id = g.id;
  sk.groups = sk.groups.filter((x) => x !== g);
  cleanupProfiles(sk);
}

function removeGroupEntities(sk: Sketch, gid: string) {
  sk.entities = sk.entities.filter((e) => e.group !== gid);
  removeOrphanPoints(sk);
}

export function setRectSize(sk: Sketch, groupId: string, width: number, height: number) {
  const g = sk.groups.find((x) => x.id === groupId) as RectGroup | undefined;
  if (!g || !(width > 0) || !(height > 0)) return;
  const [p0, p1, p2, p3] = g.points.map((id) => getPoint(sk, id));
  const u = v2.norm([p1.x - p0.x, p1.y - p0.y]);
  let w = v2.norm([p3.x - p0.x, p3.y - p0.y]);
  if (v2.len(w) < 0.5) w = v2.perp(u);
  p1.x = p0.x + u[0] * width;
  p1.y = p0.y + u[1] * width;
  p3.x = p0.x + w[0] * height;
  p3.y = p0.y + w[1] * height;
  p2.x = p1.x + w[0] * height;
  p2.y = p1.y + w[1] * height;
}

export function rectSize(sk: Sketch, g: RectGroup): [number, number] {
  const [p0, p1, , p3] = g.points.map((id) => getPoint(sk, id));
  return [Math.hypot(p1.x - p0.x, p1.y - p0.y), Math.hypot(p3.x - p0.x, p3.y - p0.y)];
}

/** Ustawia długość linii, przesuwając punkt końcowy b wzdłuż kierunku. */
export function setLineLength(sk: Sketch, lineId: string, len: number) {
  const e = sk.entities.find((x) => x.id === lineId);
  if (!e || e.type !== 'line' || !(len > 0)) return;
  const a = getPoint(sk, e.a), b = getPoint(sk, e.b);
  const d = v2.norm([b.x - a.x, b.y - a.y]);
  b.x = a.x + d[0] * len;
  b.y = a.y + d[1] * len;
}

export function setLineAngle(sk: Sketch, lineId: string, deg: number) {
  const e = sk.entities.find((x) => x.id === lineId);
  if (!e || e.type !== 'line') return;
  const a = getPoint(sk, e.a), b = getPoint(sk, e.b);
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  b.x = a.x + l * Math.cos(rad(deg));
  b.y = a.y + l * Math.sin(rad(deg));
}

/** Zmienia promień łuku z zachowaniem punktów końcowych i strony wybrzuszenia. */
export function setArcRadius(sk: Sketch, arcId: string, r: number) {
  const e = sk.entities.find((x) => x.id === arcId);
  if (!e || e.type !== 'arc') return;
  const a = getPoint(sk, e.a), b = getPoint(sk, e.b);
  const half = Math.hypot(b.x - a.x, b.y - a.y) / 2;
  if (r < half - 1e-9) throw new Error(`Promień musi być ≥ połowy cięciwy (${half.toFixed(2)} mm)`);
  const minor = Math.abs(e.bulge) <= 1;
  let sweep = 2 * Math.asin(Math.min(1, half / r));
  if (!minor) sweep = 2 * Math.PI - sweep;
  e.bulge = Math.sign(e.bulge) * Math.tan(sweep / 4);
}

export function removeOrphanPoints(sk: Sketch) {
  const used = new Set<string>();
  for (const e of sk.entities) {
    if (e.type === 'circle') used.add(e.c);
    else {
      used.add(e.a);
      used.add(e.b);
    }
  }
  sk.points = sk.points.filter((p) => used.has(p.id));
}

/** Usuwa wypełnienia, których elementy już nie istnieją lub przestały tworzyć zamknięty kontur. */
export function cleanupProfiles(sk: Sketch) {
  const ids = new Set(sk.entities.map((e) => e.id));
  sk.profiles = sk.profiles.filter((p) => p.loops.every((l) => l.every((id) => ids.has(id))));
}

export function removeEntity(sk: Sketch, id: string) {
  const e = sk.entities.find((x) => x.id === id);
  sk.entities = sk.entities.filter((x) => x.id !== id);
  if (e?.group) {
    // grupa przestaje być spójna – zostają zwykłe linie
    for (const x of sk.entities) if (x.group === e.group) delete x.group;
    sk.groups = sk.groups.filter((g) => g.id !== e.group);
  }
  removeOrphanPoints(sk);
  cleanupProfiles(sk);
}

/**
 * Zaokrąglenie narożnika w punkcie wspólnym dwóch linii. Linie są skracane, a w narożnik
 * wstawiany jest łuk styczny o promieniu r.
 */
export function filletCorner(sk: Sketch, pointId: string, r: number): ArcEntity {
  if (!(r > 0)) throw new Error('Promień musi być większy od zera');
  const lines = sk.entities.filter((e) => e.type === 'line' && (e.a === pointId || e.b === pointId)) as LineEntity[];
  const others = sk.entities.filter((e) => e.type !== 'line' && e.type !== 'circle' && (e.a === pointId || e.b === pointId));
  if (lines.length !== 2 || others.length) throw new Error('Zaokrąglić można narożnik, w którym spotykają się dokładnie dwie linie');
  const P = getPoint(sk, pointId);
  const pc: Vec2 = [P.x, P.y];
  const far = lines.map((l) => getPoint(sk, l.a === pointId ? l.b : l.a));
  const d1 = v2.norm([far[0].x - P.x, far[0].y - P.y]);
  const d2 = v2.norm([far[1].x - P.x, far[1].y - P.y]);
  const cosA = Math.max(-1, Math.min(1, v2.dot(d1, d2)));
  const ang = Math.acos(cosA);
  if (ang < 1e-3 || Math.PI - ang < 1e-3) throw new Error('Linie są współliniowe – brak narożnika do zaokrąglenia');
  const t = r / Math.tan(ang / 2);
  const len1 = Math.hypot(far[0].x - P.x, far[0].y - P.y);
  const len2 = Math.hypot(far[1].x - P.x, far[1].y - P.y);
  if (t > len1 - 1e-6 || t > len2 - 1e-6) throw new Error('Promień za duży dla długości linii w tym narożniku');
  const T1: Vec2 = v2.add(pc, v2.scale(d1, t));
  const T2: Vec2 = v2.add(pc, v2.scale(d2, t));
  // środek łuku na dwusiecznej
  const bis = v2.norm(v2.add(d1, d2));
  const C = v2.add(pc, v2.scale(bis, r / Math.sin(ang / 2)));
  const id1 = ensurePoint(sk, { x: T1[0], y: T1[1] });
  const id2 = ensurePoint(sk, { x: T2[0], y: T2[1] });
  for (const [i, l] of lines.entries()) {
    const nid = i === 0 ? id1 : id2;
    if (l.a === pointId) l.a = nid;
    else l.b = nid;
    if (l.group) {
      for (const x of sk.entities) if (x.group === l.group) delete x.group;
      sk.groups = sk.groups.filter((g) => g.id !== l.group);
    }
  }
  const dir = v2.cross(v2.sub(T1, C), v2.sub(T2, C)) > 0 ? 1 : -1;
  const arc: ArcEntity = { id: uid('e'), type: 'arc', a: id1, b: id2, bulge: bulgeFromCenter(C, T1, T2, dir) };
  sk.entities.push(arc);
  // wypełnienia zawierające te linie: wstawiamy łuk do pętli
  for (const pr of sk.profiles)
    for (const loop of pr.loops) {
      if (lines.every((l) => loop.includes(l.id))) loop.push(arc.id);
    }
  removeOrphanPoints(sk);
  return arc;
}

/** Wypełnia obszar wskazany punktem. Zwraca id profilu albo null, gdy punkt nie leży w zamkniętym konturze. */
export function fillAt(sk: Sketch, pt: Vec2): string | null {
  splitAtIntersections(sk);
  const loops = regionAt(sk, pt);
  if (!loops) return null;
  return addProfile(sk, loops);
}

function addProfile(sk: Sketch, loops: string[][]): string {
  const key = (l: string[][]) => l.map((x) => [...x].sort().join(',')).sort().join('|');
  const k = key(loops);
  const existing = sk.profiles.find((p) => key(p.loops) === k);
  if (existing) return existing.id;
  const id = uid('pr');
  sk.profiles.push({ id, loops });
  return id;
}

/** Wypełnia wszystkie zamknięte obszary szkicu. */
export function fillAll(sk: Sketch): string[] {
  splitAtIntersections(sk);
  return allRegions(sk).map((loops) => addProfile(sk, loops));
}

/** Najbliższy punkt przyciągania (końce, środki odcinków, środki okręgów). */
export interface SnapResult {
  p: Vec2;
  kind: 'point' | 'mid' | 'center' | 'edge' | 'grid' | 'none';
  pointId?: string;
}

export function snap(sk: Sketch, p: Vec2, tol: number, opts: { grid: number | null; points: boolean; exclude?: Set<string> }): SnapResult {
  if (opts.points) {
    let best: SnapResult | null = null;
    let bd = tol;
    const used = new Set<string>();
    for (const e of sk.entities) {
      if (e.type === 'circle') used.add(e.c);
      else {
        used.add(e.a);
        used.add(e.b);
      }
    }
    for (const q of sk.points) {
      if (!used.has(q.id) || opts.exclude?.has(q.id)) continue;
      const d = Math.hypot(q.x - p[0], q.y - p[1]);
      if (d < bd) {
        bd = d;
        const isCenter = sk.entities.some((e) => e.type === 'circle' && e.c === q.id);
        best = { p: [q.x, q.y], kind: isCenter ? 'center' : 'point', pointId: isCenter ? undefined : q.id };
      }
    }
    if (best) return best;
    const pts = pointMap(sk);
    for (const e of sk.entities) {
      if (e.type === 'circle') continue;
      if (opts.exclude && (opts.exclude.has(e.a) || opts.exclude.has(e.b))) continue;
      const a = pts.get(e.a)!, b = pts.get(e.b)!;
      const m: Vec2 = e.type === 'line' ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : arcGeometry(a, b, e.bulge).mid;
      const d = v2.dist(m, p);
      if (d < bd) {
        bd = d;
        best = { p: m, kind: 'mid' };
      }
    }
    if (best) return best;
    // punkt na linii, łuku lub okręgu (koniec nowej linii dotyka istniejącej – można potem wypełnić obszar)
    const grid: Vec2 | null = opts.grid ? [Math.round(p[0] / opts.grid) * opts.grid, Math.round(p[1] / opts.grid) * opts.grid] : null;
    let bestE: { p: Vec2; d: number } | null = null;
    for (const e of sk.entities) {
      if (opts.exclude && (e.type === 'circle' ? opts.exclude.has(e.c) : opts.exclude.has(e.a) || opts.exclude.has(e.b))) continue;
      const c = curveOf(e, pts);
      if (!c) continue;
      const pr = project(c, p);
      if (pr.d < tol * 0.5 && (!bestE || pr.d < bestE.d)) {
        let q = pointAt(c, pr.t);
        // punkt siatki leżący na krzywej ma pierwszeństwo (okrągłe wymiary)
        if (grid && project(c, grid).d < 1e-9 && v2.dist(grid, p) < tol) q = grid;
        bestE = { p: q, d: pr.d };
      }
    }
    if (bestE) return { p: bestE.p, kind: 'edge' };
  }
  if (opts.grid) return { p: [Math.round(p[0] / opts.grid) * opts.grid, Math.round(p[1] / opts.grid) * opts.grid], kind: 'grid' };
  return { p, kind: 'none' };
}

/**
 * Obszar, który zostałby wypełniony kliknięciem w punkt (bez zmiany szkicu) – do podglądu pod kursorem.
 * Zwraca wielokąty pętli (pierwsza zewnętrzna) albo null.
 */
export function fillableRegionAt(sk: Sketch, pt: Vec2): Vec2[][] | null {
  const s = splitView(sk);
  const loops = regionAt(s, pt);
  if (!loops) return null;
  try {
    return loops.map((ids) => {
      const poly = loopPolygon(orderLoop(s, ids));
      return [...poly, poly[0]];
    });
  } catch {
    return null;
  }
}
