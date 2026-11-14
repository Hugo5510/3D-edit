import { describe, expect, it } from 'vitest';
import { addPrimitive, deleteBody, transformBody, removeFeature } from '../src/state/actions';
import { emptyDoc } from '../src/model/types';
import { parseNumber, fmt, translation, scaling, mul, rotationAxis, applyPoint } from '../src/model/math';

describe('parseNumber', () => {
  it('przecinek, kropka i działania', () => {
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('20/2+3')).toBe(13);
    expect(parseNumber('-(2+3)*2')).toBe(-10);
    expect(parseNumber('0,01')).toBe(0.01);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('1/0')).toBeNull();
  });
  it('formatowanie z dokładnością 0,01', () => {
    expect(fmt(12.345)).toBe('12,35');
    expect(fmt(-0.001)).toBe('0');
    expect(fmt(20)).toBe('20');
  });
});

describe('macierze', () => {
  it('obrót o 90° wokół Z', () => {
    const p = applyPoint(rotationAxis([0, 0, 1], Math.PI / 2), [1, 0, 0]);
    expect(p[0]).toBeCloseTo(0, 12);
    expect(p[1]).toBeCloseTo(1, 12);
  });
  it('złożenie: najpierw skala, potem przesunięcie', () => {
    const m = mul(translation([10, 0, 0]), scaling([2, 2, 2]));
    expect(applyPoint(m, [1, 1, 1])).toEqual([12, 2, 2]);
  });
});

describe('akcje dokumentu', () => {
  it('przesunięcia bryły gotowej dopisują się do jej położenia', () => {
    let { doc, bodyId } = addPrimitive(emptyDoc(), 'box');
    doc = transformBody(doc, bodyId, translation([5, 0, 0]), true);
    doc = transformBody(doc, bodyId, translation([5, 0, 0]), true);
    expect(doc.features.length).toBe(1);
    const f = doc.features[0];
    expect(f.type === 'primitive' && f.matrix[12]).toBe(10);
  });
  it('skalowanie tworzy osobną operację przekształcenia', () => {
    let { doc, bodyId } = addPrimitive(emptyDoc(), 'box');
    doc = transformBody(doc, bodyId, scaling([2, 1, 1]), false);
    doc = transformBody(doc, bodyId, translation([1, 0, 0]), true);
    expect(doc.features.map((f) => f.type)).toEqual(['primitive', 'transform']);
  });
  it('usunięcie bryły bez powiązań usuwa jej historię', () => {
    const a = addPrimitive(emptyDoc(), 'box');
    const b = addPrimitive(a.doc, 'sphere');
    const d = deleteBody(b.doc, a.bodyId);
    expect(d.features.length).toBe(1);
    expect(d.bodies.map((x) => x.id)).toEqual([b.bodyId]);
  });
  it('usunięcie operacji tworzącej bryłę usuwa bryłę', () => {
    const a = addPrimitive(emptyDoc(), 'cylinder');
    const d = removeFeature(a.doc, a.doc.features[0].id);
    expect(d.bodies.length).toBe(0);
  });
});
