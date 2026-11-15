// Import i eksport plików w wątku głównym (dane B-rep liczone są w workerze).
import { useApp } from '../state/store';
import { addFeature, clone, newBodyMeta, newSketch } from '../state/actions';
import { kernel } from '../kernel/client';
import type { TessellatedBody } from '../kernel/protocol';
import { meshBBox, weld } from '../kernel/meshOps';
import type { Asset, ImportFormat, Sketch } from '../model/types';
import { translation, uid } from '../model/math';
import { parseGltf, parseObj, parsePly, parseStl, writeGlb, writeObj, writePly, writeStlAscii, writeStlBinary, type NamedMesh } from './meshFormats';
import { parse3mf, write3mf } from './threemf';
import { parseDxf, writeDxf } from './dxf';
import { loadProject, saveProject, PROJECT_EXT } from './project';

export type ExportFormat = '3mf' | 'stl' | 'stl-ascii' | 'obj' | 'ply' | 'glb' | 'step' | 'iges' | 'dxf' | 'project';

export const QUALITY = {
  coarse: { deflection: 0.1, angular: 0.35, label: 'Zgrubna (mały plik)' },
  normal: { deflection: 0.02, angular: 0.2, label: 'Normalna' },
  fine: { deflection: 0.005, angular: 0.1, label: 'Dokładna (duży plik)' },
};
export type Quality = keyof typeof QUALITY;

export interface ExportOptions {
  bodyIds?: string[];
  quality?: Quality;
  /** glTF zapisany w metrach (zgodnie ze specyfikacją) zamiast 1 jednostka = 1 mm. */
  gltfMeters?: boolean;
  /** Przesunięcie siatek (np. ułożenie na stole drukarki). */
  offset?: [number, number, number];
}

export function download(name: string, data: Uint8Array | string, mime = 'application/octet-stream') {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function baseName(): string {
  const n = useApp.getState().doc.name || 'projekt';
  return n.replace(/[\\/:*?"<>|]+/g, '_');
}

/** Bryły do eksportu: zaznaczona albo wszystkie widoczne. */
export function exportBodyIds(onlySelected: boolean): string[] {
  const st = useApp.getState();
  const sel = st.selection;
  if (onlySelected && sel && 'bodyId' in sel && st.bodies[sel.bodyId]) return [sel.bodyId];
  return st.doc.bodies.filter((b) => b.visible && st.bodies[b.id]).map((b) => b.id);
}

export async function tessellate(ids: string[], quality: Quality): Promise<NamedMesh[]> {
  const q = QUALITY[quality];
  const r = await kernel().call<TessellatedBody[]>({ type: 'tessellate', bodyIds: ids, options: { deflection: q.deflection, angular: q.angular } });
  const names = new Map(useApp.getState().doc.bodies.map((b) => [b.id, b.name]));
  return r.map((t) => ({ name: names.get(t.id) ?? 'bryla', positions: t.positions, indices: t.indices }));
}

function offsetMeshes(ms: NamedMesh[], o?: [number, number, number]): NamedMesh[] {
  if (!o) return ms;
  return ms.map((m) => {
    const p = new Float32Array(m.positions);
    for (let i = 0; i < p.length; i += 3) {
      p[i] += o[0];
      p[i + 1] += o[1];
      p[i + 2] += o[2];
    }
    return { ...m, positions: p };
  });
}

/** Tworzy zawartość pliku w danym formacie. */
export async function buildExport(format: ExportFormat, opts: ExportOptions = {}): Promise<{ name: string; data: Uint8Array | string; mime: string }> {
  const st = useApp.getState();
  const ids = opts.bodyIds ?? exportBodyIds(false);
  const name = baseName();
  if (format === 'project') return { name: name + PROJECT_EXT, data: saveProject(st.doc, Object.values(st.assets)), mime: 'application/zip' };
  if (format === 'dxf') {
    const sks = st.activeSketchId ? st.doc.sketches.filter((s) => s.id === st.activeSketchId) : st.doc.sketches.filter((s) => s.visible);
    const list = sks.length ? sks : st.doc.sketches;
    if (!list.length) throw new Error('Brak szkiców do zapisania w DXF');
    return { name: name + '.dxf', data: writeDxf(list), mime: 'application/dxf' };
  }
  if (!ids.length) throw new Error('Brak brył do eksportu');
  if (format === 'step' || format === 'iges') {
    const data = await kernel().call<string>({ type: 'exportCad', format, bodyIds: ids });
    return { name: name + (format === 'step' ? '.step' : '.igs'), data, mime: format === 'step' ? 'model/step' : 'model/iges' };
  }
  const meshes = offsetMeshes(await tessellate(ids, opts.quality ?? 'normal'), opts.offset);
  switch (format) {
    case '3mf':
      return { name: name + '.3mf', data: write3mf(meshes, { title: st.doc.name }), mime: 'model/3mf' };
    case 'stl':
      return { name: name + '.stl', data: writeStlBinary(meshes), mime: 'model/stl' };
    case 'stl-ascii':
      return { name: name + '.stl', data: writeStlAscii(meshes), mime: 'model/stl' };
    case 'obj':
      return { name: name + '.obj', data: writeObj(meshes), mime: 'model/obj' };
    case 'ply':
      return { name: name + '.ply', data: writePly(meshes), mime: 'application/octet-stream' };
    case 'glb':
      return { name: name + '.glb', data: writeGlb(meshes, opts.gltfMeters ? 0.001 : 1), mime: 'model/gltf-binary' };
  }
}

export async function exportAndDownload(format: ExportFormat, opts: ExportOptions = {}) {
  const st = useApp.getState();
  try {
    const f = await buildExport(format, opts);
    download(f.name, f.data, f.mime);
    st.notify(`Zapisano plik ${f.name}`, 'ok');
    return f;
  } catch (e) {
    st.notify('Eksport nie powiódł się: ' + (e instanceof Error ? e.message : String(e)), 'error');
    throw e;
  }
}

// ------------------------------------------------------------------------- import

export interface ImportOptions {
  placeOnBed: boolean;
  gltfMeters: boolean;
}

const EXT_FORMAT: Record<string, ImportFormat | 'dxf' | 'project'> = {
  stl: 'stl',
  obj: 'obj',
  '3mf': '3mf',
  ply: 'ply',
  glb: 'glb',
  gltf: 'glb',
  step: 'step',
  stp: 'step',
  iges: 'iges',
  igs: 'iges',
  brep: 'brep',
  dxf: 'dxf',
  '3dedit': 'project',
};

export const CLOSED_FORMATS: Record<string, string> = {
  ipt: 'Inventor (IPT) to format zamknięty. W Inventorze: Plik → Eksportuj → Format CAD → STEP (.stp), potem zaimportuj STEP.',
  iam: 'Złożenie Inventora (IAM) to format zamknięty. Wyeksportuj je w Inventorze do STEP.',
  f3d: 'Fusion (F3D) to format zamknięty. W Fusion: Plik → Eksportuj → STEP.',
  dwg: 'DWG to format zamknięty. W AutoCAD zapisz rysunek jako DXF (2D) albo wyeksportuj bryły do STEP/IGES.',
  blend: 'Plik .blend to format zamknięty Blendera. W Blenderze: Plik → Eksportuj → OBJ, glTF (.glb) lub STL.',
  sldprt: 'SolidWorks (SLDPRT) to format zamknięty. Zapisz jako STEP.',
};

export const IMPORT_ACCEPT = '.stl,.obj,.3mf,.ply,.glb,.gltf,.step,.stp,.iges,.igs,.brep,.dxf,.3dedit';

export async function importFile(file: File, opts: ImportOptions) {
  const st = useApp.getState();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (CLOSED_FORMATS[ext]) throw new Error(CLOSED_FORMATS[ext]);
  const fmt = EXT_FORMAT[ext];
  if (!fmt) throw new Error(`Nieobsługiwany format pliku: .${ext}`);
  const buf = await file.arrayBuffer();
  const baseNameNoExt = file.name.replace(/\.[^.]+$/, '');

  if (fmt === 'project') {
    const p = loadProject(new Uint8Array(buf));
    st.loadProject(p.doc, p.assets);
    st.notify(`Otwarto projekt ${file.name}`, 'ok');
    return;
  }

  if (fmt === 'dxf') {
    const { doc, sketchId } = newSketch(st.doc, { origin: [0, 0, 0], normal: [0, 0, 1], xDir: [1, 0, 0] }, baseNameNoExt);
    const d = clone(doc);
    const sk = d.sketches.find((s) => s.id === sketchId) as Sketch;
    const r = parseDxf(new TextDecoder().decode(buf), sk);
    if (!r.entities) throw new Error('W pliku DXF nie znaleziono linii, łuków ani okręgów');
    st.commit(d);
    st.notify(`Zaimportowano szkic DXF (${r.entities} el.)${r.skipped.length ? `; pominięto: ${r.skipped.join(', ')}` : ''}. Kliknij szkic w drzewie, aby go edytować.`, 'ok');
    return;
  }

  if (fmt === 'step' || fmt === 'iges' || fmt === 'brep') {
    st.notify(fmt === 'iges' ? 'Wczytywanie IGES – pierwsze użycie pobiera moduł IGES (~11 MB)…' : 'Wczytywanie pliku CAD…', 'info');
    const r = await kernel().call<{ brep: string; bbox: { min: number[]; max: number[] }; solids: number }>(
      { type: 'importCad', format: fmt, data: buf, name: file.name },
      [buf],
    );
    const asset: Asset = { id: uid('asset'), name: file.name, brep: r.brep };
    st.addAsset(asset);
    const meta = newBodyMeta(st.doc, baseNameNoExt);
    meta.name = baseNameNoExt;
    let d = addFeature(st.doc, { id: uid('f'), type: 'import', bodyId: meta.id, assetId: asset.id, format: fmt, geometry: 'brep' }, meta);
    if (opts.placeOnBed) {
      const c = [(r.bbox.min[0] + r.bbox.max[0]) / 2, (r.bbox.min[1] + r.bbox.max[1]) / 2, r.bbox.min[2]];
      if (Math.hypot(c[0], c[1], c[2]) > 1e-6) d = addFeature(d, { id: uid('f'), type: 'transform', bodyId: meta.id, matrix: translation([-c[0], -c[1], -c[2]]) });
    }
    st.commit(d);
    st.setSelection({ kind: 'body', bodyId: meta.id });
    st.notify(`Zaimportowano ${file.name}${r.solids ? '' : ' – uwaga: plik zawiera powierzchnie, a nie zamknięte bryły'}`, r.solids ? 'ok' : 'error');
    return;
  }

  // siatki
  let meshes: NamedMesh[];
  switch (fmt) {
    case 'stl':
      meshes = [{ name: baseNameNoExt, ...parseStl(buf) }];
      break;
    case 'obj': {
      const groups = parseObj(new TextDecoder().decode(buf));
      // wszystkie grupy OBJ jako jedna bryła
      const idx = new Uint32Array(groups.reduce((s, g) => s + g.indices.length, 0));
      let o = 0;
      for (const g of groups) {
        idx.set(g.indices, o);
        o += g.indices.length;
      }
      meshes = [{ name: baseNameNoExt, positions: groups[0].positions, indices: idx }];
      break;
    }
    case 'ply':
      meshes = [{ name: baseNameNoExt, ...parsePly(buf) }];
      break;
    case '3mf':
      meshes = parse3mf(new Uint8Array(buf));
      break;
    case 'glb':
      meshes = parseGltf(buf, opts.gltfMeters ? 1000 : 1);
      break;
    default:
      throw new Error('Nieobsługiwany format');
  }
  const welded = meshes.map((m) => ({ name: m.name, ...weld(m.positions, m.indices, 1e-4) }));
  if (opts.placeOnBed) {
    // wspólne ułożenie wszystkich obiektów pliku: środek XY w (0,0), spód na stole
    const all = welded.map((m) => meshBBox(m.positions));
    const min = [0, 1, 2].map((i) => Math.min(...all.map((b) => b.min[i])));
    const max = [0, 1, 2].map((i) => Math.max(...all.map((b) => b.max[i])));
    const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
    for (const m of welded)
      for (let i = 0; i < m.positions.length; i += 3) {
        m.positions[i] -= c[0];
        m.positions[i + 1] -= c[1];
        m.positions[i + 2] -= c[2];
      }
  }
  let d = st.doc;
  let lastId = '';
  for (const m of welded) {
    if (!m.indices.length) continue;
    const asset: Asset = { id: uid('asset'), name: file.name, mesh: { positions: m.positions, indices: m.indices } };
    st.addAsset(asset);
    const meta = newBodyMeta(d, m.name || baseNameNoExt);
    meta.name = welded.length > 1 ? m.name : baseNameNoExt;
    d = addFeature(d, { id: uid('f'), type: 'import', bodyId: meta.id, assetId: asset.id, format: fmt, geometry: 'mesh' }, meta);
    lastId = meta.id;
  }
  st.commit(d);
  if (lastId) st.setSelection({ kind: 'body', bodyId: lastId });
  const size = welded.length ? meshBBox(welded[0].positions) : null;
  const diag = size ? Math.hypot(...size.max.map((v, i) => v - size.min[i])) : 0;
  const tri = welded.reduce((s, m) => s + m.indices.length / 3, 0);
  st.notify(
    `Zaimportowano ${file.name} (${tri.toLocaleString('pl-PL')} trójkątów)` +
      (diag > 0 && diag < 2 ? '. Model jest bardzo mały – jeśli plik był w metrach lub calach, przeskaluj go (np. 1000% lub 2540%).' : ''),
    'ok',
  );
}
