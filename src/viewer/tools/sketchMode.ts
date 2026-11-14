import * as THREE from 'three';
import type { Plane } from '../../model/types';
import { planeY } from '../../model/math';
import { refs } from '../ref';
import { useApp } from '../../state/store';

export function viewFromPlane(plane: Plane) {
  const v = refs.viewer;
  if (!v) return;
  v.viewFrom(new THREE.Vector3(...plane.normal), new THREE.Vector3(...planeY(plane.normal, plane.xDir)));
}

export function exitSketch() {
  const st = useApp.getState();
  st.setActiveSketch(null);
  st.setTool('select');
  st.setSelection(null);
}

export function editSketch(id: string) {
  const st = useApp.getState();
  const sk = st.doc.sketches.find((s) => s.id === id);
  if (!sk) return;
  st.setActiveSketch(id);
  st.setTool('line');
  viewFromPlane(sk.plane);
}
