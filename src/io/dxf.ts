// DXF dla szkiców 2D: zapis (LINE, ARC, CIRCLE) i odczyt (LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE).
import type { Sketch } from '../model/types';
import { arcGeometry, pointMap } from '../model/sketchGeom';
import { addArc, addCircle, addLine, type PointSpec } from '../model/sketchOps';
import { bulgeFromCenter } from '../model/sketchGeom';

const n = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};

export function writeDxf(sketches: Sketch[]): string {
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), typeof value === 'number' ? n(value) : value);
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  g(70, '4'); // milimetry
  g(9, '$MEASUREMENT');
  g(70, '1');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const sk of sketches) {
    const layer = sk.name.replace(/[^\w\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]/g, '_') || 'SZKIC';
    const pts = pointMap(sk);
    for (const e of sk.entities) {
      if (e.type === 'line') {
        const a = pts.get(e.a)!, b = pts.get(e.b)!;
        g(0, 'LINE');
        g(8, layer);
        g(10, a[0]); g(20, a[1]); g(30, 0);
        g(11, b[0]); g(21, b[1]); g(31, 0);
      } else if (e.type === 'circle') {
        const c = pts.get(e.c)!;
        g(0, 'CIRCLE');
        g(8, layer);
        g(10, c[0]); g(20, c[1]); g(30, 0);
        g(40, e.r);
      } else {
        const a = pts.get(e.a)!, b = pts.get(e.b)!;
        const geo = arcGeometry(a, b, e.bulge);
        // ARC w DXF zawsze przeciwnie do wskazówek zegara: dla łuku CW zamieniamy końce
        const [s, t] = e.bulge > 0 ? [a, b] : [b, a];
        const ang = (p: number[]) => ((Math.atan2(p[1] - geo.center[1], p[0] - geo.center[0]) * 180) / Math.PI + 360) % 360;
        g(0, 'ARC');
        g(8, layer);
        g(10, geo.center[0]); g(20, geo.center[1]); g(30, 0);
        g(40, geo.r);
        g(50, ang(s));
        g(51, ang(t));
      }
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\n') + '\n';
}

const UNIT_MM: Record<number, number> = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0254, 9: 0.0254, 10: 914.4, 13: 0.001, 14: 100 };

/** Odczyt DXF do szkicu (płaszczyzna XY). Punkty o tych samych współrzędnych są łączone. */
export function parseDxf(text: string, sk: Sketch): { entities: number; skipped: string[] } {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  let scale = 1;
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS' && pairs[i + 1]) scale = UNIT_MM[parseInt(pairs[i + 1][1], 10)] ?? 1;
  }
  const pointIds = new Map<string, string>();
  const spec = (x: number, y: number): PointSpec => {
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`;
    return { id: pointIds.get(key), x, y };
  };
  const remember = (x: number, y: number, id: string) => pointIds.set(`${Math.round(x * 1e5)},${Math.round(y * 1e5)}`, id);
  const skipped = new Set<string>();
  let count = 0;
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    const r = addLine(sk, spec(x1, y1), spec(x2, y2));
    if (r) {
      remember(x1, y1, r.a);
      remember(x2, y2, r.b);
      count++;
    }
  };
  const arcBulge = (x1: number, y1: number, x2: number, y2: number, bulge: number) => {
    if (Math.abs(bulge) < 1e-9) return line(x1, y1, x2, y2);
    const e = addArc(sk, spec(x1, y1), spec(x2, y2), bulge);
    if (e) {
      remember(x1, y1, e.a);
      remember(x2, y2, e.b);
      count++;
    }
  };
  // sekcja ENTITIES
  let i = pairs.findIndex((p, k) => p[0] === 2 && p[1] === 'ENTITIES' && pairs[k - 1]?.[1] === 'SECTION');
  if (i < 0) throw new Error('Plik DXF nie zawiera sekcji ENTITIES');
  i++;
  while (i < pairs.length) {
    if (pairs[i][0] !== 0) {
      i++;
      continue;
    }
    const type = pairs[i][1];
    if (type === 'ENDSEC' || type === 'EOF') break;
    const start = ++i;
    while (i < pairs.length && pairs[i][0] !== 0) i++;
    const body = pairs.slice(start, i);
    const get = (code: number, def = 0) => {
      const p = body.find((x) => x[0] === code);
      return p ? parseFloat(p[1]) * (code >= 10 && code <= 40 ? scale : 1) : def;
    };
    if (type === 'LINE') line(get(10), get(20), get(11), get(21));
    else if (type === 'CIRCLE') {
      if (addCircle(sk, { x: get(10), y: get(20) }, get(40))) count++;
    } else if (type === 'ARC') {
      const cx = get(10), cy = get(20), r = get(40);
      const a0 = (get(50) * Math.PI) / 180, a1 = (get(51) * Math.PI) / 180;
      const p0: [number, number] = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
      const p1: [number, number] = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
      arcBulge(p0[0], p0[1], p1[0], p1[1], bulgeFromCenter([cx, cy], p0, p1, 1));
    } else if (type === 'LWPOLYLINE') {
      const closed = (get(70) & 1) === 1;
      const verts: { x: number; y: number; b: number }[] = [];
      for (const [c, v] of body) {
        if (c === 10) verts.push({ x: parseFloat(v) * scale, y: 0, b: 0 });
        else if (c === 20 && verts.length) verts[verts.length - 1].y = parseFloat(v) * scale;
        else if (c === 42 && verts.length) verts[verts.length - 1].b = parseFloat(v);
      }
      const nseg = closed ? verts.length : verts.length - 1;
      for (let k = 0; k < nseg; k++) {
        const a = verts[k], b = verts[(k + 1) % verts.length];
        arcBulge(a.x, a.y, b.x, b.y, a.b);
      }
    } else if (type === 'POLYLINE') {
      const closed = (get(70) & 1) === 1;
      const verts: { x: number; y: number; b: number }[] = [];
      while (i < pairs.length && pairs[i][1] === 'VERTEX' && pairs[i][0] === 0) {
        const vs = ++i;
        while (i < pairs.length && pairs[i][0] !== 0) i++;
        const vb = pairs.slice(vs, i);
        const vg = (code: number) => parseFloat(vb.find((x) => x[0] === code)?.[1] ?? '0');
        verts.push({ x: vg(10) * scale, y: vg(20) * scale, b: vg(42) });
      }
      const nseg = closed ? verts.length : verts.length - 1;
      for (let k = 0; k < nseg; k++) {
        const a = verts[k], b = verts[(k + 1) % verts.length];
        arcBulge(a.x, a.y, b.x, b.y, a.b);
      }
    } else if (type !== 'SEQEND') skipped.add(type);
  }
  return { entities: count, skipped: [...skipped] };
}
