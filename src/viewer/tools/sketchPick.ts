import * as THREE from 'three';
import type { PointerInfo, Viewer } from '../Viewer';
import { rayPlane } from '../Viewer';
import { useApp, type Selection } from '../../state/store';
import type { Sketch, Vec2 } from '../../model/types';
import { toPlane, loopPolygon, orderLoop, pointInPolygon, polygonArea } from '../../model/sketchGeom';
import { entitySegments2D } from '../SketchLayer';
import { v2 } from '../../model/math';

export function segDist2(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = v2.sub(b, a);
  const l2 = v2.dot(ab, ab);
  if (l2 < 1e-12) return v2.dist(p, a);
  const t = Math.max(0, Math.min(1, v2.dot(v2.sub(p, a), ab) / l2));
  return v2.dist(p, v2.add(a, v2.scale(ab, t)));
}

/** Punkt przecięcia promienia z płaszczyzną szkicu (współrzędne 2D) i skala px→mm. */
export function sketchCursor(viewer: Viewer, e: PointerInfo, sk: Sketch): { p: Vec2; world: THREE.Vector3; mmPerPx: number } | null {
  const w = rayPlane(e.ray, sk.plane.origin, sk.plane.normal);
  if (!w) return null;
  return { p: toPlane(sk.plane, [w.x, w.y, w.z]), world: w, mmPerPx: viewer.worldPerPixel(w) };
}

export interface SketchHit {
  sketchId: string;
  kind: 'point' | 'entity' | 'profile';
  id: string;
  depth: number;
  selection: Selection;
}

export function hitSketch(viewer: Viewer, e: PointerInfo, sk: Sketch, tolPx = 10, allowProfiles = true): SketchHit | null {
  const cur = sketchCursor(viewer, e, sk);
  if (!cur) return null;
  const tol = cur.mmPerPx * (e.pointerType === 'touch' ? tolPx * 2 : tolPx);
  const depth = viewer.camera.position.distanceTo(cur.world);
  // punkty mają pierwszeństwo
  let bestP: { id: string; d: number } | null = null;
  for (const p of sk.points) {
    const used = sk.entities.some((en) => (en.type === 'circle' ? en.c === p.id : en.a === p.id || en.b === p.id));
    if (!used) continue;
    const d = v2.dist(cur.p, [p.x, p.y]);
    if (d < tol * 0.9 && (!bestP || d < bestP.d)) bestP = { id: p.id, d };
  }
  if (bestP) return { sketchId: sk.id, kind: 'point', id: bestP.id, depth, selection: { kind: 'sketch', sketchId: sk.id, entities: [], points: [bestP.id] } };
  let bestE: { id: string; d: number } | null = null;
  for (const en of sk.entities) {
    for (const poly of entitySegments2D(sk, en.id))
      for (let i = 0; i + 1 < poly.length; i++) {
        const d = segDist2(cur.p, poly[i], poly[i + 1]);
        if (d < tol && (!bestE || d < bestE.d)) bestE = { id: en.id, d };
      }
  }
  if (bestE) return { sketchId: sk.id, kind: 'entity', id: bestE.id, depth, selection: { kind: 'sketch', sketchId: sk.id, entities: [bestE.id], points: [] } };
  if (allowProfiles) {
    let bestPr: { id: string; area: number } | null = null;
    for (const pr of sk.profiles) {
      try {
        const loops = pr.loops.map((ids) => loopPolygon(orderLoop(sk, ids)));
        if (!pointInPolygon(cur.p, loops[0])) continue;
        if (loops.slice(1).some((h) => pointInPolygon(cur.p, h))) continue;
        const area = Math.abs(polygonArea(loops[0]));
        if (!bestPr || area < bestPr.area) bestPr = { id: pr.id, area };
      } catch {
        /* pomiń */
      }
    }
    if (bestPr) return { sketchId: sk.id, kind: 'profile', id: bestPr.id, depth, selection: { kind: 'profile', sketchId: sk.id, profileId: bestPr.id } };
  }

  return null;
}

/** Trafienie w dowolny widoczny szkic (najbliższy kamerze). */
export function pickSketch(viewer: Viewer, e: PointerInfo, onlyProfiles = false): SketchHit | null {
  const st = useApp.getState();
  let best: SketchHit | null = null;
  for (const sk of st.doc.sketches) {
    if (!sk.visible && sk.id !== st.activeSketchId) continue;
    const h = hitSketch(viewer, e, sk);
    if (!h) continue;
    if (onlyProfiles && h.kind !== 'profile') continue;
    if (!best || h.depth < best.depth) best = h;
  }
  return best;
}
