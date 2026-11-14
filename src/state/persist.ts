// Autozapis lokalny w IndexedDB (dokument + zasoby binarne).
import type { Asset, ProjectDoc } from '../model/types';

const DB = '3d-edit';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Brak IndexedDB'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function put(key: string, value: unknown) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function get<T>(key: string): Promise<T | undefined> {
  const db = await open();
  const v = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return v;
}

export async function saveAutosave(doc: ProjectDoc, assets: Asset[]) {
  // zapisujemy tylko zasoby używane przez dokument
  const used = new Set(doc.features.flatMap((f) => (f.type === 'import' ? [f.assetId] : [])));
  await put('autosave', { doc, assets: assets.filter((a) => used.has(a.id)), time: Date.now() });
}

export async function loadAutosave(): Promise<{ doc: ProjectDoc; assets: Asset[] } | null> {
  const v = await get<{ doc: ProjectDoc; assets: Asset[] }>('autosave');
  if (!v || !v.doc || v.doc.version !== 1) return null;
  return v;
}
