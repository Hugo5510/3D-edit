import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { BodyResult } from '../kernel/protocol';

export const lineMaterials: LineMaterial[] = [];
export function makeLineMaterial(color: number, width: number, depthTest = true, dashed = false): LineMaterial {
  const m = new LineMaterial({ color, linewidth: width, depthTest, dashed, transparent: !depthTest });
  m.resolution.set(window.innerWidth, window.innerHeight);
  lineMaterials.push(m);
  return m;
}

const edgeMaterial = () => makeLineMaterial(0x1d2430, 1.4);
let sharedEdgeMat: LineMaterial | null = null;

/** Zamienia polilinie krawędzi z workera na pary punktów odcinków. */
export function edgeSegments(points: Float32Array, start: number, count: number): number[] {
  const out: number[] = [];
  for (let i = start; i + 3 < start + count; i += 3) {
    out.push(points[i], points[i + 1], points[i + 2], points[i + 3], points[i + 4], points[i + 5]);
  }
  return out;
}

export class BodyView {
  group = new THREE.Group();
  mesh: THREE.Mesh;
  edges: LineSegments2 | null = null;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  data: BodyResult;

  constructor(data: BodyResult, color: string) {
    this.data = data;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    this.geometry.computeBoundingSphere();
    this.geometry.computeBoundingBox();
    this.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      metalness: 0.05,
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      side: data.closed ? THREE.FrontSide : THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.userData.bodyId = data.id;
    this.group.add(this.mesh);
    if (data.edges.length) {
      const seg: number[] = [];
      for (const e of data.edges) seg.push(...edgeSegments(data.edgePoints, e.start, e.count));
      const g = new LineSegmentsGeometry();
      g.setPositions(seg);
      if (!sharedEdgeMat) sharedEdgeMat = edgeMaterial();
      this.edges = new LineSegments2(g, sharedEdgeMat);
      this.edges.renderOrder = 1;
      this.group.add(this.edges);
    }
  }

  setColor(color: string, opacity = 1) {
    this.material.color.set(color);
    this.material.transparent = opacity < 1;
    this.material.opacity = opacity;
    this.material.depthWrite = opacity >= 1;
  }

  /** Geometria fragmentu (jednej ściany) do podświetlenia. */
  faceGeometry(face: number): THREE.BufferGeometry | null {
    const f = this.data.faces[face];
    if (!f || !f.count) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', this.geometry.getAttribute('position'));
    g.setAttribute('normal', this.geometry.getAttribute('normal'));
    g.setIndex(new THREE.BufferAttribute(this.data.indices.slice(f.start, f.start + f.count), 1));
    return g;
  }

  /** Indeks ściany dla trafionego trójkąta. */
  faceOfTriangle(tri: number): number {
    const idx = tri * 3;
    const faces = this.data.faces;
    for (let i = 0; i < faces.length; i++) if (idx >= faces[i].start && idx < faces[i].start + faces[i].count) return i;
    return -1;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.edges?.geometry.dispose();
  }
}
