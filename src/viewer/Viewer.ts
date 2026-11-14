import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { BodyView, edgeSegments, lineMaterials, makeLineMaterial } from './BodyView';
import type { BodyResult } from '../kernel/protocol';
import type { BodyMeta, PrinterSettings, Vec3 } from '../model/types';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export interface PointerInfo {
  x: number;
  y: number;
  ndc: THREE.Vector2;
  ray: THREE.Ray;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  button: number;
  pointerType: string;
  native: PointerEvent;
}

export interface Tool {
  activate?(v: Viewer): void;
  deactivate?(v: Viewer): void;
  /** Zwraca true, gdy narzędzie przejmuje gest (przeciąganie uchwytu). */
  pointerDown?(e: PointerInfo): boolean;
  drag?(e: PointerInfo): void;
  pointerUp?(e: PointerInfo): void;
  hover?(e: PointerInfo): void;
  click?(e: PointerInfo): void;
  key?(e: KeyboardEvent): boolean;
  /** Wywoływane po każdej zmianie stanu aplikacji/geometrii. */
  refresh?(): void;
  /** Wywoływane przy każdej klatce (np. stała wielkość uchwytów na ekranie). */
  frame?(): void;
}

export interface BodyHit {
  bodyId: string;
  face: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
}

export interface Highlight {
  faces?: { bodyId: string; face: number; color: number; opacity?: number }[];
  edges?: { bodyId: string; edge: number; color: number }[];
}

export class Viewer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  bodies = new Map<string, BodyView>();
  overlay = new THREE.Group();
  hiOverlay = new THREE.Group();
  bed = new THREE.Group();
  tool: Tool | null = null;
  private needsRender = true;
  private raf = 0;
  private downInfo: { x: number; y: number; t: number; consumed: boolean; id: number } | null = null;
  private activePointers = new Set<number>();
  private anim: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; upFrom: THREE.Vector3; upTo: THREE.Vector3; t0: number } | null = null;
  onCameraChange: (() => void)[] = [];
  private bedWarn = false;
  private printer: PrinterSettings = { name: '', x: 256, y: 256, z: 256 };

  constructor(public container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xeef1f5);
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.setAttribute('data-testid', 'viewport-canvas');
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 50000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(260, -340, 260);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = false;
    this.controls.zoomToCursor = true;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => {
      this.requestRender();
      this.onCameraChange.forEach((f) => f());
    });

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.4);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(0.5, -1, 2);
    this.camera.add(dir);
    dir.target.position.set(0, 0, -1);
    this.camera.add(dir.target);
    this.scene.add(this.camera);

    this.scene.add(this.bed, this.overlay, this.hiOverlay);
    this.setPrinter(this.printer);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown, { capture: true });
    el.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();
    this.loop();
  }

  // ---------------------------------------------------------------- render

  requestRender() {
    this.needsRender = true;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.anim) {
      const t = Math.min(1, (performance.now() - this.anim.t0) / 350);
      const e = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(this.anim.from, this.anim.to, e);
      this.controls.target.lerpVectors(this.anim.tFrom, this.anim.tTo, e);
      this.camera.up.lerpVectors(this.anim.upFrom, this.anim.upTo, e).normalize();
      this.camera.lookAt(this.controls.target);
      if (t >= 1) {
        this.anim = null;
        this.controls.update();
      }
      this.needsRender = true;
      this.onCameraChange.forEach((f) => f());
    }
    if (this.needsRender) {
      this.needsRender = false;
      this.tool?.frame?.();
      this.renderer.render(this.scene, this.camera);
    }
  };

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const m of lineMaterials) m.resolution.set(w, h);
    this.requestRender();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    window.removeEventListener('pointerup', this.onUp);
  }

  // ---------------------------------------------------------------- stół drukarki

  setPrinter(p: PrinterSettings, warn = this.bedWarn) {
    if (this.bed.children.length && p.x === this.printer.x && p.y === this.printer.y && p.z === this.printer.z && warn === this.bedWarn) return;
    this.printer = { ...p };
    this.bedWarn = warn;
    this.bed.clear();
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(p.x, p.y),
      new THREE.MeshBasicMaterial({ color: 0xdfe4ea, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    plate.position.z = -0.02;
    plate.renderOrder = -2;
    this.bed.add(plate);
    const grid: number[] = [];
    const step = 10;
    for (let x = -p.x / 2; x <= p.x / 2 + 1e-6; x += step) grid.push(x, -p.y / 2, 0, x, p.y / 2, 0);
    for (let y = -p.y / 2; y <= p.y / 2 + 1e-6; y += step) grid.push(-p.x / 2, y, 0, p.x / 2, y, 0);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
    const gl = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0xc3cad3, transparent: true, opacity: 0.8 }));
    gl.renderOrder = -1;
    this.bed.add(gl);
    // osie
    const axes = new THREE.Group();
    const ax = (to: Vec3, c: number) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.01), new THREE.Vector3(...to)]);
      return new THREE.Line(g, new THREE.LineBasicMaterial({ color: c }));
    };
    axes.add(ax([30, 0, 0.01], 0xd04040), ax([0, 30, 0.01], 0x40a040), ax([0, 0, 30], 0x4060d0));
    this.bed.add(axes);
    const box = new THREE.Box3(new THREE.Vector3(-p.x / 2, -p.y / 2, 0), new THREE.Vector3(p.x / 2, p.y / 2, p.z));
    const helper = new THREE.Box3Helper(box, new THREE.Color(warn ? 0xe03030 : 0x9aa4b0));
    (helper.material as THREE.LineBasicMaterial).transparent = true;
    (helper.material as THREE.LineBasicMaterial).opacity = warn ? 0.9 : 0.45;
    this.bed.add(helper);
    this.requestRender();
  }

  setBedWarning(warn: boolean) {
    if (warn !== this.bedWarn) this.setPrinter(this.printer, warn);
  }

  // ---------------------------------------------------------------- bryły

  syncBodies(results: Record<string, BodyResult>, metas: BodyMeta[], hidden: Set<string> = new Set()) {
    const metaById = new Map(metas.map((m) => [m.id, m]));
    for (const [id, view] of this.bodies) {
      const r = results[id];
      if (!r || r.version !== view.data.version) {
        this.scene.remove(view.group);
        view.dispose();
        this.bodies.delete(id);
      }
    }
    for (const r of Object.values(results)) {
      const meta = metaById.get(r.id);
      let view = this.bodies.get(r.id);
      if (!view) {
        view = new BodyView(r, meta?.color ?? '#4f8fd6');
        this.bodies.set(r.id, view);
        this.scene.add(view.group);
      }
      view.setColor(meta?.color ?? '#4f8fd6');
      view.group.visible = (meta?.visible ?? true) && !hidden.has(r.id);
    }
    this.requestRender();
  }

  setHighlight(h: Highlight) {
    for (const c of this.hiOverlay.children) {
      const o = c as THREE.Mesh;
      o.geometry?.dispose();
    }
    this.hiOverlay.clear();
    for (const f of h.faces ?? []) {
      const view = this.bodies.get(f.bodyId);
      const g = view?.faceGeometry(f.face);
      if (!view || !g) continue;
      const m = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({
          color: f.color,
          transparent: true,
          opacity: f.opacity ?? 0.55,
          depthTest: true,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
          side: THREE.DoubleSide,
        }),
      );
      m.matrixAutoUpdate = false;
      m.matrix.copy(view.group.matrix);
      this.hiOverlay.add(m);
    }
    const byColor = new Map<number, number[]>();
    for (const e of h.edges ?? []) {
      const view = this.bodies.get(e.bodyId);
      const info = view?.data.edges[e.edge];
      if (!view || !info) continue;
      if (!byColor.has(e.color)) byColor.set(e.color, []);
      byColor.get(e.color)!.push(...edgeSegments(view.data.edgePoints, info.start, info.count));
    }
    for (const [color, seg] of byColor) {
      const g = new LineSegmentsGeometry();
      g.setPositions(seg);
      const l = new LineSegments2(g, hiMaterial(color));
      l.renderOrder = 5;
      this.hiOverlay.add(l);
    }
    this.requestRender();
  }

  // ---------------------------------------------------------------- zdarzenia wskaźnika

  pointerInfo(ev: PointerEvent): PointerInfo {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const ndc = new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return {
      x,
      y,
      ndc,
      ray: rc.ray.clone(),
      shift: ev.shiftKey,
      ctrl: ev.ctrlKey || ev.metaKey,
      alt: ev.altKey,
      button: ev.button,
      pointerType: ev.pointerType,
      native: ev,
    };
  }

  private onDown = (ev: PointerEvent) => {
    this.activePointers.add(ev.pointerId);
    if (this.activePointers.size > 1) {
      // drugi palec – gest kamery, anulujemy kliknięcie
      if (this.downInfo?.consumed) {
        this.tool?.pointerUp?.(this.pointerInfo(ev));
        this.controls.enabled = true;
      }
      this.downInfo = null;
      return;
    }
    const info = this.pointerInfo(ev);
    let consumed = false;
    if (ev.button === 0 && this.tool?.pointerDown) consumed = this.tool.pointerDown(info);
    if (consumed) {
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(ev.pointerId);
    }
    this.downInfo = { x: ev.clientX, y: ev.clientY, t: performance.now(), consumed, id: ev.pointerId };
  };

  private onMove = (ev: PointerEvent) => {
    const info = this.pointerInfo(ev);
    if (this.downInfo?.consumed && this.downInfo.id === ev.pointerId) {
      this.tool?.drag?.(info);
      this.requestRender();
      return;
    }
    if (ev.buttons === 0 || ev.pointerType !== 'mouse') {
      if (!this.downInfo) this.tool?.hover?.(info);
    }
  };

  private onUp = (ev: PointerEvent) => {
    this.activePointers.delete(ev.pointerId);
    const d = this.downInfo;
    if (!d || d.id !== ev.pointerId) return;
    this.downInfo = null;
    const info = this.pointerInfo(ev);
    if (d.consumed) {
      this.tool?.pointerUp?.(info);
      this.controls.enabled = true;
      this.requestRender();
      return;
    }
    const moved = Math.hypot(ev.clientX - d.x, ev.clientY - d.y);
    if (moved < 7 && performance.now() - d.t < 900 && (ev.button === 0 || ev.pointerType !== 'mouse')) {
      if (ev.target === this.renderer.domElement || this.renderer.domElement.contains(ev.target as Node)) {
        this.tool?.click?.(info);
        this.tool?.hover?.(info);
        this.requestRender();
      }
    }
  };

  setTool(t: Tool | null) {
    this.tool?.deactivate?.(this);
    this.overlay.clear();
    this.tool = t;
    t?.activate?.(this);
    this.requestRender();
  }

  // ---------------------------------------------------------------- wybieranie

  pickBody(info: PointerInfo, filter?: (id: string) => boolean): BodyHit | null {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(info.ndc, this.camera);
    const meshes = [...this.bodies.values()].filter((b) => b.group.visible && (!filter || filter(b.data.id))).map((b) => b.mesh);
    const hits = rc.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const h = hits[0];
    const id = h.object.userData.bodyId as string;
    const view = this.bodies.get(id)!;
    const face = view.faceOfTriangle(h.faceIndex ?? 0);
    const fi = view.data.faces[face];
    const normal = fi?.normal ? new THREE.Vector3(...fi.normal) : (h.face?.normal.clone() ?? new THREE.Vector3(0, 0, 1));
    return { bodyId: id, face, point: h.point.clone(), normal, distance: h.distance };
  }

  /** Piksele ekranu dla punktu świata. */
  toScreen(p: THREE.Vector3 | Vec3): THREE.Vector2 {
    const v = p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(...p);
    v.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height);
  }

  isInFront(p: THREE.Vector3 | Vec3): boolean {
    const v = p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(...p);
    v.applyMatrix4(this.camera.matrixWorldInverse);
    return v.z < 0;
  }

  /** Najbliższa krawędź w odległości ekranowej (piksele). */
  pickEdge(info: PointerInfo, maxPx: number, bodyFilter?: (id: string) => boolean): { bodyId: string; edge: number; px: number } | null {
    let best: { bodyId: string; edge: number; px: number } | null = null;
    const hit = this.pickBody(info, bodyFilter);
    const p = new THREE.Vector2(info.x, info.y);
    for (const [id, view] of this.bodies) {
      if (!view.group.visible || (bodyFilter && !bodyFilter(id))) continue;
      const pts = view.data.edgePoints;
      view.data.edges.forEach((e, ei) => {
        let prev: THREE.Vector2 | null = null;
        for (let i = e.start; i < e.start + e.count; i += 3) {
          const w = new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]);
          const s = this.toScreen(w);
          if (prev) {
            const d = segDist(p, prev, s);
            if (d < maxPx && (!best || d < best.px)) {
              // pomijamy krawędzie zasłonięte przez bryłę
              if (!hit || this.camera.position.distanceTo(w) <= hit.distance + 2 || hit.bodyId === id) best = { bodyId: id, edge: ei, px: d };
            }
          }
          prev = s;
        }
      });
    }
    return best;
  }

  pickVertex(info: PointerInfo, maxPx: number, bodyFilter?: (id: string) => boolean): { bodyId: string; vertex: number; pos: THREE.Vector3; px: number } | null {
    let best: { bodyId: string; vertex: number; pos: THREE.Vector3; px: number } | null = null;
    for (const [id, view] of this.bodies) {
      if (!view.group.visible || (bodyFilter && !bodyFilter(id))) continue;
      const v = view.data.vertices;
      for (let i = 0; i < v.length; i += 3) {
        const w = new THREE.Vector3(v[i], v[i + 1], v[i + 2]);
        if (!this.isInFront(w)) continue;
        const s = this.toScreen(w);
        const d = s.distanceTo(new THREE.Vector2(info.x, info.y));
        if (d < maxPx && (!best || d < best.px)) best = { bodyId: id, vertex: i / 3, pos: w, px: d };
      }
    }
    return best;
  }

  /** Wielkość piksela ekranu w jednostkach świata w danym punkcie. */
  worldPerPixel(p: THREE.Vector3): number {
    const dist = this.camera.position.distanceTo(p);
    const h = this.renderer.domElement.clientHeight || 1;
    return (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
  }

  // ---------------------------------------------------------------- kamera

  viewFrom(dir: THREE.Vector3, up?: THREE.Vector3) {
    const target = this.controls.target.clone();
    const dist = this.camera.position.distanceTo(target);
    const d = dir.clone().normalize();
    let u = up?.clone() ?? new THREE.Vector3(0, 0, 1);
    if (Math.abs(d.dot(u)) > 0.999) u = new THREE.Vector3(0, 1, 0);
    this.anim = {
      from: this.camera.position.clone(),
      to: target.clone().add(d.multiplyScalar(dist)),
      tFrom: target.clone(),
      tTo: target.clone(),
      upFrom: this.camera.up.clone(),
      upTo: u,
      t0: performance.now(),
    };
  }

  fitAll() {
    const box = new THREE.Box3();
    for (const v of this.bodies.values()) if (v.group.visible) box.expandByObject(v.mesh);
    if (box.isEmpty()) box.set(new THREE.Vector3(-this.printer.x / 2, -this.printer.y / 2, 0), new THREE.Vector3(this.printer.x / 2, this.printer.y / 2, 40));
    this.fitBox(box);
  }

  fitBox(box: THREE.Box3) {
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 5);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1;
    this.anim = {
      from: this.camera.position.clone(),
      to: c.clone().add(dir.multiplyScalar(dist)),
      tFrom: this.controls.target.clone(),
      tTo: c,
      upFrom: this.camera.up.clone(),
      upTo: this.camera.up.clone(),
      t0: performance.now(),
    };
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

const hiMats = new Map<number, ReturnType<typeof makeLineMaterial>>();
function hiMaterial(color: number) {
  let m = hiMats.get(color);
  if (!m) {
    m = makeLineMaterial(color, 4, false);
    hiMats.set(color, m);
  }
  return m;
}

export function segDist(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number {
  const ab = b.clone().sub(a);
  const l2 = ab.lengthSq();
  if (l2 < 1e-9) return p.distanceTo(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / l2));
  return p.distanceTo(a.clone().add(ab.multiplyScalar(t)));
}

export function rayPlane(ray: THREE.Ray, origin: THREE.Vector3 | Vec3, normal: THREE.Vector3 | Vec3): THREE.Vector3 | null {
  const o = origin instanceof THREE.Vector3 ? origin : new THREE.Vector3(...origin);
  const n = normal instanceof THREE.Vector3 ? normal : new THREE.Vector3(...normal);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n.clone().normalize(), o);
  return ray.intersectPlane(plane, new THREE.Vector3());
}
