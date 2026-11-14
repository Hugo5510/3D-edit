// Czyste funkcje modyfikujące dokument (łatwe do testowania). Każda zwraca nowy dokument.
import type { BodyMeta, Feature, Mat4, PrimitiveKind, ProjectDoc, Sketch, Plane } from '../model/types';
import { identity, mul, translation, uid } from '../model/math';

export function clone<T>(x: T): T {
  return structuredClone(x);
}

export const PRIMITIVE_NAMES: Record<PrimitiveKind, string> = {
  box: 'Prostopadłościan',
  cylinder: 'Walec',
  sphere: 'Kula',
  cone: 'Stożek',
  torus: 'Torus',
  prism: 'Graniastosłup',
  wedge: 'Klin',
};

export const PRIMITIVE_DEFAULTS: Record<PrimitiveKind, Record<string, number>> = {
  box: { w: 20, d: 20, h: 20 },
  cylinder: { r: 10, h: 20 },
  sphere: { r: 10 },
  cone: { r1: 10, r2: 0, h: 20 },
  torus: { R: 15, r: 4 },
  prism: { n: 6, r: 10, h: 20 },
  wedge: { w: 20, d: 20, h: 10, top: 0 },
};

const COLORS = ['#4f8fd6', '#d6894f', '#5fb36a', '#c95f8f', '#8f7bd6', '#c9b24f', '#4fb8b8'];

export function newBodyMeta(doc: ProjectDoc, base: string): BodyMeta {
  const n = doc.bodies.filter((b) => b.name.startsWith(base)).length + 1;
  return { id: uid('body'), name: `${base} ${n}`, color: COLORS[doc.bodies.length % COLORS.length], visible: true };
}

export function addPrimitive(doc: ProjectDoc, kind: PrimitiveKind, at: [number, number, number] = [0, 0, 0]) {
  const d = clone(doc);
  const meta = newBodyMeta(d, PRIMITIVE_NAMES[kind]);
  d.bodies.push(meta);
  d.features.push({
    id: uid('f'),
    type: 'primitive',
    bodyId: meta.id,
    kind,
    params: { ...PRIMITIVE_DEFAULTS[kind] },
    matrix: translation(at),
  });
  return { doc: d, bodyId: meta.id };
}

/** Czy operacja dotyczy bryły (tworzy ją, zmienia lub zużywa). */
export function touches(f: Feature, bodyId: string): boolean {
  if (f.bodyId === bodyId) return true;
  if (f.type === 'boolean' && f.tools.includes(bodyId)) return true;
  if (f.type === 'extrude' && f.source.kind === 'face' && f.source.bodyId === bodyId) return true;
  return false;
}

export function lastTouching(doc: ProjectDoc, bodyId: string): Feature | undefined {
  for (let i = doc.features.length - 1; i >= 0; i--) if (touches(doc.features[i], bodyId)) return doc.features[i];
  return undefined;
}

/**
 * Przekształca bryłę o macierz delta (w układzie świata). Przesunięcia i obroty dopisywane są do
 * ostatniej operacji bryły, jeśli jest to bryła gotowa lub przekształcenie; inaczej powstaje nowa
 * operacja „Przekształcenie”.
 */
export function transformBody(doc: ProjectDoc, bodyId: string, delta: Mat4, rigid: boolean): ProjectDoc {
  const d = clone(doc);
  const last = lastTouching(d, bodyId);
  if (last && last.bodyId === bodyId && (last.type === 'transform' || (rigid && last.type === 'primitive'))) {
    last.matrix = mul(delta, last.matrix);
  } else {
    d.features.push({ id: uid('f'), type: 'transform', bodyId, matrix: delta });
  }
  return d;
}

/** Usuwa bryłę: jeśli jej historia nie dotyczy innych brył – usuwa operacje, inaczej dopisuje „Usuń”. */
export function deleteBody(doc: ProjectDoc, bodyId: string): ProjectDoc {
  const d = clone(doc);
  const mine = d.features.filter((f) => touches(f, bodyId));
  const involvesOthers = mine.some(
    (f) =>
      (f.type === 'boolean' && (f.bodyId !== bodyId || f.tools.some((t) => t !== bodyId))) ||
      (f.type === 'extrude' && f.source.kind === 'face' && f.source.bodyId === bodyId && f.bodyId !== bodyId),
  );
  if (!involvesOthers) {
    d.features = d.features.filter((f) => !touches(f, bodyId));
    d.bodies = d.bodies.filter((b) => b.id !== bodyId);
  } else {
    d.features.push({ id: uid('f'), type: 'delete', bodyId });
  }
  return d;
}

export function removeFeature(doc: ProjectDoc, featureId: string): ProjectDoc {
  const d = clone(doc);
  const f = d.features.find((x) => x.id === featureId);
  d.features = d.features.filter((x) => x.id !== featureId);
  if (f && (f.type === 'primitive' || f.type === 'import' || (f.type === 'extrude' && f.mode === 'new'))) {
    if (!d.features.some((x) => touches(x, f.bodyId))) d.bodies = d.bodies.filter((b) => b.id !== f.bodyId);
  }
  return d;
}

export function updateFeature(doc: ProjectDoc, featureId: string, fn: (f: Feature) => void): ProjectDoc {
  const d = clone(doc);
  const f = d.features.find((x) => x.id === featureId);
  if (f) fn(f);
  return d;
}

export function addFeature(doc: ProjectDoc, f: Feature, body?: BodyMeta): ProjectDoc {
  const d = clone(doc);
  if (body) d.bodies.push(body);
  d.features.push(f);
  return d;
}

export function newSketch(doc: ProjectDoc, plane: Plane, name?: string): { doc: ProjectDoc; sketchId: string } {
  const d = clone(doc);
  const sk: Sketch = {
    id: uid('sk'),
    name: name ?? `Szkic ${d.sketches.length + 1}`,
    plane,
    points: [],
    entities: [],
    groups: [],
    profiles: [],
    visible: true,
  };
  d.sketches.push(sk);
  return { doc: d, sketchId: sk.id };
}

export function updateSketch(doc: ProjectDoc, sketchId: string, fn: (s: Sketch) => void): ProjectDoc {
  const d = clone(doc);
  const s = d.sketches.find((x) => x.id === sketchId);
  if (s) fn(s);
  return d;
}

export function featureLabel(f: Feature, doc: ProjectDoc): string {
  const bodyName = doc.bodies.find((b) => b.id === f.bodyId)?.name ?? '?';
  switch (f.type) {
    case 'primitive':
      return `${PRIMITIVE_NAMES[f.kind]} → ${bodyName}`;
    case 'extrude':
      return `Wyciągnięcie (${f.mode === 'cut' ? 'wytnij' : f.mode === 'join' ? 'dodaj' : 'nowa bryła'}) → ${bodyName}`;
    case 'hole':
      return `Otwór Ø${f.diameter} → ${bodyName}`;
    case 'boolean':
      return `${f.op === 'union' ? 'Suma' : f.op === 'subtract' ? 'Różnica' : 'Część wspólna'} → ${bodyName}`;
    case 'fillet':
      return `Zaokrąglenie R${f.radius} → ${bodyName}`;
    case 'chamfer':
      return `Fazowanie ${f.radius} → ${bodyName}`;
    case 'transform':
      return `Przekształcenie → ${bodyName}`;
    case 'import':
      return `Import ${f.format.toUpperCase()} → ${bodyName}`;
    case 'delete':
      return `Usunięcie → ${bodyName}`;
  }
}

export { identity };
