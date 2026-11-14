// Manipulator: strzałki przesuwu i pierścienie obrotu wokół osi X, Y, Z.
import * as THREE from 'three';
import type { PointerInfo, Viewer } from './Viewer';
import { rayPlane } from './Viewer';

type Part = { type: 'move' | 'rotate'; axis: 0 | 1 | 2 };
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const COLORS = [0xe04848, 0x3fae49, 0x3d6fe0];
export const AXIS_NAMES = ['X', 'Y', 'Z'];

export interface GizmoCallbacks {
  preview: (delta: THREE.Matrix4, label: string, info: PointerInfo) => void;
  commit: (delta: THREE.Matrix4) => void;
  snapMove: () => number | null;
  snapAngle: (free: boolean) => number | null;
}

export class Gizmo {
  group = new THREE.Group();
  private hitMeshes: THREE.Mesh[] = [];
  private visuals = new Map<THREE.Mesh, THREE.Mesh>();
  private drag: { part: Part; start: number; startVec?: THREE.Vector3; lastAngle?: number; acc?: number; value: number } | null = null;
  center = new THREE.Vector3();

  constructor(
    private viewer: Viewer,
    private cb: GizmoCallbacks,
  ) {
    for (let i = 0 as 0 | 1 | 2; i < 3; i = (i + 1) as 0 | 1 | 2) {
      const mat = new THREE.MeshBasicMaterial({ color: COLORS[i], depthTest: false, transparent: true, opacity: 0.95 });
      // strzałka
      const arrow = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 8), mat);
      shaft.position.y = 0.45;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 16), mat);
      head.position.y = 0.92;
      arrow.add(shaft, head);
      const hitA = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.0, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hitA.position.y = 0.55;
      arrow.add(hitA);
      hitA.userData.part = { type: 'move', axis: i } satisfies Part;
      this.visuals.set(hitA, head);
      if (i === 0) arrow.rotation.z = -Math.PI / 2;
      if (i === 2) arrow.rotation.x = Math.PI / 2;
      this.group.add(arrow);
      this.hitMeshes.push(hitA);
      // pierścień
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.014, 6, 64), mat.clone());
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.8;
      const hitR = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 6, 48), new THREE.MeshBasicMaterial({ visible: false }));
      hitR.userData.part = { type: 'rotate', axis: i } satisfies Part;
      this.visuals.set(hitR, ring);
      const rg = new THREE.Group();
      rg.add(ring, hitR);
      if (i === 0) rg.rotation.y = Math.PI / 2;
      if (i === 1) rg.rotation.x = Math.PI / 2;
      this.group.add(rg);
      this.hitMeshes.push(hitR);
    }
    this.group.renderOrder = 10;
    this.group.traverse((o) => (o.renderOrder = 10));
  }

  setCenter(c: THREE.Vector3) {
    this.center.copy(c);
    this.group.position.copy(c);
    this.updateScale();
  }

  updateScale() {
    const s = this.viewer.worldPerPixel(this.center) * 110;
    this.group.scale.setScalar(s);
    this.group.updateMatrixWorld(true);
  }

  hit(info: PointerInfo): Part | null {
    if (!this.group.visible || !this.group.parent) return null;
    this.updateScale();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(info.ndc, this.viewer.camera);
    const h = rc.intersectObjects(this.hitMeshes, false);
    return h.length ? (h[0].object.userData.part as Part) : null;
  }

  hover(info: PointerInfo) {
    const p = this.hit(info);
    for (const [hit, vis] of this.visuals) {
      const part = hit.userData.part as Part;
      const on = p && p.type === part.type && p.axis === part.axis;
      (vis.material as THREE.MeshBasicMaterial).color.set(on ? 0xffc400 : COLORS[part.axis]);
    }
    this.viewer.requestRender();
    return p;
  }

  begin(info: PointerInfo): boolean {
    const part = this.hit(info);
    if (!part) return false;
    if (part.type === 'move') {
      this.drag = { part, start: this.axisParam(info, part.axis), value: 0 };
    } else {
      const v = this.planeVec(info, part.axis);
      if (!v) return false;
      this.drag = { part, start: 0, startVec: v, lastAngle: 0, acc: 0, value: 0 };
    }
    return true;
  }

  move(info: PointerInfo) {
    const d = this.drag;
    if (!d) return;
    const axis = AXES[d.part.axis];
    const m = new THREE.Matrix4();
    let label = '';
    if (d.part.type === 'move') {
      let t = this.axisParam(info, d.part.axis) - d.start;
      const snap = this.cb.snapMove();
      if (snap) t = Math.round(t / snap) * snap;
      d.value = t;
      m.makeTranslation(axis.x * t, axis.y * t, axis.z * t);
      label = `${AXIS_NAMES[d.part.axis]}: ${t >= 0 ? '+' : ''}${t.toFixed(2).replace('.', ',')} mm`;
    } else {
      const v = this.planeVec(info, d.part.axis);
      if (!v || !d.startVec) return;
      const cross = new THREE.Vector3().crossVectors(d.startVec, v);
      let ang = Math.atan2(cross.dot(axis), d.startVec.dot(v));
      // ciągłość kąta powyżej 180°
      let diff = ang - (d.lastAngle ?? 0);
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      d.acc = (d.acc ?? 0) + diff;
      d.lastAngle = ang;
      ang = d.acc;
      const snap = this.cb.snapAngle(info.shift);
      let degs = THREE.MathUtils.radToDeg(ang);
      if (snap) degs = Math.round(degs / snap) * snap;
      d.value = degs;
      const r = new THREE.Matrix4().makeRotationAxis(axis, THREE.MathUtils.degToRad(degs));
      m.makeTranslation(this.center.x, this.center.y, this.center.z).multiply(r).multiply(new THREE.Matrix4().makeTranslation(-this.center.x, -this.center.y, -this.center.z));
      label = `Obrót ${AXIS_NAMES[d.part.axis]}: ${degs.toFixed(1).replace('.', ',')}°`;
    }
    this.cb.preview(m, label, info);
    this.lastDelta = m;
  }

  private lastDelta: THREE.Matrix4 | null = null;

  end() {
    if (this.drag && this.lastDelta && this.drag.value !== 0) this.cb.commit(this.lastDelta);
    this.drag = null;
    this.lastDelta = null;
  }

  get dragging() {
    return !!this.drag;
  }

  private axisParam(info: PointerInfo, axisIdx: number): number {
    const a = AXES[axisIdx];
    const o = info.ray.origin;
    const dvec = info.ray.direction;
    const w0 = o.clone().sub(this.center);
    const A = dvec.dot(dvec), B = dvec.dot(a), C = a.dot(a), D = dvec.dot(w0), E = a.dot(w0);
    const den = A * C - B * B;
    if (Math.abs(den) < 1e-9) return 0;
    return (A * E - B * D) / den;
  }

  private planeVec(info: PointerInfo, axisIdx: number): THREE.Vector3 | null {
    const p = rayPlane(info.ray, this.center, AXES[axisIdx]);
    if (!p) return null;
    const v = p.sub(this.center);
    if (v.lengthSq() < 1e-12) return null;
    return v.normalize();
  }
}
