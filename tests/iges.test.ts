import { beforeAll, describe, expect, it } from 'vitest';
import { OcctKernel } from 'occt-wasm';
import { brepToIges, igesToBrep } from '../src/kernel/iges';

let k: OcctKernel;
beforeAll(async () => {
  k = await OcctKernel.init();
});

describe('IGES', () => {
  it('sześcian 20 mm z zaokrągleniami: eksport i ponowny import zachowuje bryłę', async () => {
    const box = k.makeBox(20, 20, 20);
    const f = k.fillet(box, k.getSubShapes(box, 'edge'), 2);
    const igs = await brepToIges(k.toBREP(f));
    expect(igs).toMatch(/S0000001/);
    expect(igs).toMatch(/MM/); // jednostka milimetry w sekcji globalnej
    const back = k.fromBREP(await igesToBrep(igs));
    expect(k.getSubShapes(back, 'solid').length).toBe(1);
    expect(k.getVolume(back)).toBeCloseTo(k.getVolume(f), 3);
    const bb = k.getBoundingBox(back);
    expect(bb.xmax - bb.xmin).toBeCloseTo(20, 4);
    expect(bb.zmax - bb.zmin).toBeCloseTo(20, 4);
  });
});
