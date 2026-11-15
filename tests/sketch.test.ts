import { beforeAll, describe, expect, it } from 'vitest';
import { OcctKernel } from 'occt-wasm';
import type { Sketch } from '../src/model/types';
import { emptyDoc } from '../src/model/types';
import {
  addArc,
  addCircle,
  addLine,
  addPolygon,
  addRect,
  fillAll,
  fillAt,
  filletCorner,
  mergePoints,
  movePoint,
  rectSize,
  removeEntity,
  setArcRadius,
  setLineLength,
  setRectSize,
  snap,
} from '../src/model/sketchOps';
import { arcGeometry, bulgeFrom3, danglingPoints, findLoops, gaps, loopArea, orderLoop, pointMap } from '../src/model/sketchGeom';
import { Builder } from '../src/kernel/build';

function sk(): Sketch {
  return { id: 's', name: 'S', plane: { origin: [0, 0, 0], normal: [0, 0, 1], xDir: [1, 0, 0] }, points: [], entities: [], groups: [], profiles: [], visible: true };
}

let k: OcctKernel;
beforeAll(async () => {
  k = await OcctKernel.init();
});

function extrudeVolume(s: Sketch, profileId: string, h = 10) {
  const b = new Builder(k);
  const d = emptyDoc();
  d.sketches = [s];
  d.features = [{ id: 'e', type: 'extrude', bodyId: 'x', source: { kind: 'profile', sketchId: s.id, profileId }, distance: h, mode: 'new' }];
  const r = b.build(d);
  if (r.errors.e) throw new Error(r.errors.e);
  return r.bodies[0].volume;
}

describe('szkic – kontury', () => {
  it('cztery osobne linie połączone w punktach tworzą zamknięty kontur', () => {
    const s = sk();
    const l1 = addLine(s, { x: 0, y: 0 }, { x: 10, y: 0 })!;
    const l2 = addLine(s, { id: l1.b, x: 10, y: 0 }, { x: 10, y: 10 })!;
    const l3 = addLine(s, { id: l2.b, x: 10, y: 10 }, { x: 0, y: 10 })!;
    addLine(s, { id: l3.b, x: 0, y: 10 }, { x: 0, y: 0.5 }); // niedomknięte o 0,5 mm
    expect(danglingPoints(s).length).toBe(2);
    const g = gaps(s);
    expect(g[0].distance).toBeCloseTo(0.5, 9);
    expect(fillAt(s, [5, 5])).toBeNull();
    // przeciągnięcie końca na punkt startowy łączy punkty
    const last = s.entities[3];
    if (last.type !== 'line') throw new Error();
    movePoint(s, last.b, [0, 0]);
    mergePoints(s, last.b, l1.a);
    expect(danglingPoints(s).length).toBe(0);
    const pid = fillAt(s, [5, 5]);
    expect(pid).toBeTruthy();
    expect(extrudeVolume(s, pid!)).toBeCloseTo(1000, 6);
  });

  it('prostokąt z otworem kołowym i wypełnienie wszystkich obszarów', () => {
    const s = sk();
    addRect(s, { x: -20, y: -10 }, { x: 20, y: 10 });
    addCircle(s, { x: 0, y: 0 }, 5);
    const ids = fillAll(s);
    expect(ids.length).toBe(2); // prostokąt z otworem + koło
    const outer = s.profiles.find((p) => p.loops.length === 2)!;
    expect(extrudeVolume(s, outer.id)).toBeCloseTo(40 * 20 * 10 - Math.PI * 25 * 10, 4);
    const pid = fillAt(s, [0, 0])!;
    expect(extrudeVolume(s, pid)).toBeCloseTo(Math.PI * 25 * 10, 4);
  });

  it('dwa prostokąty ze wspólną krawędzią dają dwa obszary', () => {
    const s = sk();
    const r = addRect(s, { x: 0, y: 0 }, { x: 10, y: 10 })!;
    // drugi prostokąt dzielący bok
    const p1 = r.points[1], p2 = r.points[2];
    const a = addLine(s, { id: p1, x: 10, y: 0 }, { x: 20, y: 0 })!;
    const b = addLine(s, { id: a.b, x: 20, y: 0 }, { x: 20, y: 10 })!;
    addLine(s, { id: b.b, x: 20, y: 10 }, { id: p2, x: 10, y: 10 });
    const loops = findLoops(s);
    expect(loops.length).toBe(2);
    const pid = fillAt(s, [15, 5])!;
    expect(extrudeVolume(s, pid)).toBeCloseTo(1000, 6);
  });

  it('wielokąt foremny i łuk przez trzy punkty', () => {
    const s = sk();
    const g = addPolygon(s, [0, 0], 10, 6, 90)!;
    expect(g.points.length).toBe(6);
    const pid = fillAt(s, [0, 0])!;
    expect(extrudeVolume(s, pid, 1)).toBeCloseTo(((3 * Math.sqrt(3)) / 2) * 100, 6);
    const bulge = bulgeFrom3([-10, 0], [0, 10], [10, 0])!;
    const geo = arcGeometry([-10, 0], [10, 0], bulge);
    expect(geo.r).toBeCloseTo(10, 9);
    expect(geo.center[1]).toBeCloseTo(0, 9);
    expect(geo.mid[1]).toBeCloseTo(10, 9);
  });

  it('kontur z linii i łuku (półokrąg)', () => {
    const s = sk();
    const l = addLine(s, { x: -10, y: 0 }, { x: 10, y: 0 })!;
    addArc(s, { id: l.b, x: 10, y: 0 }, { id: l.a, x: -10, y: 0 }, 1); // półokrąg w górę (CCW)
    const pid = fillAt(s, [0, 3])!;
    expect(pid).toBeTruthy();
    expect(extrudeVolume(s, pid, 2)).toBeCloseTo((Math.PI * 100) / 2 * 2, 4);
  });

  it('zaokrąglenie narożników prostokąta', () => {
    const s = sk();
    const g = addRect(s, { x: 0, y: 0 }, { x: 20, y: 10 })!;
    const pid = fillAt(s, [5, 5])!;
    for (const p of [...g.points]) filletCorner(s, p, 2);
    expect(s.entities.filter((e) => e.type === 'arc').length).toBe(4);
    // pole: prostokąt minus 4*(r² - πr²/4)
    const area = 200 - 4 * (4 - Math.PI);
    expect(extrudeVolume(s, pid, 1)).toBeCloseTo(area, 4);
    const arc = s.entities.find((e) => e.type === 'arc')!;
    if (arc.type !== 'arc') throw new Error();
    const pts = pointMap(s);
    expect(arcGeometry(pts.get(arc.a)!, pts.get(arc.b)!, arc.bulge).r).toBeCloseTo(2, 9);
  });

  it('za duży promień zaokrąglenia zgłasza błąd', () => {
    const s = sk();
    const g = addRect(s, { x: 0, y: 0 }, { x: 4, y: 4 })!;
    expect(() => filletCorner(s, g.points[0], 5)).toThrow(/za duży/);
  });

  it('przeciągnięcie narożnika prostokąta zachowuje prostokąt; zmiana wymiarów', () => {
    const s = sk();
    const g = addRect(s, { x: 0, y: 0 }, { x: 10, y: 10 })!;
    movePoint(s, g.points[2], [30, 15]);
    expect(rectSize(s, g).map((x) => +x.toFixed(9))).toEqual([30, 15]);
    setRectSize(s, g.id, 12.34, 5.67);
    expect(rectSize(s, g).map((x) => +x.toFixed(9))).toEqual([12.34, 5.67]);
  });

  it('długość linii, promień łuku, usuwanie elementu', () => {
    const s = sk();
    const l = addLine(s, { x: 0, y: 0 }, { x: 3, y: 4 })!;
    setLineLength(s, l.line.id, 10);
    const pts = pointMap(s);
    expect(pts.get(l.b)).toEqual([6, 8]);
    const a = addArc(s, { x: 0, y: 20 }, { x: 10, y: 20 }, 0.3)!;
    setArcRadius(s, a.id, 20);
    const p2 = pointMap(s);
    expect(arcGeometry(p2.get(a.a)!, p2.get(a.b)!, a.bulge).r).toBeCloseTo(20, 9);
    removeEntity(s, l.line.id);
    expect(s.entities.length).toBe(1);
    expect(s.points.length).toBe(2);
  });

  it('przyciąganie: punkty końcowe, środki odcinków, siatka', () => {
    const s = sk();
    addLine(s, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(snap(s, [9.6, 0.3], 1, { grid: 1, points: true }).kind).toBe('point');
    expect(snap(s, [5.2, 0.2], 1, { grid: 1, points: true }).kind).toBe('mid');
    const g = snap(s, [3.4, 7.6], 1, { grid: 0.5, points: true });
    expect(g.kind).toBe('grid');
    expect(g.p).toEqual([3.5, 7.5]);
  });

  it('kolejność pętli z odwróconymi elementami', () => {
    const s = sk();
    const l1 = addLine(s, { x: 0, y: 0 }, { x: 10, y: 0 })!;
    const l2 = addLine(s, { x: 0, y: 10 }, { id: l1.b, x: 10, y: 0 })!; // odwrócona
    addLine(s, { id: l2.a, x: 0, y: 10 }, { id: l1.a, x: 0, y: 0 });
    const segs = orderLoop(s, s.entities.map((e) => e.id));
    expect(segs.length).toBe(3);
  });
});

describe('pole konturu', () => {
  it('dokładne pole koła i konturu z łukiem', async () => {
    const { loopArea, orderLoop } = await import('../src/model/sketchGeom');
    const s = sk();
    addCircle(s, { x: 0, y: 0 }, 4);
    expect(loopArea(orderLoop(s, [s.entities[0].id]))).toBeCloseTo(Math.PI * 16, 10);
    const s2 = sk();
    const l = addLine(s2, { x: -10, y: 0 }, { x: 10, y: 0 })!;
    addArc(s2, { id: l.b, x: 10, y: 0 }, { id: l.a, x: -10, y: 0 }, 1);
    expect(Math.abs(loopArea(orderLoop(s2, s2.entities.map((e) => e.id))))).toBeCloseTo(50 * Math.PI, 10);
  });
});

describe('szkic – wypełnianie przecinających się elementów', () => {
  const area = (s: Sketch, id: string) => {
    const pr = s.profiles.find((p) => p.id === id)!;
    const a = pr.loops.map((l) => Math.abs(loopArea(orderLoop(s, l))));
    return a[0] - a.slice(1).reduce((x, y) => x + y, 0);
  };

  it('linia dzieląca prostokąt, kończąca się w połowie jego boków (styk bez wspólnych punktów)', () => {
    const s = sk();
    addRect(s, { x: 0, y: 0 }, { x: 10, y: 10 });
    addLine(s, { x: 4, y: 0 }, { x: 4, y: 10 });
    const id = fillAt(s, [2, 5])!;
    expect(id).not.toBeNull();
    expect(area(s, id)).toBeCloseTo(40, 6);
    expect(extrudeVolume(s, id)).toBeCloseTo(400, 3);
    expect(area(s, fillAt(s, [7, 5])!)).toBeCloseTo(60, 6);
  });

  it('linie wystające poza kontur i krzyżujące się (krzyżyk w prostokącie, kratka #)', () => {
    const s = sk();
    addRect(s, { x: 0, y: 0 }, { x: 10, y: 10 });
    addLine(s, { x: 5, y: -3 }, { x: 5, y: 13 });
    addLine(s, { x: -2, y: 5 }, { x: 12, y: 5 });
    expect(fillAll(s).length).toBe(4);
    for (const p of s.profiles) expect(area(s, p.id)).toBeCloseTo(25, 6);

    const h = sk();
    addLine(h, { x: 0, y: 3 }, { x: 10, y: 3 });
    addLine(h, { x: 0, y: 7 }, { x: 10, y: 7 });
    addLine(h, { x: 3, y: 0 }, { x: 3, y: 10 });
    addLine(h, { x: 7, y: 0 }, { x: 7, y: 10 });
    const id = fillAt(h, [5, 5])!;
    expect(area(h, id)).toBeCloseTo(16, 6);
    expect(extrudeVolume(h, id)).toBeCloseTo(160, 3);
    expect(fillAt(h, [1, 1])).toBeNull();
  });

  it('dwa nachodzące na siebie okręgi dają trzy obszary (soczewka w środku)', () => {
    const s = sk();
    addCircle(s, { x: 0, y: 0 }, 5);
    addCircle(s, { x: 6, y: 0 }, 5);
    const lens = fillAt(s, [3, 0])!;
    // pole soczewki: 2 r² acos(d/2r) − (d/2) √(4r² − d²)
    const r = 5, d = 6;
    const exact = 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
    expect(area(s, lens)).toBeCloseTo(exact, 6);
    expect(extrudeVolume(s, lens, 2)).toBeCloseTo(exact * 2, 2);
    expect(fillAll(s).length).toBe(3);
  });

  it('okrąg przecinający bok prostokąta i wcześniejsze wypełnienie zostaje zachowane', () => {
    const s = sk();
    addRect(s, { x: 0, y: 0 }, { x: 10, y: 10 });
    const before = fillAt(s, [5, 5])!;
    addCircle(s, { x: 10, y: 5 }, 3);
    const half = fillAt(s, [11, 5])!;
    expect(area(s, half)).toBeCloseTo((Math.PI * 9) / 2, 2);
    // stare wypełnienie nadal opisuje cały prostokąt (pętla z podzielonych elementów)
    expect(s.profiles.some((p) => p.id === before)).toBe(true);
    expect(area(s, before)).toBeCloseTo(100, 6);
  });

  it('linia kończąca się na okręgu dzieli go', () => {
    const s = sk();
    addCircle(s, { x: 0, y: 0 }, 5);
    addLine(s, { x: -5, y: 0 }, { x: 5, y: 0 });
    expect(area(s, fillAt(s, [0, 2])!)).toBeCloseTo((Math.PI * 25) / 2, 6);
  });

  it('przyciąganie do linii (punkt na krawędzi)', () => {
    const s = sk();
    addLine(s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const r = snap(s, [3.3, 0.2], 0.5, { grid: null, points: true });
    expect(r.kind).toBe('edge');
    expect(r.p[0]).toBeCloseTo(3.3, 9);
    expect(r.p[1]).toBeCloseTo(0, 9);
    // punkt siatki leżący na linii ma pierwszeństwo przed rzutem
    const g = snap(s, [3.3, 0.2], 0.5, { grid: 1, points: true });
    expect(g.p).toEqual([3, 0]);
  });
});

describe('szkic – przerwy a wystające końcówki', () => {
  it('linia wystająca poza prostokąt nie jest zgłaszana jako przerwa; otwarty łańcuch tak', () => {
    const s = sk();
    addRect(s, { x: 0, y: 0 }, { x: 10, y: 10 });
    addLine(s, { x: 5, y: -3 }, { x: 5, y: 13 });
    expect(danglingPoints(s)).toEqual([]);
    expect(gaps(s)).toEqual([]);
    const l = addLine(s, { x: 20, y: 0 }, { x: 30, y: 0 })!;
    addLine(s, { id: l.b, x: 30, y: 0 }, { x: 30, y: 9 });
    expect(danglingPoints(s).length).toBe(2);
    expect(gaps(s)[0].distance).toBeCloseTo(Math.hypot(10, 9), 9);
  });
});
