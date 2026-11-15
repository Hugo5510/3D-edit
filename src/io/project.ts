// Własny format projektu .3dedit: archiwum ZIP z historią operacji (project.json) i zaimportowanymi plikami.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Asset, ProjectDoc } from '../model/types';

export const PROJECT_EXT = '.3dedit';

export function saveProject(doc: ProjectDoc, assets: Asset[]): Uint8Array {
  const used = new Set(doc.features.flatMap((f) => (f.type === 'import' ? [f.assetId] : [])));
  const files: Record<string, Uint8Array> = {};
  const meta = assets
    .filter((a) => used.has(a.id))
    .map((a) => {
      if (a.mesh) {
        files[`assets/${a.id}.pos`] = new Uint8Array(a.mesh.positions.buffer.slice(a.mesh.positions.byteOffset, a.mesh.positions.byteOffset + a.mesh.positions.byteLength));
        files[`assets/${a.id}.idx`] = new Uint8Array(a.mesh.indices.buffer.slice(a.mesh.indices.byteOffset, a.mesh.indices.byteOffset + a.mesh.indices.byteLength));
      }
      if (a.brep) files[`assets/${a.id}.brep`] = strToU8(a.brep);
      return { id: a.id, name: a.name, mesh: !!a.mesh, brep: !!a.brep };
    });
  files['project.json'] = strToU8(JSON.stringify({ format: '3d-edit', version: 1, doc, assets: meta }, null, 1));
  return zipSync(files, { level: 6 });
}

export function loadProject(data: Uint8Array): { doc: ProjectDoc; assets: Asset[] } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error('To nie jest plik projektu 3D Edit');
  }
  const pj = files['project.json'];
  if (!pj) throw new Error('Brak project.json w pliku projektu');
  const parsed = JSON.parse(strFromU8(pj)) as { format: string; version: number; doc: ProjectDoc; assets: { id: string; name: string; mesh: boolean; brep: boolean }[] };
  if (parsed.format !== '3d-edit' || parsed.doc?.version !== 1) throw new Error('Nieobsługiwana wersja pliku projektu');
  const assets: Asset[] = parsed.assets.map((m) => {
    const a: Asset = { id: m.id, name: m.name };
    if (m.mesh) {
      const p = files[`assets/${m.id}.pos`], i = files[`assets/${m.id}.idx`];
      a.mesh = { positions: new Float32Array(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength)), indices: new Uint32Array(i.buffer.slice(i.byteOffset, i.byteOffset + i.byteLength)) };
    }
    if (m.brep) a.brep = strFromU8(files[`assets/${m.id}.brep`]);
    return a;
  });
  return { doc: parsed.doc, assets };
}
