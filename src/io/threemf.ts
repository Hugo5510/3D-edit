// 3MF (rdzeń specyfikacji 3MF Core): zapis i odczyt. Jednostka zapisu: milimetr.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { NamedMesh } from './meshFormats';

const num = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

export interface ThreeMfOptions {
  title?: string;
  /** Przesunięcie dodawane do wszystkich wierzchołków (np. ułożenie na stole drukarki). */
  offset?: [number, number, number];
}

export function write3mf(meshes: NamedMesh[], opts: ThreeMfOptions = {}): Uint8Array {
  const [ox, oy, oz] = opts.offset ?? [0, 0, 0];
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<model unit="millimeter" xml:lang="pl-PL" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">');
  parts.push(`<metadata name="Title">${esc(opts.title ?? '3D Edit')}</metadata>`);
  parts.push('<metadata name="Application">3D Edit</metadata>');
  parts.push('<resources>');
  meshes.forEach((m, i) => {
    parts.push(`<object id="${i + 1}" type="model" name="${esc(m.name)}"><mesh><vertices>`);
    const p = m.positions;
    const vs: string[] = [];
    for (let k = 0; k < p.length; k += 3) vs.push(`<vertex x="${num(p[k] + ox)}" y="${num(p[k + 1] + oy)}" z="${num(p[k + 2] + oz)}"/>`);
    parts.push(vs.join(''));
    parts.push('</vertices><triangles>');
    const ts: string[] = [];
    for (let t = 0; t < m.indices.length; t += 3) ts.push(`<triangle v1="${m.indices[t]}" v2="${m.indices[t + 1]}" v3="${m.indices[t + 2]}"/>`);
    parts.push(ts.join(''));
    parts.push('</triangles></mesh></object>');
  });
  parts.push('</resources><build>');
  meshes.forEach((_, i) => parts.push(`<item objectid="${i + 1}"/>`));
  parts.push('</build></model>');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    ),
    '3D/3dmodel.model': strToU8(parts.join('\n')),
  };
  return zipSync(files, { level: 6 });
}

const UNIT_TO_MM: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[2];
  return out;
}

type M43 = number[]; // 12 liczb (konwencja 3MF: wiersze m00 m01 m02 / m10.. / m20.. / m30 m31 m32)
const ID: M43 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function parseT(s?: string): M43 {
  if (!s) return ID;
  const v = s.trim().split(/\s+/).map(Number);
  return v.length === 12 ? v : ID;
}
/** Złożenie: najpierw a, potem b. */
function compose(a: M43, b: M43): M43 {
  const r: M43 = new Array(12).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) {
      let s = i === 3 ? b[9 + j] : 0;
      for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
      r[i * 3 + j] = s;
    }
  return r;
}

interface RawObject {
  name: string;
  positions?: number[];
  indices?: number[];
  components?: { objectid: string; path?: string; t: M43 }[];
}

function parseModel(xml: string): { unit: number; objects: Map<string, RawObject>; build: { objectid: string; path?: string; t: M43 }[] } {
  const unitAttr = /<model\b([^>]*)>/.exec(xml);
  const unit = UNIT_TO_MM[attrs(unitAttr?.[1] ?? '').unit ?? 'millimeter'] ?? 1;
  const objects = new Map<string, RawObject>();
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(xml))) {
    const a = attrs(m[1]);
    const body = m[2];
    const o: RawObject = { name: a.name ?? `Obiekt ${a.id}` };
    const meshM = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/.exec(body);
    if (meshM) {
      const pos: number[] = [];
      const vRe = /<vertex\b([^>]*)\/?>/g;
      let v: RegExpExecArray | null;
      while ((v = vRe.exec(meshM[1]))) {
        const va = attrs(v[1]);
        pos.push(+va.x, +va.y, +va.z);
      }
      const idx: number[] = [];
      const tRe = /<triangle\b([^>]*)\/?>/g;
      let t: RegExpExecArray | null;
      while ((t = tRe.exec(meshM[1]))) {
        const ta = attrs(t[1]);
        idx.push(+ta.v1, +ta.v2, +ta.v3);
      }
      o.positions = pos;
      o.indices = idx;
    }
    const comps = /<components\b[^>]*>([\s\S]*?)<\/components>/.exec(body);
    if (comps) {
      o.components = [];
      const cRe = /<component\b([^>]*)\/?>/g;
      let c: RegExpExecArray | null;
      while ((c = cRe.exec(comps[1]))) {
        const ca = attrs(c[1]);
        o.components.push({ objectid: ca.objectid, path: ca['p:path'] ?? ca.path, t: parseT(ca.transform) });
      }
    }
    objects.set(a.id, o);
  }
  const build: { objectid: string; path?: string; t: M43 }[] = [];
  const bm = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(xml);
  if (bm) {
    const iRe = /<item\b([^>]*)\/?>/g;
    let it: RegExpExecArray | null;
    while ((it = iRe.exec(bm[1]))) {
      const ia = attrs(it[1]);
      build.push({ objectid: ia.objectid, path: ia['p:path'], t: parseT(ia.transform) });
    }
  }
  return { unit, objects, build };
}

/** Odczyt 3MF: każdy element sekcji build to osobna siatka (z zastosowanymi transformacjami), w mm. */
export function parse3mf(data: Uint8Array): NamedMesh[] {
  const files = unzipSync(data);
  const models = new Map<string, ReturnType<typeof parseModel>>();
  for (const [path, bytes] of Object.entries(files)) {
    if (path.toLowerCase().endsWith('.model')) models.set('/' + path.replace(/^\//, ''), parseModel(strFromU8(bytes)));
  }
  const rootPath = [...models.keys()].find((p) => /\/3d\/3dmodel\.model$/i.test(p)) ?? [...models.keys()][0];
  if (!rootPath) throw new Error('Plik 3MF nie zawiera modelu (3D/3dmodel.model)');
  const root = models.get(rootPath)!;
  const out: NamedMesh[] = [];
  const collect = (path: string, id: string, t: M43, acc: { pos: number[]; idx: number[] }, depth = 0) => {
    if (depth > 16) return;
    const model = models.get(path) ?? root;
    const o = model.objects.get(id);
    if (!o) return;
    const s = model.unit;
    if (o.positions && o.indices) {
      const base = acc.pos.length / 3;
      for (let i = 0; i < o.positions.length; i += 3) {
        const x = o.positions[i], y = o.positions[i + 1], z = o.positions[i + 2];
        acc.pos.push(
          (x * t[0] + y * t[3] + z * t[6] + t[9]) * s,
          (x * t[1] + y * t[4] + z * t[7] + t[10]) * s,
          (x * t[2] + y * t[5] + z * t[8] + t[11]) * s,
        );
      }
      for (const i of o.indices) acc.idx.push(i + base);
    }
    for (const c of o.components ?? []) collect(c.path ? '/' + c.path.replace(/^\//, '') : path, c.objectid, compose(c.t, t), acc, depth + 1);
  };
  for (const item of root.build) {
    const acc = { pos: [] as number[], idx: [] as number[] };
    const path = item.path ? '/' + item.path.replace(/^\//, '') : rootPath;
    collect(path, item.objectid, item.t, acc);
    if (acc.idx.length) out.push({ name: (models.get(path) ?? root).objects.get(item.objectid)?.name ?? '3MF', positions: new Float32Array(acc.pos), indices: new Uint32Array(acc.idx) });
  }
  if (!out.length) throw new Error('Plik 3MF nie zawiera siatek');
  return out;
}
