// Typy dokumentu. Wszystkie długości w milimetrach, kąty w stopniach (o ile nie zaznaczono inaczej).

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];
/** Macierz 4x4 w układzie kolumnowym (jak three.js Matrix4.elements). */
export type Mat4 = number[];

export interface Plane {
  origin: Vec3;
  normal: Vec3;
  xDir: Vec3;
}

// ---------------- Szkic ----------------

export interface SketchPoint {
  id: string;
  x: number;
  y: number;
}

export interface LineEntity {
  id: string;
  type: 'line';
  a: string;
  b: string;
  group?: string;
}

/** Łuk od punktu a do b; bulge = tan(kąt/4), >0 – przeciwnie do ruchu wskazówek zegara. */
export interface ArcEntity {
  id: string;
  type: 'arc';
  a: string;
  b: string;
  bulge: number;
  group?: string;
}

export interface CircleEntity {
  id: string;
  type: 'circle';
  c: string;
  r: number;
  group?: string;
}

export type SketchEntity = LineEntity | ArcEntity | CircleEntity;

export interface RectGroup {
  id: string;
  kind: 'rect';
  /** Kolejne narożniki p0..p3 (id punktów). */
  points: [string, string, string, string];
}

export interface PolygonGroup {
  id: string;
  kind: 'polygon';
  points: string[];
  center: Vec2;
  /** Promień okręgu opisanego. */
  radius: number;
  /** Kąt pierwszego wierzchołka w stopniach. */
  rotation: number;
}

export type SketchGroup = RectGroup | PolygonGroup;

/** Wypełniony obszar: pętle z identyfikatorami elementów, pierwsza zewnętrzna, kolejne to otwory. */
export interface Profile {
  id: string;
  loops: string[][];
}

export interface Sketch {
  id: string;
  name: string;
  plane: Plane;
  points: SketchPoint[];
  entities: SketchEntity[];
  groups: SketchGroup[];
  profiles: Profile[];
  visible: boolean;
}

// ---------------- Odwołania do topologii ----------------

export interface FaceRef {
  centroid: Vec3;
  normal: Vec3 | null;
  kind: string;
}

export interface EdgeRef {
  mid: Vec3;
  dir: Vec3;
  kind: string;
}

// ---------------- Operacje ----------------

export type PrimitiveKind = 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'prism' | 'wedge';

interface FeatureBase {
  id: string;
  suppressed?: boolean;
}

export interface PrimitiveFeature extends FeatureBase {
  type: 'primitive';
  bodyId: string;
  kind: PrimitiveKind;
  params: Record<string, number>;
  /** Położenie bryły (bez skali). */
  matrix: Mat4;
}

export type ExtrudeSource =
  | { kind: 'profile'; sketchId: string; profileId: string }
  | { kind: 'face'; bodyId: string; face: FaceRef };

export type ExtrudeMode = 'new' | 'join' | 'cut';

export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  /** Bryła wynikowa: nowa (mode=new) albo modyfikowana. */
  bodyId: string;
  source: ExtrudeSource;
  distance: number;
  /** Wyciągnięcie symetryczne w obie strony. */
  symmetric?: boolean;
  mode: ExtrudeMode;
}

export interface HoleFeature extends FeatureBase {
  type: 'hole';
  bodyId: string;
  face: FaceRef;
  /** Dwie krawędzie odniesienia; gdy brak – odległości od środka ściany. */
  edges: [EdgeRef, EdgeRef] | null;
  offsets: [number, number];
  diameter: number;
  depth: number;
  through: boolean;
}

export type BooleanOp = 'union' | 'subtract' | 'intersect';

export interface BooleanFeature extends FeatureBase {
  type: 'boolean';
  op: BooleanOp;
  bodyId: string;
  tools: string[];
}

export interface FilletFeature extends FeatureBase {
  type: 'fillet' | 'chamfer';
  bodyId: string;
  edges: EdgeRef[];
  /** Wszystkie krawędzie bryły (ignoruje listę edges). */
  allEdges?: boolean;
  radius: number;
}

export interface TransformFeature extends FeatureBase {
  type: 'transform';
  bodyId: string;
  matrix: Mat4;
}

export type ImportFormat = 'step' | 'iges' | 'stl' | 'obj' | '3mf' | 'ply' | 'glb' | 'brep';

export interface ImportFeature extends FeatureBase {
  type: 'import';
  bodyId: string;
  assetId: string;
  format: ImportFormat;
  /** Typ geometrii: dokładna B-rep (STEP/IGES) albo siatka trójkątów. */
  geometry: 'brep' | 'mesh';
}

export interface DeleteFeature extends FeatureBase {
  type: 'delete';
  bodyId: string;
}

export type Feature =
  | PrimitiveFeature
  | ExtrudeFeature
  | HoleFeature
  | BooleanFeature
  | FilletFeature
  | TransformFeature
  | ImportFeature
  | DeleteFeature;

export interface BodyMeta {
  id: string;
  name: string;
  color: string;
  visible: boolean;
}

export interface PrinterSettings {
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface ProjectDoc {
  version: 1;
  name: string;
  sketches: Sketch[];
  features: Feature[];
  bodies: BodyMeta[];
  printer: PrinterSettings;
}

/** Zasób binarny (np. zaimportowany plik). Przechowywany poza historią cofania. */
export interface Asset {
  id: string;
  name: string;
  /** Siatka (pozycje 3*n, indeksy 3*m) albo tekst BREP. */
  mesh?: { positions: Float32Array; indices: Uint32Array };
  brep?: string;
}

export function emptyDoc(): ProjectDoc {
  return {
    version: 1,
    name: 'Projekt',
    sketches: [],
    features: [],
    bodies: [],
    printer: { name: 'Bambu Lab X1/P1 (256 mm)', x: 256, y: 256, z: 256 },
  };
}
