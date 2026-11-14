import { beforeAll, describe, expect, it } from 'vitest';
import { OcctKernel } from 'occt-wasm';
import { Builder } from '../src/kernel/build';
import { preloadManifold } from '../src/kernel/meshOps';
import { emptyDoc, type Feature, type ProjectDoc, type Sketch } from '../src/model/types';
import { identity, translation, rotationAxis, scaling, mul } from '../src/model/math';

let k: OcctKernel;
beforeAll(async () => {
  k = await OcctKernel.init();
  await preloadManifold();
});

function doc(features: Feature[], sketches: Sketch[] = []): ProjectDoc {
  const d = emptyDoc();
  d.features = features;
  d.sketches = sketches;
  return d;
}

const box = (id = 'b1', w = 20, d = 20, h = 20, m = identity()): Feature => ({
  id: 'f_' + id,
  type: 'primitive',
  bodyId: id,
  kind: 'box',
  params: { w, d, h },
  matrix: m,
});

const size = (bb: { min: number[]; max: number[] }) => bb.max.map((v, i) => +(v - bb.min[i]).toFixed(4));

describe('Builder – bryły i przekształcenia', () => {
  it('sześcian 20 mm', () => {
    const b = new Builder(k);
    const r = b.build(doc([box()]));
    expect(r.errors).toEqual({});
    const body = r.bodies[0];
    expect(size(body.bbox)).toEqual([20, 20, 20]);
    expect(body.volume).toBeCloseTo(8000, 3);
    expect(body.closed).toBe(true);
    expect(body.faces.length).toBe(6);
    expect(body.edges.length).toBe(12);
    expect(body.vertices.length).toBe(24);
    // każda ściana ma swój zakres trójkątów
    const total = body.faces.reduce((s, f) => s + f.count, 0);
    expect(total).toBe(body.indices.length);
    // normalna górnej ściany
    const top = body.faces.find((f) => f.centroid[2] > 19.9)!;
    expect(top.normal).toEqual([0, 0, 1]);
    expect(top.edges.length).toBe(4);
  });

  it('wszystkie bryły gotowe', () => {
    const b = new Builder(k);
    const fs: Feature[] = [
      { id: 'a', type: 'primitive', bodyId: 'cyl', kind: 'cylinder', params: { r: 5, h: 10 }, matrix: identity() },
      { id: 'b', type: 'primitive', bodyId: 'sph', kind: 'sphere', params: { r: 5 }, matrix: identity() },
      { id: 'c', type: 'primitive', bodyId: 'con', kind: 'cone', params: { r1: 5, r2: 0, h: 10 }, matrix: identity() },
      { id: 'd', type: 'primitive', bodyId: 'tor', kind: 'torus', params: { R: 10, r: 2 }, matrix: identity() },
      { id: 'e', type: 'primitive', bodyId: 'pri', kind: 'prism', params: { n: 6, r: 10, h: 5 }, matrix: identity() },
      { id: 'f', type: 'primitive', bodyId: 'wed', kind: 'wedge', params: { w: 10, d: 20, h: 5, top: 0 }, matrix: identity() },
    ];
    const r = b.build(doc(fs));
    expect(r.errors).toEqual({});
    const vol = Object.fromEntries(r.bodies.map((x) => [x.id, x.volume]));
    expect(vol.cyl).toBeCloseTo(Math.PI * 25 * 10, 3);
    expect(vol.sph).toBeCloseTo((4 / 3) * Math.PI * 125, 3);
    expect(vol.con).toBeCloseTo((Math.PI * 25 * 10) / 3, 3);
    expect(vol.tor).toBeCloseTo(2 * Math.PI * Math.PI * 10 * 4, 3);
    expect(vol.pri).toBeCloseTo(((3 * Math.sqrt(3)) / 2) * 100 * 5, 3);
    expect(vol.wed).toBeCloseTo(0.5 * 10 * 5 * 20, 3);
    for (const x of r.bodies) {
      expect(x.closed).toBe(true);
      expect(x.bbox.min[2]).toBeCloseTo(0, 6); // każda bryła stoi na stole
    }
  });

  it('przesunięcie, obrót o 90° i skalowanie nierównomierne', () => {
    const b = new Builder(k);
    const m = mul(translation([10, 0, 0]), mul(rotationAxis([0, 0, 1], Math.PI / 2), scaling([2, 1, 0.5])));
    const r = b.build(doc([box('b1', 10, 20, 30), { id: 't', type: 'transform', bodyId: 'b1', matrix: m }]));
    expect(r.errors).toEqual({});
    const bb = r.bodies[0].bbox;
    // skala (2,1,0.5) -> 20 x 20 x 15, obrót wokół Z zamienia X z Y
    expect(size(bb)).toEqual([20, 20, 15]);
    expect(r.bodies[0].volume).toBeCloseTo(6000, 2);
    expect((bb.min[0] + bb.max[0]) / 2).toBeCloseTo(10, 6);
  });

  it('pamięć podręczna: niezmieniona bryła nie jest przeliczana', () => {
    const b = new Builder(k);
    const d1 = doc([box('a'), box('b', 5, 5, 5, translation([30, 0, 0]))]);
    const r1 = b.build(d1);
    const d2 = doc([box('a'), box('b', 6, 5, 5, translation([30, 0, 0]))]);
    const r2 = b.build(d2);
    const va1 = r1.bodies.find((x) => x.id === 'a')!.version;
    const va2 = r2.bodies.find((x) => x.id === 'a')!.version;
    expect(va1).toBe(va2);
    expect(size(r2.bodies.find((x) => x.id === 'b')!.bbox)).toEqual([6, 5, 5]);
  });

  it('błąd operacji nie przerywa przebudowy', () => {
    const b = new Builder(k);
    const r = b.build(doc([box('a', 0, 10, 10), box('b')]));
    expect(r.errors['f_a']).toMatch(/większy od zera/);
    expect(r.bodies.map((x) => x.id)).toEqual(['b']);
  });
});

function rectSketch(w: number, h: number, hole?: number): Sketch {
  const pts = [
    { id: 'p0', x: -w / 2, y: -h / 2 },
    { id: 'p1', x: w / 2, y: -h / 2 },
    { id: 'p2', x: w / 2, y: h / 2 },
    { id: 'p3', x: -w / 2, y: h / 2 },
    { id: 'pc', x: 0, y: 0 },
  ];
  const entities: Sketch['entities'] = [
    { id: 'l0', type: 'line', a: 'p0', b: 'p1' },
    { id: 'l1', type: 'line', a: 'p1', b: 'p2' },
    { id: 'l2', type: 'line', a: 'p2', b: 'p3' },
    { id: 'l3', type: 'line', a: 'p3', b: 'p0' },
  ];
  const loops = [['l0', 'l1', 'l2', 'l3']];
  if (hole) {
    entities.push({ id: 'c0', type: 'circle', c: 'pc', r: hole });
    loops.push(['c0']);
  }
  return {
    id: 's1',
    name: 'Szkic',
    plane: { origin: [0, 0, 0], normal: [0, 0, 1], xDir: [1, 0, 0] },
    points: pts,
    entities,
    groups: [],
    profiles: [{ id: 'pr1', loops }],
    visible: true,
  };
}

describe('Builder – wyciągnięcie, otwory, operacje logiczne, zaokrąglenia', () => {
  it('wyciągnięcie konturu z otworem', () => {
    const b = new Builder(k);
    const r = b.build(
      doc(
        [{ id: 'e', type: 'extrude', bodyId: 'x', source: { kind: 'profile', sketchId: 's1', profileId: 'pr1' }, distance: 10, mode: 'new' }],
        [rectSketch(40, 30, 5)],
      ),
    );
    expect(r.errors).toEqual({});
    expect(r.bodies[0].volume).toBeCloseTo(40 * 30 * 10 - Math.PI * 25 * 10, 3);
    expect(size(r.bodies[0].bbox)).toEqual([40, 30, 10]);
  });

  it('wyciągnięcie ściany bryły (dodaj) i wycięcie konturem', () => {
    const b = new Builder(k);
    const r = b.build(
      doc(
        [
          box('a'),
          {
            id: 'e1',
            type: 'extrude',
            bodyId: 'a',
            source: { kind: 'face', bodyId: 'a', face: { centroid: [0, 0, 20], normal: [0, 0, 1], kind: 'plane' } },
            distance: 5,
            mode: 'join',
          },
          {
            id: 'e2',
            type: 'extrude',
            bodyId: 'a',
            source: { kind: 'profile', sketchId: 's1', profileId: 'pr1' },
            distance: 30,
            mode: 'cut',
          },
        ],
        [rectSketch(4, 4)],
      ),
    );
    expect(r.errors).toEqual({});
    expect(size(r.bodies[0].bbox)).toEqual([20, 20, 25]);
    expect(r.bodies[0].volume).toBeCloseTo(20 * 20 * 25 - 16 * 25, 2);
  });

  it('otwór na wylot z odległościami od krawędzi', () => {
    const b = new Builder(k);
    const r = b.build(
      doc([
        box('a', 40, 30, 10),
        {
          id: 'h',
          type: 'hole',
          bodyId: 'a',
          face: { centroid: [0, 0, 10], normal: [0, 0, 1], kind: 'plane' },
          edges: [
            { mid: [-20, 0, 10], dir: [0, 1, 0], kind: 'line' },
            { mid: [0, -15, 10], dir: [1, 0, 0], kind: 'line' },
          ],
          offsets: [8, 6],
          diameter: 5,
          depth: 0,
          through: true,
        },
      ]),
    );
    expect(r.errors).toEqual({});
    const body = r.bodies[0];
    expect(body.volume).toBeCloseTo(40 * 30 * 10 - Math.PI * 6.25 * 10, 2);
    const circ = body.edges.find((e) => e.kind === 'circle' && e.center && e.center[2] > 9.9)!;
    expect(circ.center![0]).toBeCloseTo(-20 + 8, 6);
    expect(circ.center![1]).toBeCloseTo(-15 + 6, 6);
    expect(circ.radius).toBeCloseTo(2.5, 6);
  });

  it('otwór nieprzelotowy o głębokości 4 mm', () => {
    const b = new Builder(k);
    const r = b.build(
      doc([
        box('a', 40, 30, 10),
        {
          id: 'h',
          type: 'hole',
          bodyId: 'a',
          face: { centroid: [0, 0, 10], normal: [0, 0, 1], kind: 'plane' },
          edges: null,
          offsets: [0, 0],
          diameter: 6,
          depth: 4,
          through: false,
        },
      ]),
    );
    expect(r.errors).toEqual({});
    expect(r.bodies[0].volume).toBeCloseTo(40 * 30 * 10 - Math.PI * 9 * 4, 2);
  });

  it('suma, różnica, część wspólna', () => {
    const b = new Builder(k);
    const two = [box('a'), box('b', 20, 20, 20, translation([10, 0, 0]))];
    const u = b.build(doc([...two, { id: 'o', type: 'boolean', op: 'union', bodyId: 'a', tools: ['b'] }]));
    expect(u.bodies.length).toBe(1);
    expect(u.bodies[0].volume).toBeCloseTo(30 * 20 * 20, 3);
    expect(u.bodies[0].faces.length).toBe(6); // ściany współpłaszczyznowe scalone
    const s = b.build(doc([...two, { id: 'o', type: 'boolean', op: 'subtract', bodyId: 'a', tools: ['b'] }]));
    expect(s.bodies[0].volume).toBeCloseTo(10 * 20 * 20, 3);
    const i = b.build(doc([...two, { id: 'o', type: 'boolean', op: 'intersect', bodyId: 'a', tools: ['b'] }]));
    expect(i.bodies[0].volume).toBeCloseTo(10 * 20 * 20, 3);
  });

  it('zaokrąglenie i fazowanie krawędzi', () => {
    const b = new Builder(k);
    const r = b.build(
      doc([box('a'), { id: 'fi', type: 'fillet', bodyId: 'a', edges: [], allEdges: true, radius: 2 }]),
    );
    expect(r.errors).toEqual({});
    expect(r.bodies[0].faces.length).toBe(26);
    const c = b.build(
      doc([box('a'), { id: 'ch', type: 'chamfer', bodyId: 'a', edges: [{ mid: [0, -10, 20], dir: [1, 0, 0], kind: 'line' }], radius: 2 }]),
    );
    expect(c.errors).toEqual({});
    expect(c.bodies[0].volume).toBeCloseTo(8000 - 0.5 * 2 * 2 * 20, 3);
  });

  it('zaokrąglenie wszystkich krawędzi walca pomija szew', () => {
    const b = new Builder(k);
    const r = b.build(
      doc([
        { id: 'c', type: 'primitive', bodyId: 'c', kind: 'cylinder', params: { r: 10, h: 10 }, matrix: identity() },
        { id: 'fi', type: 'fillet', bodyId: 'c', edges: [], allEdges: true, radius: 1 },
      ]),
    );
    expect(r.errors).toEqual({});
    expect(r.bodies[0].closed).toBe(true);
  });

  it('za duży promień zaokrąglenia daje czytelny błąd', () => {
    const b = new Builder(k);
    const r = b.build(doc([box('a'), { id: 'fi', type: 'fillet', bodyId: 'a', edges: [], allEdges: true, radius: 15 }]));
    expect(r.errors['fi']).toMatch(/promień/i);
  });
});
