import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { freshStart, settled } from './helpers';
import { parseStl } from '../src/io/meshFormats';
import { parse3mf } from '../src/io/threemf';
import { isClosedMesh, meshBBox, weld } from '../src/kernel/meshOps';

async function addBox(page: Page) {
  await page.getByTestId('tool-primitives').click();
  await page.getByTestId('add-box').click();
  await settled(page);
}

async function exportAs(page: Page, fmt: string) {
  await page.getByTestId('export').click();
  await page.getByTestId(`fmt-${fmt}`).click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('do-export').click();
  const d = await dl;
  const path = (await d.path())!;
  const name = d.suggestedFilename();
  return { path, name, file: { name, mimeType: 'application/octet-stream', buffer: readFileSync(path) } };
}

const size = (pos: Float32Array) => {
  const bb = meshBBox(pos);
  return bb.max.map((v, i) => +(v - bb.min[i]).toFixed(3));
};

test('eksport STL i 3MF sześcianu 20 mm, ponowny import STL', async ({ page }) => {
  await freshStart(page);
  await addBox(page);
  const stl = await exportAs(page, 'stl');
  expect(stl.name).toMatch(/\.stl$/);
  const buf = readFileSync(stl.path);
  const m = weld(parseStl(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)).positions, null);
  expect(size(m.positions)).toEqual([20, 20, 20]);
  expect(isClosedMesh(m)).toBe(true);

  const tmf = await exportAs(page, '3mf');
  const t = parse3mf(new Uint8Array(readFileSync(tmf.path)));
  expect(size(t[0].positions)).toEqual([20, 20, 20]);
  expect(isClosedMesh(weld(t[0].positions, t[0].indices))).toBe(true);

  // ponowny import STL jako siatka
  await page.getByTestId('import').click();
  await page.getByTestId('import-input').setInputFiles(stl.file);
  await expect(page.locator('.history li')).toHaveCount(2);
  await settled(page);
  await expect(page.getByTestId('body-panel')).toContainText('Siatka trójkątów');
  await expect(page.getByTestId('body-panel')).toContainText('zamknięta');
  await expect(page.getByTestId('size-X')).toHaveValue('20');
});

test('STEP: eksport i import jako dokładna bryła', async ({ page }) => {
  await freshStart(page);
  await addBox(page);
  const step = await exportAs(page, 'step');
  const text = readFileSync(step.path, 'utf8');
  expect(text).toContain('ISO-10303-21');
  await page.getByTestId('delete-body').click();
  await settled(page);
  await page.getByTestId('import').click();
  await page.getByTestId('import-input').setInputFiles(step.file);
  await settled(page);
  await expect(page.locator('.history li')).toHaveCount(1);
  await expect(page.locator('.history li').first()).toContainText('Import STEP');
  await expect(page.getByTestId('body-panel')).toContainText('Bryła B-rep');
  await expect(page.getByTestId('body-panel')).toContainText('objętość 8 cm³');
});

test('okno importu informuje o formatach zamkniętych', async ({ page }) => {
  await freshStart(page);
  await page.getByTestId('import').click();
  await expect(page.getByTestId('program-hints')).toContainText('Inventor');
  await page.getByTestId('import-input').setInputFiles({ name: 'czesc.ipt', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await expect(page.getByTestId('import-error')).toContainText('STEP');
});

test('zapis i odczyt projektu z historią', async ({ page }) => {
  await freshStart(page);
  await addBox(page);
  const proj = await exportAs(page, 'project');
  expect(proj.name).toMatch(/\.3dedit$/);
  await page.getByTestId('tool-primitives').click();
  await page.getByTestId('add-sphere').click();
  await settled(page);
  await expect(page.locator('.history li')).toHaveCount(2);
  await page.getByTestId('open-input').setInputFiles(proj.file);
  await settled(page);
  await expect(page.locator('.history li')).toHaveCount(1);
});
