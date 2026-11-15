import { beforeAll, describe, expect, it } from 'vitest';
import { OcctKernel } from 'occt-wasm';
import { Builder } from '../src/kernel/build';
import { isClosedMesh, meshBBox, meshVolume, preloadManifold, weld, type MeshData } from '../src/kernel/meshOps';
import { emptyDoc, type ProjectDoc, type Sketch } from '../src/model/types';
import { identity, translation } from '../src/model/math';
import { parseGltf, parseObj, parsePly, parseStl, writeGlb, writeObj, writePly, writeStlAscii, writeStlBinary } from '../src/io/meshFormats';
import { parse3mf, write3mf } from '../src/io/threemf';
import { parseDxf, writeDxf } from '../src/io/dxf';
import { loadProject, saveProject } from '../src/io/project';
import { addArc, addCircle, addLine, addRect, fillAll } from '../src/model/sketchOps';
import { findLoops } from '../src/model/sketchGeom';

let k: OcctKernel;
beforeAll(async () => {
  k = await OcctKernel.init();
  await preloadManifold();
});

function cubeDoc(): ProjectDoc {
  const d = emptyDoc();
  d.features = [{ id: 'c', type: 'primitive', bodyId: 'cube', kind: 'box', params: { w: 20, d: 20, h: 20 }, matrix: identity() }];
  return d;
}

function filletedDoc(): ProjectDoc {
  const d = cubeDoc();
  d.features.push({ id: 'h', type: 'hole', bodyId: 'cube', face: { centroid: [0, 0, 20], normal: [0, 0, 1], kind: 'plane' }, edges: null, offsets: [0, 0], diameter: 6, depth: 0, through: true });
  d.features.push({ id: 'f', type: 'fillet', bodyId: 'cube', edges: [], allEdges: true, radius: 1 });
  return d;
}

function tess(doc: ProjectDoc, deflection = 0.02) {
  const b = new Builder(k);
  const r = b.build(doc);
  expect(r.errors).toEqual({});
  return { b, meshes: b.tessellate(b.bodyIds(), { deflection, angular: 0.2 }) };
}

const dims = (m: MeshData) => {
  const bb = meshBBox(m.positions);
  return bb.max.map((v, i) => +(v - bb.min[i]).toFixed(4));
};

describe('sześcian 20 mm: eksport i ponowny import', () => {
  it('STL binarny', () => {
    const { meshes } = tess(cubeDoc());
    const back = weld(parseStl(writeStlBinary(meshes).slice().buffer).positions, null);
    expect(dims(back)).toEqual([20, 20, 20]);
    expect(isClosedMesh(back)).toBe(true);
    expect(meshVolume(back)).toBeCloseTo(8000, 2);
  });
  it('STL ASCII', () => {
    const { meshes } = tess(cubeDoc());
    const txt = writeStlAscii(meshes.map((m) => ({ ...m, name: 'Sześcian' })));
    expect(txt.startsWith('solid')).toBe(true);
    const back = weld(parseStl(new TextEncoder().encode(txt).buffer).positions, null);
    expect(dims(back)).toEqual([20, 20, 20]);
    expect(isClosedMesh(back)).toBe(true);
  });
  it('3MF (jednostka: milimetr)', () => {
    const { meshes } = tess(cubeDoc());
    const data = write3mf(meshes.map((m) => ({ ...m, name: 'Sześcian' })));
    const back = parse3mf(data);
    expect(back.length).toBe(1);
    const w = weld(back[0].positions, back[0].indices);
    expect(dims(w)).toEqual([20, 20, 20]);
    expect(isClosedMesh(w)).toBe(true);
    expect(meshVolume(w)).toBeCloseTo(8000, 2);
    expect(back[0].name).toBe('Sześcian');
  });
  it('3MF w calach jest przeliczany na mm, transformacje elementów build są stosowane', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const xml = `<?xml version="1.0"?><model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
      <object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices>
      <triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh></object>
      <object id="2" type="model"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 2 0 0"/></components></object></resources>
      <build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 1"/></build></model>`;
    const data = zipSync({ '3D/3dmodel.model': strToU8(xml) });
    const [m] = parse3mf(data);
    const bb = meshBBox(m.positions);
    expect(bb.min.map((v) => +v.toFixed(4))).toEqual([50.8, 0, 25.4]);
    expect(bb.max.map((v) => +v.toFixed(4))).toEqual([76.2, 25.4, 50.8]);
  });
  it('OBJ, PLY, GLB', () => {
    const { meshes } = tess(cubeDoc());
    const named = meshes.map((m) => ({ ...m, name: 'Kostka' }));
    const obj = parseObj(writeObj(named));
    expect(dims(weld(obj[0].positions, obj[0].indices))).toEqual([20, 20, 20]);
    expect(isClosedMesh(weld(obj[0].positions, obj[0].indices))).toBe(true);
    const ply = parsePly(writePly(meshes).slice().buffer);
    expect(dims(ply)).toEqual([20, 20, 20]);
    expect(isClosedMesh(weld(ply.positions, ply.indices))).toBe(true);
    const glb = parseGltf(writeGlb(named).slice().buffer);
    const g = weld(glb[0].positions, glb[0].indices);
    expect(dims(g)).toEqual([20, 20, 20]);
    expect(meshVolume(g)).toBeCloseTo(8000, 2); // orientacja trójkątów zachowana przy zamianie osi
    const glbM = parseGltf(writeGlb(named, 0.001).slice().buffer, 1000);
    expect(dims(glbM[0])).toEqual([20, 20, 20]);
  });
  it('bryła z otworem i zaokrągleniami po STL jest zamknięta i ma objętość zbliżoną do B-rep', () => {
    const { b, meshes } = tess(filletedDoc(), 0.01);
    const exact = b.build(filletedDoc()).bodies[0].volume;
    const back = weld(parseStl(writeStlBinary(meshes).slice().buffer).positions, null);
    expect(isClosedMesh(back)).toBe(true);
    expect(Math.abs(meshVolume(back) - exact) / exact).toBeLessThan(0.005);
  });
});

describe('STEP i BREP', () => {
  it('sześcian z zaokrągleniami: STEP w mm i ponowny import', () => {
    const b = new Builder(k);
    b.build(filletedDoc());
    const step = b.exportStep(['cube']);
    expect(step).toMatch(/ISO-10303-21/);
    expect(step).toMatch(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
    const back = k.importStep(step);
    const bb = k.getBoundingBox(back);
    expect(+(bb.xmax - bb.xmin).toFixed(4)).toBe(20);
    expect(k.getSubShapes(back, 'solid').length).toBe(1);
    expect(k.getVolume(back)).toBeCloseTo(b.build(filletedDoc()).bodies[0].volume, 3);
  });
  it('siatka zaimportowana i wyeksportowana do STEP staje się bryłą', () => {
    const b = new Builder(k);
    const { meshes } = tess(cubeDoc());
    b.addAssets([{ id: 'a1', name: 'kostka.stl', mesh: { positions: meshes[0].positions, indices: meshes[0].indices } }]);
    const d = emptyDoc();
    d.features = [{ id: 'i', type: 'import', bodyId: 'm', assetId: 'a1', format: 'stl', geometry: 'mesh' }];
    const r = b.build(d);
    expect(r.bodies[0].geometry).toBe('mesh');
    expect(r.bodies[0].closed).toBe(true);
    const step = b.exportStep(['m']);
    const back = k.importStep(step);
    expect(k.getVolume(back)).toBeCloseTo(8000, 1);
  });
});

describe('siatki zaimportowane: przekształcenia i operacje logiczne', () => {
  it('różnica siatki STL i walca B-rep daje zamkniętą siatkę', () => {
    const b = new Builder(k);
    const { meshes } = tess(cubeDoc());
    b.addAssets([{ id: 'a1', name: 'kostka.stl', mesh: { positions: meshes[0].positions, indices: meshes[0].indices } }]);
    const d = emptyDoc();
    d.features = [
      { id: 'i', type: 'import', bodyId: 'm', assetId: 'a1', format: 'stl', geometry: 'mesh' },
      { id: 't', type: 'transform', bodyId: 'm', matrix: translation([5, 0, 0]) },
      { id: 'c', type: 'primitive', bodyId: 'cyl', kind: 'cylinder', params: { r: 3, h: 40 }, matrix: translation([5, 0, -5]) },
      { id: 'o', type: 'boolean', op: 'subtract', bodyId: 'm', tools: ['cyl'] },
    ];
    const r = b.build(d);
    expect(r.errors).toEqual({});
    const m = r.bodies[0];
    expect(m.geometry).toBe('mesh');
    expect(m.closed).toBe(true);
    expect(m.volume).toBeCloseTo(8000 - Math.PI * 9 * 20, -1); // walec przybliżony trójkątami
    expect(m.bbox.min[0]).toBeCloseTo(-5, 4);
  });
});

describe('DXF', () => {
  it('szkic z linią, łukiem i okręgiem – zapis i odczyt zachowuje kontur', () => {
    const s: Sketch = { id: 's', name: 'Szkic 1', plane: { origin: [0, 0, 0], normal: [0, 0, 1], xDir: [1, 0, 0] }, points: [], entities: [], groups: [], profiles: [], visible: true };
    const l = addLine(s, { x: -10, y: 0 }, { x: 10, y: 0 })!;
    addArc(s, { id: l.b, x: 10, y: 0 }, { id: l.a, x: -10, y: 0 }, 1);
    addCircle(s, { x: 0, y: 4 }, 2);
    addRect(s, { x: 20, y: 0 }, { x: 30, y: 5 });
    const dxf = writeDxf([s]);
    expect(dxf).toMatch(/\$INSUNITS\n70\n4/);
    const s2: Sketch = { ...s, id: 's2', points: [], entities: [], groups: [], profiles: [] };
    const r = parseDxf(dxf, s2);
    expect(r.entities).toBe(7);
    expect(findLoops(s2).length).toBe(3);
    expect(fillAll(s2).length).toBe(3);
  });
  it('LWPOLYLINE w calach z wybrzuszeniem', () => {
    const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '1', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', '0', '90', '2', '70', '1', '10', '0', '20', '0', '42', '1', '10', '1', '20', '0', '42', '1', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const s: Sketch = { id: 's', name: 'S', plane: { origin: [0, 0, 0], normal: [0, 0, 1], xDir: [1, 0, 0] }, points: [], entities: [], groups: [], profiles: [], visible: true };
    parseDxf(dxf, s);
    expect(s.entities.length).toBe(2);
    expect(s.points.find((p) => p.x > 25)?.x).toBeCloseTo(25.4, 9);
    expect(findLoops(s).length).toBe(1);
  });
});

describe('plik projektu', () => {
  it('zapis i odczyt zachowuje historię i zasoby', () => {
    const d = filletedDoc();
    const assets = [{ id: 'a1', name: 'x.stl', mesh: { positions: new Float32Array([0, 1, 2]), indices: new Uint32Array([0, 0, 0]) } }];
    d.features.push({ id: 'i', type: 'import', bodyId: 'm', assetId: 'a1', format: 'stl', geometry: 'mesh' });
    const back = loadProject(saveProject(d, assets));
    expect(back.doc).toEqual(d);
    expect(Array.from(back.assets[0].mesh!.positions)).toEqual([0, 1, 2]);
  });
});
