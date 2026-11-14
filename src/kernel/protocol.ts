import type { Asset, ProjectDoc, Vec3 } from '../model/types';

export interface FaceInfo {
  kind: string;
  centroid: Vec3;
  /** Normalna zewnętrzna (tylko ściany płaskie). */
  normal: Vec3 | null;
  /** Kierunek X płaszczyzny ściany (ściany płaskie). */
  xDir: Vec3 | null;
  area: number;
  /** Zakres w tablicy indeksów (w jednostkach indeksów, nie trójkątów). */
  start: number;
  count: number;
  /** Indeksy krawędzi ograniczających ścianę. */
  edges: number[];
}

export interface EdgeInfo {
  kind: string;
  mid: Vec3;
  dir: Vec3;
  a: Vec3;
  b: Vec3;
  length: number;
  /** Zakres w tablicy edgePoints (w liczbach float). */
  start: number;
  count: number;
  /** Środek i promień dla okręgów/łuków. */
  center?: Vec3;
  radius?: number;
}

export interface BodyResult {
  id: string;
  geometry: 'brep' | 'mesh';
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faces: FaceInfo[];
  edgePoints: Float32Array;
  edges: EdgeInfo[];
  vertices: Float32Array;
  bbox: { min: Vec3; max: Vec3 };
  volume: number;
  /** Bryła zamknięta i poprawna. */
  closed: boolean;
  /** Identyfikator wersji geometrii (zmienia się przy każdej zmianie kształtu). */
  version: number;
}

export interface BuildResult {
  bodies: BodyResult[];
  errors: Record<string, string>;
  timeMs: number;
}

export type ExportFormat = 'step' | 'iges' | 'brep';

export interface MeshExportOptions {
  /** Maksymalne odchylenie cięciwy w mm. */
  deflection: number;
  angular: number;
}

export interface TessellatedBody {
  id: string;
  positions: Float32Array;
  indices: Uint32Array;
}

export type WorkerRequest =
  | { type: 'init' }
  | { type: 'build'; doc: ProjectDoc; assets: Asset[] }
  | { type: 'exportCad'; format: ExportFormat; bodyIds: string[] }
  | { type: 'tessellate'; bodyIds: string[]; options: MeshExportOptions }
  | { type: 'importCad'; format: 'step' | 'iges' | 'brep'; data: ArrayBuffer | string; name: string };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
