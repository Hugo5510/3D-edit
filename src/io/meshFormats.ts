// Formaty siatkowe: STL (binarny/ASCII), OBJ, PLY, GLB/glTF. 1 jednostka = 1 mm (o ile nie zaznaczono inaczej).
import type { MeshData } from '../kernel/meshOps';

export interface NamedMesh extends MeshData {
  name: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function triNormal(p: Float32Array, a: number, b: number, c: number): [number, number, number] {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

const num = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};

// ------------------------------------------------------------------------- STL

export function writeStlBinary(meshes: MeshData[], header = '3D Edit STL, units: mm'): Uint8Array {
  const nt = meshes.reduce((s, m) => s + m.indices.length / 3, 0);
  const buf = new ArrayBuffer(84 + nt * 50);
  const u8 = new Uint8Array(buf);
  u8.set(enc.encode(header.slice(0, 80)));
  const dv = new DataView(buf);
  dv.setUint32(80, nt, true);
  let o = 84;
  for (const m of meshes) {
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = m.indices[t], b = m.indices[t + 1], c = m.indices[t + 2];
      const n = triNormal(p, a, b, c);
      for (const v of n) {
        dv.setFloat32(o, v, true);
        o += 4;
      }
      for (const i of [a, b, c])
        for (let k = 0; k < 3; k++) {
          dv.setFloat32(o, p[i * 3 + k], true);
          o += 4;
        }
      dv.setUint16(o, 0, true);
      o += 2;
    }
  }
  return u8;
}

export function writeStlAscii(meshes: NamedMesh[]): string {
  const out: string[] = [];
  for (const m of meshes) {
    const name = m.name.replace(/\s+/g, '_') || 'bryla';
    out.push(`solid ${name}`);
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = m.indices[t], b = m.indices[t + 1], c = m.indices[t + 2];
      const n = triNormal(p, a, b, c);
      out.push(`  facet normal ${n.map(num).join(' ')}`, '    outer loop');
      for (const i of [a, b, c]) out.push(`      vertex ${num(p[i * 3])} ${num(p[i * 3 + 1])} ${num(p[i * 3 + 2])}`);
      out.push('    endloop', '  endfacet');
    }
    out.push(`endsolid ${name}`);
  }
  return out.join('\n') + '\n';
}

export function parseStl(data: ArrayBuffer): MeshData {
  const u8 = new Uint8Array(data);
  const dv = new DataView(data);
  const isBinary = () => {
    if (data.byteLength < 84) return false;
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === data.byteLength) return true;
    const head = dec.decode(u8.subarray(0, Math.min(512, u8.length))).trimStart();
    return !head.startsWith('solid') || !/facet/.test(dec.decode(u8.subarray(0, Math.min(2048, u8.length))));
  };
  if (isBinary()) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 > data.byteLength) throw new Error('Uszkodzony plik STL (za krótki)');
    const pos = new Float32Array(n * 9);
    let o = 84;
    for (let t = 0; t < n; t++) {
      o += 12;
      for (let k = 0; k < 9; k++) {
        pos[t * 9 + k] = dv.getFloat32(o, true);
        o += 4;
      }
      o += 2;
    }
    return { positions: pos, indices: Uint32Array.from({ length: n * 3 }, (_, i) => i) };
  }
  const text = dec.decode(u8);
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  const vals: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) vals.push(+m[1], +m[2], +m[3]);
  if (!vals.length || vals.length % 9) throw new Error('Nie rozpoznano trójkątów w pliku STL');
  return { positions: new Float32Array(vals), indices: Uint32Array.from({ length: vals.length / 3 }, (_, i) => i) };
}

// ------------------------------------------------------------------------- OBJ

export function writeObj(meshes: NamedMesh[]): string {
  const out = ['# 3D Edit – jednostki: milimetry (1 jednostka = 1 mm)'];
  let base = 1;
  for (const m of meshes) {
    out.push(`o ${m.name.replace(/\s+/g, '_') || 'bryla'}`);
    for (let i = 0; i < m.positions.length; i += 3) out.push(`v ${num(m.positions[i])} ${num(m.positions[i + 1])} ${num(m.positions[i + 2])}`);
    for (let t = 0; t < m.indices.length; t += 3) out.push(`f ${m.indices[t] + base} ${m.indices[t + 1] + base} ${m.indices[t + 2] + base}`);
    base += m.positions.length / 3;
  }
  return out.join('\n') + '\n';
}

export function parseObj(text: string): NamedMesh[] {
  const verts: number[] = [];
  const groups: { name: string; tris: number[] }[] = [{ name: 'obj', tris: [] }];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      verts.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith('o ') || line.startsWith('g ')) {
      const name = line.slice(2).trim();
      if (groups[groups.length - 1].tris.length) groups.push({ name, tris: [] });
      else groups[groups.length - 1].name = name;
    } else if (line.startsWith('f ')) {
      const nv = verts.length / 3;
      const idx = line
        .split(/\s+/)
        .slice(1)
        .map((s) => {
          const i = parseInt(s.split('/')[0], 10);
          return i < 0 ? nv + i : i - 1;
        });
      for (let k = 1; k + 1 < idx.length; k++) groups[groups.length - 1].tris.push(idx[0], idx[k], idx[k + 1]);
    }
  }
  const positions = new Float32Array(verts);
  const res = groups.filter((g) => g.tris.length).map((g) => ({ name: g.name, positions, indices: new Uint32Array(g.tris) }));
  if (!res.length) throw new Error('Plik OBJ nie zawiera ścian');
  return res;
}

// ------------------------------------------------------------------------- PLY

export function writePly(meshes: MeshData[]): Uint8Array {
  const nv = meshes.reduce((s, m) => s + m.positions.length / 3, 0);
  const nf = meshes.reduce((s, m) => s + m.indices.length / 3, 0);
  const header = enc.encode(
    `ply\nformat binary_little_endian 1.0\ncomment 3D Edit, units: mm\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nelement face ${nf}\nproperty list uchar uint vertex_indices\nend_header\n`,
  );
  const buf = new ArrayBuffer(header.length + nv * 12 + nf * 13);
  const u8 = new Uint8Array(buf);
  u8.set(header);
  const dv = new DataView(buf);
  let o = header.length;
  for (const m of meshes)
    for (let i = 0; i < m.positions.length; i++) {
      dv.setFloat32(o, m.positions[i], true);
      o += 4;
    }
  let base = 0;
  for (const m of meshes) {
    for (let t = 0; t < m.indices.length; t += 3) {
      dv.setUint8(o, 3);
      o += 1;
      for (let k = 0; k < 3; k++) {
        dv.setUint32(o, m.indices[t + k] + base, true);
        o += 4;
      }
    }
    base += m.positions.length / 3;
  }
  return u8;
}

const PLY_SIZES: Record<string, number> = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };

export function parsePly(data: ArrayBuffer): MeshData {
  const u8 = new Uint8Array(data);
  const headEnd = dec.decode(u8.subarray(0, Math.min(u8.length, 8192))).indexOf('end_header');
  if (headEnd < 0) throw new Error('Nieprawidłowy plik PLY');
  const headerText = dec.decode(u8.subarray(0, headEnd));
  let bodyStart = headEnd + 'end_header'.length;
  while (u8[bodyStart] === 13 || u8[bodyStart] === 10) {
    bodyStart++;
    if (u8[bodyStart - 1] === 10) break;
  }
  const lines = headerText.split(/\r?\n/);
  const format = lines.find((l) => l.startsWith('format'))?.split(/\s+/)[1] ?? 'ascii';
  type Prop = { name: string; type: string; list?: { count: string; item: string } };
  const elements: { name: string; count: number; props: Prop[] }[] = [];
  for (const l of lines) {
    const p = l.trim().split(/\s+/);
    if (p[0] === 'element') elements.push({ name: p[1], count: +p[2], props: [] });
    else if (p[0] === 'property' && elements.length) {
      if (p[1] === 'list') elements[elements.length - 1].props.push({ name: p[4], type: 'list', list: { count: p[2], item: p[3] } });
      else elements[elements.length - 1].props.push({ name: p[2], type: p[1] });
    }
  }
  const pos: number[] = [];
  const tris: number[] = [];
  if (format === 'ascii') {
    const tokens = dec.decode(u8.subarray(bodyStart)).trim().split(/\s+/).map(Number);
    let t = 0;
    for (const el of elements)
      for (let i = 0; i < el.count; i++) {
        const v: Record<string, number> = {};
        let list: number[] = [];
        for (const pr of el.props) {
          if (pr.list) {
            const n = tokens[t++];
            list = tokens.slice(t, t + n);
            t += n;
          } else v[pr.name] = tokens[t++];
        }
        if (el.name === 'vertex') pos.push(v.x, v.y, v.z);
        if (el.name === 'face') for (let k = 1; k + 1 < list.length; k++) tris.push(list[0], list[k], list[k + 1]);
      }
  } else {
    const le = format === 'binary_little_endian';
    const dv = new DataView(data);
    let o = bodyStart;
    const read = (type: string) => {
      let v: number;
      switch (type) {
        case 'char': case 'int8': v = dv.getInt8(o); break;
        case 'uchar': case 'uint8': v = dv.getUint8(o); break;
        case 'short': case 'int16': v = dv.getInt16(o, le); break;
        case 'ushort': case 'uint16': v = dv.getUint16(o, le); break;
        case 'int': case 'int32': v = dv.getInt32(o, le); break;
        case 'uint': case 'uint32': v = dv.getUint32(o, le); break;
        case 'float': case 'float32': v = dv.getFloat32(o, le); break;
        default: v = dv.getFloat64(o, le);
      }
      o += PLY_SIZES[type] ?? 8;
      return v;
    };
    for (const el of elements)
      for (let i = 0; i < el.count; i++) {
        const v: Record<string, number> = {};
        let list: number[] = [];
        for (const pr of el.props) {
          if (pr.list) {
            const n = read(pr.list.count);
            list = [];
            for (let k = 0; k < n; k++) list.push(read(pr.list.item));
          } else v[pr.name] = read(pr.type);
        }
        if (el.name === 'vertex') pos.push(v.x, v.y, v.z);
        if (el.name === 'face') for (let k = 1; k + 1 < list.length; k++) tris.push(list[0], list[k], list[k + 1]);
      }
  }
  if (!tris.length) throw new Error('Plik PLY nie zawiera ścian (chmury punktów nie są obsługiwane)');
  return { positions: new Float32Array(pos), indices: new Uint32Array(tris) };
}

// ------------------------------------------------------------------------- GLB / glTF

/** GLB z siatkami. scale – mnożnik współrzędnych (1 = milimetry, 0.001 = metry zgodnie ze specyfikacją glTF). */
export function writeGlb(meshes: NamedMesh[], scale = 1): Uint8Array {
  const bins: Uint8Array[] = [];
  let off = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const gMeshes: object[] = [];
  const nodes: object[] = [];
  const pushBin = (arr: Float32Array | Uint32Array, target: number) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, target });
    bins.push(bytes);
    if (pad) bins.push(new Uint8Array(pad));
    off += bytes.length + pad;
    return bufferViews.length - 1;
  };
  for (const m of meshes) {
    const p = new Float32Array(m.positions.length);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i++) {
      // glTF ma oś Y do góry: (x, y, z)_CAD -> (x, z, -y)
      const k = i % 3;
      const base = i - k;
      const v = k === 0 ? m.positions[base] : k === 1 ? m.positions[base + 2] : -m.positions[base + 1];
      p[i] = v * scale;
      min[k] = Math.min(min[k], p[i]);
      max[k] = Math.max(max[k], p[i]);
    }
    const bvP = pushBin(p, 34962);
    const bvI = pushBin(new Uint32Array(m.indices), 34963);
    accessors.push({ bufferView: bvP, componentType: 5126, count: p.length / 3, type: 'VEC3', min, max });
    accessors.push({ bufferView: bvI, componentType: 5125, count: m.indices.length, type: 'SCALAR' });
    gMeshes.push({ name: m.name, primitives: [{ attributes: { POSITION: accessors.length - 2 }, indices: accessors.length - 1, mode: 4 }] });
    nodes.push({ name: m.name, mesh: gMeshes.length - 1 });
  }
  const json = {
    asset: { version: '2.0', generator: '3D Edit' },
    extras: { units: scale === 1 ? 'millimeters (1 unit = 1 mm)' : 'meters' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gMeshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: off }],
  };
  let jsonBytes = enc.encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  if (jpad) jsonBytes = new Uint8Array([...jsonBytes, ...new Array(jpad).fill(0x20)]);
  const total = 12 + 8 + jsonBytes.length + 8 + off;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  let o = 20 + jsonBytes.length;
  dv.setUint32(o, off, true);
  dv.setUint32(o + 4, 0x004e4942, true);
  o += 8;
  for (const b of bins) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

type GltfJson = {
  scene?: number;
  scenes?: { nodes: number[] }[];
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; name?: string }[];
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { byteLength: number; uri?: string }[];
};

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Odczyt GLB lub glTF z osadzonymi danymi. scale – mnożnik do mm. */
export function parseGltf(data: ArrayBuffer, scale = 1): NamedMesh[] {
  const u8 = new Uint8Array(data);
  const dv = new DataView(data);
  let json: GltfJson;
  const buffers: Uint8Array[] = [];
  if (dv.byteLength >= 12 && dv.getUint32(0, true) === 0x46546c67) {
    let o = 12;
    let bin: Uint8Array | null = null;
    json = {};
    while (o < u8.length) {
      const len = dv.getUint32(o, true);
      const type = dv.getUint32(o + 4, true);
      const chunk = u8.subarray(o + 8, o + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(dec.decode(chunk));
      else if (type === 0x004e4942) bin = chunk;
      o += 8 + len;
    }
    (json.buffers ?? []).forEach((b, i) => {
      if (i === 0 && !b.uri && bin) buffers.push(bin);
      else if (b.uri?.startsWith('data:')) buffers.push(b64ToBytes(b.uri.split(',')[1]));
      else throw new Error('Zewnętrzne pliki .bin glTF nie są obsługiwane – użyj GLB');
    });
  } else {
    json = JSON.parse(dec.decode(u8));
    for (const b of json.buffers ?? []) {
      if (b.uri?.startsWith('data:')) buffers.push(b64ToBytes(b.uri.split(',')[1]));
      else throw new Error('Plik .gltf odwołuje się do zewnętrznego .bin – zapisz model jako GLB (jeden plik)');
    }
  }
  const readAccessor = (idx: number): number[] => {
    const a = json.accessors![idx];
    const bv = json.bufferViews![a.bufferView ?? 0];
    const buf = buffers[bv.buffer];
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type as 'SCALAR'] ?? 1;
    const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType as 5126] ?? 4;
    const stride = bv.byteStride ?? comps * size;
    const base = buf.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const d = new DataView(buf.buffer);
    const out: number[] = [];
    for (let i = 0; i < a.count; i++)
      for (let c = 0; c < comps; c++) {
        const o = base + i * stride + c * size;
        switch (a.componentType) {
          case 5126: out.push(d.getFloat32(o, true)); break;
          case 5125: out.push(d.getUint32(o, true)); break;
          case 5123: out.push(d.getUint16(o, true)); break;
          case 5121: out.push(d.getUint8(o)); break;
          case 5122: out.push(d.getInt16(o, true)); break;
          default: out.push(d.getInt8(o));
        }
      }
    return out;
  };
  const res: NamedMesh[] = [];
  const mul = (a: number[], b: number[]) => {
    const r = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k];
    return r;
  };
  const nodeMatrix = (n: NonNullable<GltfJson['nodes']>[number]) => {
    if (n.matrix) return n.matrix;
    const [tx, ty, tz] = n.translation ?? [0, 0, 0];
    const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
    const [sx, sy, sz] = n.scale ?? [1, 1, 1];
    return [
      (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1,
    ];
  };
  const visit = (ni: number, parent: number[]) => {
    const n = json.nodes![ni];
    const m = mul(parent, nodeMatrix(n));
    if (n.mesh !== undefined) {
      const mesh = json.meshes![n.mesh];
      for (const pr of mesh.primitives) {
        if ((pr.mode ?? 4) !== 4) continue;
        const p = readAccessor(pr.attributes.POSITION);
        const nvtx = p.length / 3;
        const idx = pr.indices !== undefined ? readAccessor(pr.indices) : Array.from({ length: nvtx }, (_, i) => i);
        const pos = new Float32Array(p.length);
        for (let i = 0; i < nvtx; i++) {
          const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
          const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
          const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
          const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
          // Y do góry -> Z do góry
          pos[i * 3] = wx * scale;
          pos[i * 3 + 1] = -wz * scale;
          pos[i * 3 + 2] = wy * scale;
        }
        res.push({ name: mesh.name ?? n.name ?? 'glTF', positions: pos, indices: new Uint32Array(idx) });
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_, i) => i);
  for (const r of roots) visit(r, id);
  if (!res.length) throw new Error('Plik glTF nie zawiera siatek trójkątów');
  return res;
}
