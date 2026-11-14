// Operacje na siatkach trójkątów (zaimportowane STL/OBJ/3MF...). Operacje logiczne przez manifold-3d.
import type { Mat4, Vec3 } from '../model/types';
import { applyPoint, determinant } from '../model/math';
import type { BooleanOp } from '../model/types';

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Scala wierzchołki o tych samych (z tolerancją) współrzędnych. */
export function weld(positions: Float32Array, indices: Uint32Array | null, tol = 1e-4): MeshData {
  const n = positions.length / 3;
  const idx = indices ?? Uint32Array.from({ length: n }, (_, i) => i);
  const map = new Map<string, number>();
  const remap = new Uint32Array(n);
  const out: number[] = [];
  const inv = 1 / tol;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let j = map.get(key);
    if (j === undefined) {
      j = out.length / 3;
      map.set(key, j);
      out.push(x, y, z);
    }
    remap[i] = j;
  }
  const tris: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = remap[idx[t]], b = remap[idx[t + 1]], c = remap[idx[t + 2]];
    if (a === b || b === c || a === c) continue; // trójkąty zdegenerowane
    tris.push(a, b, c);
  }
  return { positions: new Float32Array(out), indices: new Uint32Array(tris) };
}

export function meshVolume(m: MeshData): number {
  const p = m.positions;
  let v = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3;
    v +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
  }
  return v;
}

export function meshBBox(positions: Float32Array): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/** Każda krawędź używana dokładnie dwa razy, z przeciwną orientacją – siatka zamknięta. */
export function isClosedMesh(m: MeshData): boolean {
  const count = new Map<string, number>();
  const ix = m.indices;
  for (let t = 0; t < ix.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = ix[t + k], b = ix[t + ((k + 1) % 3)];
      const key = a + '_' + b;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  for (const [key, c] of count) {
    if (c !== 1) return false;
    const [a, b] = key.split('_');
    if (count.get(b + '_' + a) !== 1) return false;
  }
  return ix.length > 0;
}

export function transformMesh(m: MeshData, mat: Mat4): MeshData {
  const p = new Float32Array(m.positions.length);
  for (let i = 0; i < p.length; i += 3) {
    const q = applyPoint(mat, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
    p[i] = q[0];
    p[i + 1] = q[1];
    p[i + 2] = q[2];
  }
  let idx = m.indices;
  if (determinant(mat) < 0) {
    // odbicie lustrzane – odwracamy kolejność wierzchołków, żeby normalne wskazywały na zewnątrz
    idx = new Uint32Array(m.indices.length);
    for (let t = 0; t < idx.length; t += 3) {
      idx[t] = m.indices[t];
      idx[t + 1] = m.indices[t + 2];
      idx[t + 2] = m.indices[t + 1];
    }
  }
  return { positions: p, indices: idx };
}

export function flatNormals(m: MeshData): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const nt = m.indices.length / 3;
  const pos = new Float32Array(nt * 9);
  const nor = new Float32Array(nt * 9);
  const p = m.positions;
  for (let t = 0; t < nt; t++) {
    const a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) {
      const src = [a, b, c][k];
      pos[t * 9 + k * 3] = p[src];
      pos[t * 9 + k * 3 + 1] = p[src + 1];
      pos[t * 9 + k * 3 + 2] = p[src + 2];
      nor[t * 9 + k * 3] = nx;
      nor[t * 9 + k * 3 + 1] = ny;
      nor[t * 9 + k * 3 + 2] = nz;
    }
  }
  return { positions: pos, normals: nor, indices: Uint32Array.from({ length: nt * 3 }, (_, i) => i) };
}

// ---------------- manifold-3d ----------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ManifoldModule = any;
let manifoldPromise: Promise<ManifoldModule> | null = null;

export function setManifoldLoader(loader: () => Promise<ManifoldModule>) {
  manifoldPromise = loader();
}

async function getManifold(): Promise<ManifoldModule> {
  if (!manifoldPromise) {
    manifoldPromise = (async () => {
      const mod = await import('manifold-3d');
      const wasm = await mod.default();
      wasm.setup();
      return wasm;
    })();
  }
  return manifoldPromise;
}

let manifoldReady: ManifoldModule | null = null;
export async function preloadManifold() {
  manifoldReady = await getManifold();
  return manifoldReady;
}

function toManifold(wasm: ManifoldModule, m: MeshData) {
  const w = weld(m.positions, m.indices, 1e-4);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: w.positions, triVerts: w.indices });
  mesh.merge();
  try {
    return new wasm.Manifold(mesh);
  } catch (e) {
    throw new Error(
      'Siatka nie jest zamkniętą bryłą (manifold) – operacja logiczna niemożliwa. Napraw siatkę (np. w Blenderze: 3D Print Toolbox) i zaimportuj ponownie.',
    );
  }
}

/** Synchroniczna operacja logiczna na siatkach (wymaga wcześniejszego preloadManifold()). */
export function meshBoolean(op: BooleanOp, target: MeshData, tools: MeshData[]): MeshData {
  const wasm = manifoldReady;
  if (!wasm) throw new Error('Moduł manifold nie jest załadowany');
  let acc = toManifold(wasm, target);
  for (const t of tools) {
    const b = toManifold(wasm, t);
    const next = op === 'union' ? acc.add(b) : op === 'subtract' ? acc.subtract(b) : acc.intersect(b);
    acc.delete();
    b.delete();
    acc = next;
  }
  const out = acc.getMesh();
  acc.delete();
  const numProp = out.numProp as number;
  const vp = out.vertProperties as Float32Array;
  const positions = new Float32Array((vp.length / numProp) * 3);
  for (let i = 0, j = 0; i < vp.length; i += numProp, j += 3) {
    positions[j] = vp[i];
    positions[j + 1] = vp[i + 1];
    positions[j + 2] = vp[i + 2];
  }
  return { positions, indices: new Uint32Array(out.triVerts) };
}
