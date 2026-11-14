import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Sketch, Vec2, Plane } from '../model/types';
import { arcGeometry, danglingPoints, gaps, orderLoop, pointMap, sampleArc, loopPolygon } from '../model/sketchGeom';
import { planeY } from '../model/math';
import { makeLineMaterial } from './BodyView';
import type { Selection } from '../state/store';

export function planeMatrix(p: Plane): THREE.Matrix4 {
  const x = new THREE.Vector3(...p.xDir).normalize();
  const z = new THREE.Vector3(...p.normal).normalize();
  const y = new THREE.Vector3(...planeY(p.normal, p.xDir));
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(new THREE.Vector3(...p.origin));
  return m;
}

const C_LINE = 0x1f4fa8;
const C_ACTIVE = 0x0a62ff;
const C_SEL = 0xff8a00;
const C_GAP = 0xe02020;

const mats = {
  line: makeLineMaterial(C_LINE, 2),
  active: makeLineMaterial(C_ACTIVE, 2.5),
  sel: makeLineMaterial(C_SEL, 4, false),
  gap: makeLineMaterial(C_GAP, 3, false),
  preview: makeLineMaterial(0x00a86b, 2, false),
};

export function entitySegments2D(sk: Sketch, id: string): Vec2[][] {
  const pts = pointMap(sk);
  const e = sk.entities.find((x) => x.id === id);
  if (!e) return [];
  if (e.type === 'line') return [[pts.get(e.a)!, pts.get(e.b)!]];
  if (e.type === 'arc') return [sampleArc(pts.get(e.a)!, pts.get(e.b)!, e.bulge, 48)];
  const c = pts.get(e.c)!;
  const out: Vec2[] = [];
  for (let i = 0; i <= 96; i++) {
    const t = (i / 96) * Math.PI * 2;
    out.push([c[0] + e.r * Math.cos(t), c[1] + e.r * Math.sin(t)]);
  }
  return [out];
}

function polyToSeg(polys: Vec2[][], z = 0): number[] {
  const out: number[] = [];
  for (const p of polys) for (let i = 0; i + 1 < p.length; i++) out.push(p[i][0], p[i][1], z, p[i + 1][0], p[i + 1][1], z);
  return out;
}

export class SketchLayer {
  group = new THREE.Group();
  /** Elementy podglądu rysowania (rysowane w układzie aktywnego szkicu). */
  preview = new THREE.Group();

  sync(sketches: Sketch[], selection: Selection, activeId: string | null, hoverId: string | null = null) {
    for (const c of this.group.children) disposeDeep(c);
    this.group.clear();
    for (const sk of sketches) {
      const active = sk.id === activeId;
      if (!sk.visible && !active) continue;
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.matrix.copy(planeMatrix(sk.plane));
      g.userData.sketchId = sk.id;
      const selEnt = new Set(selection?.kind === 'sketch' && selection.sketchId === sk.id ? selection.entities : []);
      if (hoverId) selEnt.add(hoverId);
      const selPts = new Set(selection?.kind === 'sketch' && selection.sketchId === sk.id ? selection.points : []);
      // wypełnienia
      for (const pr of sk.profiles) {
        try {
          const loops = pr.loops.map((ids) => loopPolygon(orderLoop(sk, ids)));
          const shape = new THREE.Shape(loops[0].map((p) => new THREE.Vector2(p[0], p[1])));
          for (const h of loops.slice(1)) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))));
          const selected = selection?.kind === 'profile' && selection.profileId === pr.id;
          const m = new THREE.Mesh(
            new THREE.ShapeGeometry(shape),
            new THREE.MeshBasicMaterial({
              color: selected ? 0xffa940 : 0x6fa8ff,
              transparent: true,
              opacity: selected ? 0.6 : 0.32,
              side: THREE.DoubleSide,
              depthWrite: false,
              polygonOffset: true,
              polygonOffsetFactor: -2,
            }),
          );
          m.position.z = 0.01;
          m.userData.profileId = pr.id;
          m.renderOrder = 2;
          g.add(m);
        } catch {
          /* profil uszkodzony po edycji – pomijamy */
        }
      }
      // linie
      const normal: Vec2[][] = [];
      const sel: Vec2[][] = [];
      for (const e of sk.entities) {
        const segs = entitySegments2D(sk, e.id);
        (selEnt.has(e.id) ? sel : normal).push(...segs);
      }
      if (normal.length) g.add(fat(polyToSeg(normal, 0.02), active ? mats.active : mats.line, 3));
      if (sel.length) g.add(fat(polyToSeg(sel, 0.03), mats.sel, 6));
      // przerwy w konturze (tylko dla aktywnego lub zaznaczonego szkicu)
      if (active) {
        const gp = gaps(sk).filter((x) => x.distance > 0);
        if (gp.length) g.add(fat(polyToSeg(gp.map((x) => [x.a, x.b]), 0.04), mats.gap, 7));
      }
      // punkty
      const pts = pointMap(sk);
      const dangling = new Set(active ? danglingPoints(sk) : []);
      const ptsNormal: number[] = [];
      const ptsRed: number[] = [];
      const ptsSel: number[] = [];
      const centers = new Set<string>();
      for (const e of sk.entities) if (e.type === 'circle') centers.add(e.c);
      for (const p of sk.points) {
        const used = sk.entities.some((e) => (e.type === 'circle' ? e.c === p.id : e.a === p.id || e.b === p.id));
        if (!used) continue;
        const arr = selPts.has(p.id) ? ptsSel : dangling.has(p.id) ? ptsRed : ptsNormal;
        arr.push(p.x, p.y, 0.05);
      }
      if (active || selection?.kind === 'sketch') {
        g.add(points(ptsNormal, 0x1f4fa8, 9));
        g.add(points(ptsSel, C_SEL, 13));
      }
      g.add(points(ptsRed, C_GAP, active ? 14 : 0));
      // środki łuków (pomocniczo)
      if (active) {
        const ac: number[] = [];
        for (const e of sk.entities)
          if (e.type === 'arc') {
            const gm = arcGeometry(pts.get(e.a)!, pts.get(e.b)!, e.bulge);
            ac.push(gm.center[0], gm.center[1], 0.05);
          }
        g.add(points(ac, 0x8090a0, 6));
      }
      g.updateMatrixWorld(true);
      this.group.add(g);
    }
  }

  setPreview(plane: Plane | null, polys: Vec2[][], marks: Vec2[] = [], snapMark: Vec2 | null = null) {
    for (const c of this.preview.children) disposeDeep(c);
    this.preview.clear();
    if (!plane) return;
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    g.matrix.copy(planeMatrix(plane));
    if (polys.length) g.add(fat(polyToSeg(polys, 0.06), mats.preview, 8));
    if (marks.length) g.add(points(marks.flatMap((m) => [m[0], m[1], 0.07]), 0x00a86b, 10));
    if (snapMark) g.add(points([snapMark[0], snapMark[1], 0.08], 0xff00aa, 15));
    g.updateMatrixWorld(true);
    this.preview.add(g);
  }
}

function fat(seg: number[], mat: ReturnType<typeof makeLineMaterial>, order: number) {
  const g = new LineSegmentsGeometry();
  g.setPositions(seg);
  const l = new LineSegments2(g, mat);
  l.renderOrder = order;
  return l;
}

const dotTexture = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(32, 32, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#000';
  ctx.stroke();
  return new THREE.CanvasTexture(c);
})();

function points(arr: number[], color: number, size: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  const m = new THREE.PointsMaterial({
    color,
    size: size * Math.min(window.devicePixelRatio, 2),
    sizeAttenuation: false,
    map: dotTexture,
    alphaTest: 0.3,
    depthTest: false,
    transparent: true,
  });
  const p = new THREE.Points(g, m);
  p.renderOrder = 9;
  return p;
}

function disposeDeep(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | undefined;
    if (mat && !Object.values(mats).includes(mat as never)) mat.dispose?.();
  });
}
