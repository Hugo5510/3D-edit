import { create } from 'zustand';
import type { Asset, ProjectDoc } from '../model/types';
import { emptyDoc } from '../model/types';
import type { BuildResult, BodyResult } from '../kernel/protocol';
import { kernel } from '../kernel/client';
import { loadAutosave, saveAutosave } from './persist';

export type Selection =
  | { kind: 'body'; bodyId: string }
  | { kind: 'face'; bodyId: string; face: number }
  | { kind: 'edges'; bodyId: string; edges: number[] }
  | { kind: 'sketch'; sketchId: string; entities: string[]; points: string[] }
  | { kind: 'profile'; sketchId: string; profileId: string }
  | { kind: 'feature'; featureId: string }
  | null;

export type ToolId =
  | 'select'
  | 'sketchPlane'
  | 'line'
  | 'rect'
  | 'circle'
  | 'polygon'
  | 'arc3'
  | 'arcc'
  | 'sketchFillet'
  | 'fill'
  | 'extrude'
  | 'hole'
  | 'fillet'
  | 'chamfer'
  | 'boolean'
  | 'erase'
  | 'measure';

export interface Settings {
  gridSnap: boolean;
  gridStep: number;
  pointSnap: boolean;
  angleStep: number;
}

export interface DragInfo {
  text: string;
  x: number;
  y: number;
}

export interface AppState {
  doc: ProjectDoc;
  assets: Record<string, Asset>;
  past: ProjectDoc[];
  future: ProjectDoc[];
  gestureStart: ProjectDoc | null;

  build: BuildResult | null;
  bodies: Record<string, BodyResult>;
  building: boolean;
  kernelReady: boolean;
  kernelError: string | null;

  selection: Selection;
  tool: ToolId;
  /** Parametry aktywnego narzędzia (np. wysokość wyciągnięcia). */
  toolState: Record<string, unknown>;
  activeSketchId: string | null;
  settings: Settings;
  message: { text: string; kind: 'info' | 'error' | 'ok' } | null;
  dragInfo: DragInfo | null;
  dialog: null | 'import' | 'export' | 'bambu' | 'printer' | 'help';

  /** Zatwierdzona zmiana dokumentu (trafia do historii cofania). */
  commit: (doc: ProjectDoc, opts?: { keepSelection?: boolean }) => void;
  /** Zmiana na żywo podczas przeciągania (bez historii). */
  live: (doc: ProjectDoc) => void;
  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  addAsset: (a: Asset) => void;
  setSelection: (s: Selection) => void;
  setTool: (t: ToolId, toolState?: Record<string, unknown>) => void;
  setToolState: (patch: Record<string, unknown>) => void;
  setSettings: (patch: Partial<Settings>) => void;
  notify: (text: string, kind?: 'info' | 'error' | 'ok') => void;
  setActiveSketch: (id: string | null) => void;
  setDragInfo: (d: DragInfo | null) => void;
  setDialog: (d: AppState['dialog']) => void;
  loadProject: (doc: ProjectDoc, assets: Asset[]) => void;
}

const HISTORY_LIMIT = 200;
const SKETCH_TOOL_IDS = new Set<ToolId>(['select', 'line', 'rect', 'circle', 'polygon', 'arc3', 'arcc', 'sketchFillet', 'fill', 'erase', 'measure']);

function keepSel(sel: Selection, doc: ProjectDoc): Selection {
  if (sel?.kind === 'body' && doc.bodies.some((b) => b.id === sel.bodyId)) return sel;
  if (sel?.kind === 'feature' && doc.features.some((f) => f.id === sel.featureId)) return sel;
  return null;
}

export const useApp = create<AppState>((set, get) => ({
  doc: emptyDoc(),
  assets: {},
  past: [],
  future: [],
  gestureStart: null,
  build: null,
  bodies: {},
  building: false,
  kernelReady: false,
  kernelError: null,
  selection: null,
  tool: 'select',
  toolState: {},
  activeSketchId: null,
  settings: { gridSnap: true, gridStep: 1, pointSnap: true, angleStep: 15 },
  message: null,
  dragInfo: null,
  dialog: null,

  commit: (doc) => {
    const { doc: prev, past, gestureStart } = get();
    if (doc === prev) return;
    if (gestureStart) {
      set({ doc });
    } else {
      set({ doc, past: [...past, prev].slice(-HISTORY_LIMIT), future: [] });
    }
  },
  live: (doc) => set({ doc }),
  beginGesture: () => set({ gestureStart: get().doc }),
  endGesture: () => {
    const { gestureStart, doc, past } = get();
    if (!gestureStart) return;
    if (gestureStart !== doc) set({ past: [...past, gestureStart].slice(-HISTORY_LIMIT), future: [], gestureStart: null });
    else set({ gestureStart: null });
  },
  undo: () => {
    const { past, future, doc } = get();
    if (!past.length) return;
    const nd = past[past.length - 1];
    set({ doc: nd, past: past.slice(0, -1), future: [doc, ...future], selection: keepSel(get().selection, nd) });
  },
  redo: () => {
    const { past, future, doc } = get();
    if (!future.length) return;
    set({ doc: future[0], future: future.slice(1), past: [...past, doc], selection: keepSel(get().selection, future[0]) });
  },
  addAsset: (a) => set({ assets: { ...get().assets, [a.id]: a } }),
  setSelection: (selection) => set({ selection }),
  setTool: (tool, toolState = {}) => {
    // narzędzia 3D kończą edycję szkicu
    const keepSketch = SKETCH_TOOL_IDS.has(tool);
    set({ tool, toolState, dragInfo: null, ...(keepSketch ? {} : { activeSketchId: null }) });
  },
  setToolState: (patch) => set({ toolState: { ...get().toolState, ...patch } }),
  setSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
  notify: (text, kind = 'info') => {
    set({ message: { text, kind } });
    const msg = get().message;
    setTimeout(() => {
      if (get().message === msg) set({ message: null });
    }, kind === 'error' ? 7000 : 3500);
  },
  setActiveSketch: (activeSketchId) => set({ activeSketchId }),
  setDragInfo: (dragInfo) => set({ dragInfo }),
  setDialog: (dialog) => set({ dialog }),
  loadProject: (doc, assets) =>
    set({
      doc,
      assets: Object.fromEntries(assets.map((a) => [a.id, a])),
      past: [],
      future: [],
      selection: null,
      activeSketchId: null,
      tool: 'select',
    }),
}));

// ---------------------------------------------------------------- przebudowa w workerze

const sentAssets = new Set<string>();
let buildQueued = false;
let buildRunning = false;

async function runBuild() {
  if (buildRunning) {
    buildQueued = true;
    return;
  }
  buildRunning = true;
  useApp.setState({ building: true });
  try {
    do {
      buildQueued = false;
      const { doc, assets } = useApp.getState();
      const newAssets = Object.values(assets).filter((a) => !sentAssets.has(a.id));
      const result = await kernel().call<BuildResult>({ type: 'build', doc, assets: newAssets });
      newAssets.forEach((a) => sentAssets.add(a.id));
      if (useApp.getState().doc === doc || !buildQueued) {
        const bodies: Record<string, BodyResult> = {};
        for (const b of result.bodies) bodies[b.id] = b;
        useApp.setState({ build: result, bodies, kernelReady: true, kernelError: null });
      }
    } while (buildQueued);
  } catch (e) {
    useApp.setState({ kernelError: e instanceof Error ? e.message : String(e) });
  } finally {
    buildRunning = false;
    useApp.setState({ building: false });
  }
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

export function startStoreEffects() {
  useApp.subscribe((s, prev) => {
    if (s.doc !== prev.doc) {
      runBuild();
      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => {
        const st = useApp.getState();
        saveAutosave(st.doc, Object.values(st.assets)).catch(() => {});
      }, 800);
    }
  });
  (async () => {
    try {
      const saved = await loadAutosave();
      if (saved) useApp.getState().loadProject(saved.doc, saved.assets);
    } catch {
      /* brak autozapisu */
    }
    runBuild();
  })();
}

export function selectedBodyId(sel: Selection): string | null {
  if (!sel) return null;
  if (sel.kind === 'body' || sel.kind === 'face' || sel.kind === 'edges') return sel.bodyId;
  return null;
}
