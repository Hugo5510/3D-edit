import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { freshStart, setField, settled } from './helpers';
import { parse3mf } from '../src/io/threemf';
import { meshBBox } from '../src/kernel/meshOps';

test('Otwórz w Bambu Studio: 3MF w mm, ułożony na środku stołu 256 mm', async ({ page }) => {
  await freshStart(page);
  await page.getByTestId('tool-primitives').click();
  await page.getByTestId('add-cylinder').click();
  await settled(page);
  await setField(page, 'pos-X', '-50');
  await setField(page, 'pos-Z', '10');
  await settled(page);
  await page.getByTestId('bambu').click();
  await expect(page.getByTestId('bambu-size')).toContainText('mieści się');
  const dl = page.waitForEvent('download');
  await page.getByTestId('bambu-download').click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/\.3mf$/);
  const xml = readFileSync((await d.path())!);
  const [m] = parse3mf(new Uint8Array(xml));
  const bb = meshBBox(m.positions);
  expect((bb.min[0] + bb.max[0]) / 2).toBeCloseTo(128, 2);
  expect((bb.min[1] + bb.max[1]) / 2).toBeCloseTo(128, 2);
  expect(bb.min[2]).toBeCloseTo(0, 4);
  expect(bb.max[2] - bb.min[2]).toBeCloseTo(20, 3);
});

test('ostrzeżenie w oknie Bambu, gdy model jest za duży, i zmiana wymiarów drukarki', async ({ page }) => {
  await freshStart(page);
  await page.getByTestId('tool-primitives').click();
  await page.getByTestId('add-box').click();
  await settled(page);
  await setField(page, 'param-w', '200');
  await settled(page);
  await page.getByTestId('printer').click();
  await setField(page, 'printer-x', '180');
  await page.getByTestId('dialog-close').click();
  await expect(page.getByTestId('bed-warning')).toBeVisible();
  await page.getByTestId('bambu').click();
  await expect(page.getByTestId('bambu-size')).toContainText('nie mieści się');
});
