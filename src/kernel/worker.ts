/// <reference lib="webworker" />
// Web Worker z jądrem OpenCascade. Cała geometria B-rep liczona jest tutaj, poza wątkiem interfejsu.
import { OcctKernel } from 'occt-wasm';
import createOcctModule from 'occt-wasm/dist/occt-wasm.js';
import occtWasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url';
import { Builder } from './build';
import { preloadManifold, setManifoldLoader } from './meshOps';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { igesToBrep, brepToIges, setIgesLoader } from './iges';
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';

let builderPromise: Promise<Builder> | null = null;

function getBuilder(): Promise<Builder> {
  if (!builderPromise) {
    builderPromise = (async () => {
      setManifoldLoader(async () => {
        const mod = await import('manifold-3d');
        const wasm = await mod.default({ locateFile: () => manifoldWasmUrl });
        wasm.setup();
        return wasm;
      });
      const [kernel] = await Promise.all([
        OcctKernel.init({ createModule: createOcctModule as never, wasm: occtWasmUrl }),
        preloadManifold(),
      ]);
      return new Builder(kernel);
    })();
  }
  return builderPromise;
}

async function handle(req: WorkerRequest): Promise<{ result: unknown; transfer?: Transferable[] }> {
  const b = await getBuilder();
  switch (req.type) {
    case 'init':
      return { result: true };
    case 'build':
      b.addAssets(req.assets);
      return { result: b.build(req.doc) };
    case 'tessellate': {
      const r = b.tessellate(req.bodyIds, req.options);
      return { result: r, transfer: r.flatMap((x) => [x.positions.buffer, x.indices.buffer]) };
    }
    case 'exportCad': {
      if (req.format === 'step') return { result: b.exportStep(req.bodyIds) };
      if (req.format === 'brep') return { result: b.exportBrep(req.bodyIds) };
      return { result: await brepToIges(b.exportBrep(req.bodyIds)) };
    }
    case 'importCad': {
      const k = b.k;
      let brep: string;
      if (req.format === 'iges') brep = await igesToBrep(req.data);
      else if (req.format === 'brep') brep = typeof req.data === 'string' ? req.data : new TextDecoder().decode(req.data);
      else {
        const mark = k.checkpoint();
        try {
          brep = k.toBREP(k.importStep(req.data));
        } finally {
          k.releaseSince(mark);
        }
      }
      const mark = k.checkpoint();
      try {
        const sh = k.fromBREP(brep);
        if (!k.getSubShapes(sh, 'face').length) throw new Error('Plik nie zawiera geometrii brył ani powierzchni');
        const bb = k.getBoundingBox(sh);
        return { result: { brep, bbox: { min: [bb.xmin, bb.ymin, bb.zmin], max: [bb.xmax, bb.ymax, bb.zmax] }, solids: k.getSubShapes(sh, 'solid').length } };
      } finally {
        k.releaseSince(mark);
      }
    }
  }
}

self.onmessage = async (ev: MessageEvent<{ id: number; req: WorkerRequest }>) => {
  const { id, req } = ev.data;
  try {
    const { result, transfer } = await handle(req);
    const msg: WorkerResponse = { id, ok: true, result };
    (self as unknown as Worker).postMessage(msg, transfer ?? []);
  } catch (e) {
    const msg: WorkerResponse = { id, ok: false, error: e instanceof Error ? e.message : String(e) };
    (self as unknown as Worker).postMessage(msg);
  }
};

setIgesLoader(async () => {
  const [mod, wasm] = await Promise.all([
    import('@taucad/opencascade.js'),
    import('@taucad/opencascade.js/dist/opencascade_full.wasm?url'),
  ]);
  return (mod.default as (o: object) => Promise<unknown>)({ locateFile: () => wasm.default });
});
