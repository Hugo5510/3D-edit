// Małe, niezależne od three.js narzędzia wektorowe i macierzowe (działają w workerze i w testach Node).
import type { Mat4, Vec2, Vec3 } from './types';

export const EPS = 1e-9;

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a: Vec3) => Math.hypot(a[0], a[1], a[2]),
  dist: (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l < EPS ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
};

export const v2 = {
  add: (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]],
  sub: (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]],
  scale: (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s],
  dot: (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1],
  cross: (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0],
  len: (a: Vec2) => Math.hypot(a[0], a[1]),
  dist: (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]),
  norm: (a: Vec2): Vec2 => {
    const l = Math.hypot(a[0], a[1]);
    return l < EPS ? [0, 0] : [a[0] / l, a[1] / l];
  },
  perp: (a: Vec2): Vec2 => [-a[1], a[0]],
  rot: (a: Vec2, ang: number): Vec2 => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
  },
};

export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;

// ---------------- Macierze 4x4 (kolumnowo) ----------------

export function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Iloczyn a*b (najpierw b, potem a). */
export function mul(a: Mat4, b: Mat4): Mat4 {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
      r[c * 4 + row] = s;
    }
  }
  return r;
}

export function translation(t: Vec3): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
}

export function scaling(s: Vec3): Mat4 {
  return [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1];
}

/** Obrót wokół osi przechodzącej przez początek układu (kąt w radianach). */
export function rotationAxis(axis: Vec3, angle: number): Mat4 {
  const [x, y, z] = v3.norm(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
}

/** Macierz m zastosowana względem punktu p: T(p) * m * T(-p). */
export function about(m: Mat4, p: Vec3): Mat4 {
  return mul(translation(p), mul(m, translation([-p[0], -p[1], -p[2]])));
}

export function applyPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

export function applyDir(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
  ];
}

/** Format 3x4 wierszowo dla occt-wasm. */
export function toOcct(m: Mat4): number[] {
  return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]];
}

export function isIdentity(m: Mat4, tol = 1e-12): boolean {
  const id = identity();
  return m.every((v, i) => Math.abs(v - id[i]) < tol);
}

/** Czy macierz jest izometrią z jednorodną skalą (obsługiwaną przez gp_Trsf). */
export function isSimilarity(m: Mat4, tol = 1e-9): boolean {
  const cx: Vec3 = [m[0], m[1], m[2]];
  const cy: Vec3 = [m[4], m[5], m[6]];
  const cz: Vec3 = [m[8], m[9], m[10]];
  const lx = v3.len(cx);
  const ly = v3.len(cy);
  const lz = v3.len(cz);
  if (Math.abs(lx - ly) > tol * lx || Math.abs(lx - lz) > tol * lx) return false;
  return (
    Math.abs(v3.dot(cx, cy)) < tol * lx * ly &&
    Math.abs(v3.dot(cx, cz)) < tol * lx * lz &&
    Math.abs(v3.dot(cy, cz)) < tol * ly * lz
  );
}

export function determinant(m: Mat4): number {
  const a = m;
  return (
    a[0] * (a[5] * a[10] - a[9] * a[6]) -
    a[4] * (a[1] * a[10] - a[9] * a[2]) +
    a[8] * (a[1] * a[6] - a[5] * a[2])
  );
}

/** Uzupełnia bazę płaszczyzny: zwraca kierunek osi Y szkicu. */
export function planeY(normal: Vec3, xDir: Vec3): Vec3 {
  return v3.norm(v3.cross(normal, xDir));
}

/** Dowolny wektor prostopadły do n. */
export function anyPerp(n: Vec3): Vec3 {
  const a: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return v3.norm(v3.cross(a, n));
}

/** Parsowanie liczby wpisanej przez użytkownika: przecinek dziesiętny i proste działania (+ - * / nawiasy). */
export function parseNumber(text: string): number | null {
  const s = text.replace(/,/g, '.').replace(/\s+/g, '');
  if (!s) return null;
  if (!/^[0-9.+\-*/()]+$/.test(s)) return null;
  let i = 0;
  const peek = () => s[i];
  function num(): number {
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') throw new Error('nawias');
      i++;
      return v;
    }
    if (peek() === '-') {
      i++;
      return -num();
    }
    if (peek() === '+') {
      i++;
      return num();
    }
    const m = /^[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?|^[0-9]+\.?/.exec(s.slice(i));
    if (!m) throw new Error('liczba');
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function term(): number {
    let v = num();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++];
      const r = num();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr(): number {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  try {
    const v = expr();
    if (i !== s.length || !Number.isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}

/** Formatowanie wymiaru do wyświetlenia (polski przecinek, do 2 miejsc). */
export function fmt(v: number, digits = 2): string {
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return (Object.is(r, -0) ? 0 : r).toLocaleString('pl-PL', {
    maximumFractionDigits: digits,
    useGrouping: false,
  });
}

let idCounter = 0;
export function uid(prefix = 'id'): string {
  idCounter++;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${idCounter.toString(36)}`;
}
