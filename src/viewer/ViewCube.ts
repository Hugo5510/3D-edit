// Kostka widoków: klik w ścianę, krawędź lub narożnik ustawia kamerę.
import * as THREE from 'three';
import type { Viewer } from './Viewer';

const LABELS: { dir: [number, number, number]; text: string }[] = [
  { dir: [1, 0, 0], text: 'Prawo' },
  { dir: [-1, 0, 0], text: 'Lewo' },
  { dir: [0, 1, 0], text: 'Tył' },
  { dir: [0, -1, 0], text: 'Przód' },
  { dir: [0, 0, 1], text: 'Góra' },
  { dir: [0, 0, -1], text: 'Dół' },
];

function labelTexture(text: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f7f9fc';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#8a96a6';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 122, 122);
  ctx.fillStyle = '#243042';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ViewCube {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
  cube: THREE.Mesh;
  el: HTMLCanvasElement;
  private hoverMesh: THREE.Mesh;

  constructor(
    host: HTMLElement,
    private viewer: Viewer,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(110, 110);
    this.el = this.renderer.domElement;
    this.el.className = 'viewcube';
    this.el.title = 'Kostka widoków – kliknij ścianę, krawędź lub narożnik';
    host.appendChild(this.el);
    // kolejność materiałów BoxGeometry: +x, -x, +y, -y, +z, -z
    const mats = LABELS.map((l) => new THREE.MeshBasicMaterial({ map: labelTexture(l.text) }));
    // napisy na ścianach bocznych mają być czytelne przy osi Z do góry
    const geo = new THREE.BoxGeometry(2, 2, 2);
    this.cube = new THREE.Mesh(geo, mats);
    fixUVs(geo);
    this.scene.add(this.cube);
    this.hoverMesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffa000, transparent: true, opacity: 0.8 }));
    this.hoverMesh.visible = false;
    this.scene.add(this.hoverMesh);
    const axes = new THREE.AxesHelper(1.5);
    axes.position.set(-1.05, -1.05, -1.05);
    this.scene.add(axes);
    viewer.onCameraChange.push(() => this.render());
    this.el.addEventListener('pointermove', (e) => this.hover(e));
    this.el.addEventListener('pointerleave', () => {
      this.hoverMesh.visible = false;
      this.render();
    });
    this.el.addEventListener('click', (e) => this.click(e));
    this.render();
  }

  private dirAt(e: MouseEvent): THREE.Vector3 | null {
    const r = this.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const h = rc.intersectObject(this.cube, false)[0];
    if (!h) return null;
    const p = h.point;
    const d = new THREE.Vector3(Math.abs(p.x) > 0.55 ? Math.sign(p.x) : 0, Math.abs(p.y) > 0.55 ? Math.sign(p.y) : 0, Math.abs(p.z) > 0.55 ? Math.sign(p.z) : 0);
    return d.lengthSq() ? d : null;
  }

  private hover(e: PointerEvent) {
    const d = this.dirAt(e);
    this.hoverMesh.visible = !!d;
    if (d) this.hoverMesh.position.copy(d.clone().multiplyScalar(1.0));
    this.render();
  }

  private click(e: MouseEvent) {
    const d = this.dirAt(e);
    if (!d) return;
    const up = Math.abs(d.z) > 0.9 && d.x === 0 && d.y === 0 ? new THREE.Vector3(0, d.z > 0 ? 1 : -1, 0) : new THREE.Vector3(0, 0, 1);
    this.viewer.viewFrom(d, up);
  }

  render() {
    const cam = this.viewer.camera;
    const dir = cam.position.clone().sub(this.viewer.controls.target).normalize();
    this.camera.position.copy(dir.multiplyScalar(5));
    this.camera.up.copy(cam.up);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }
}

/** Ustawia UV ścian tak, by napisy nie były do góry nogami przy osi Z w górę. */
function fixUVs(geo: THREE.BoxGeometry) {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  // każda ściana ma 4 wierzchołki; dla ścian bocznych (+x,-x,+y,-y) obracamy UV tak, by „góra” = +Z
  const rotate = (face: number, quarter: number) => {
    for (let q = 0; q < quarter; q++) {
      for (let i = 0; i < 4; i++) {
        const idx = face * 4 + i;
        const u = uv.getX(idx), v = uv.getY(idx);
        uv.setXY(idx, 1 - v, u);
      }
    }
  };
  // BoxGeometry: UV ściany +x rośnie wzdłuż (-z, +y), -x: (+z, +y), +y: (+x, -z), -y: (+x, +z), -z: (-x, +y)
  rotate(0, 3);
  rotate(1, 1);
  rotate(2, 2);
  rotate(5, 2);
  uv.needsUpdate = true;
}
