// IGES: obsługiwany przez pełny build OpenCascade (@taucad/opencascade.js), ładowany dopiero
// przy pierwszym imporcie/eksporcie IGES (~37 MB), bo lżejsze buildy nie zawierają modułu IGES.
// Wymiana z głównym jądrem odbywa się przez tekstowy format BREP.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OC = any;
let loader: (() => Promise<OC>) | null = null;
let ocPromise: Promise<OC> | null = null;

export function setIgesLoader(fn: () => Promise<OC>) {
  loader = fn;
}

async function getOC(): Promise<OC> {
  if (!ocPromise) {
    ocPromise = (async () => {
      if (loader) return loader();
      const mod = await import('@taucad/opencascade.js');
      return (mod.default as (o?: object) => Promise<OC>)();
    })();
    ocPromise.catch(() => (ocPromise = null));
  }
  return ocPromise;
}

export async function brepToIges(brep: string): Promise<string> {
  const oc = await getOC();
  oc.FS.writeFile('/in.brep', brep);
  const shape = new oc.TopoDS_Shape();
  const builder = new oc.BRep_Builder();
  if (!oc.BRepTools.Read(shape, '/in.brep', builder, new oc.Message_ProgressRange())) throw new Error('Błąd odczytu BREP');
  // tryb 1 = BRep (encje 186 MSBO), jednostka mm
  const w = new oc.IGESControl_Writer('MM', 1);
  if (!w.AddShape(shape, new oc.Message_ProgressRange())) throw new Error('Nie udało się zapisać bryły do IGES');
  w.ComputeModel();
  if (!w.Write('/out.igs', false)) throw new Error('Błąd zapisu IGES');
  const out = oc.FS.readFile('/out.igs', { encoding: 'utf8' }) as string;
  oc.FS.unlink('/in.brep');
  oc.FS.unlink('/out.igs');
  return out;
}

export async function igesToBrep(data: ArrayBuffer | string): Promise<string> {
  const oc = await getOC();
  oc.FS.writeFile('/in.igs', typeof data === 'string' ? data : new Uint8Array(data));
  const r = new oc.IGESControl_Reader();
  const st = r.ReadFile('/in.igs');
  const ok = st === oc.IFSelect_ReturnStatus.IFSelect_RetDone || String(st?.value ?? st).includes('RetDone') || st?.value === 1;
  if (!ok) throw new Error('Nie udało się odczytać pliku IGES');
  r.TransferRoots(new oc.Message_ProgressRange());
  const shape = r.OneShape();
  oc.BRepTools.Write(shape, '/out.brep', new oc.Message_ProgressRange());
  const out = oc.FS.readFile('/out.brep', { encoding: 'utf8' }) as string;
  oc.FS.unlink('/in.igs');
  oc.FS.unlink('/out.brep');
  return out;
}
