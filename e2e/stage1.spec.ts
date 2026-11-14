import { test, expect } from '@playwright/test';
import { freshStart, setField, settled } from './helpers';

test('bryły gotowe, wymiary, pozycja, obrót, skalowanie, cofnij', async ({ page }) => {
  await freshStart(page);
  await page.getByTestId('tool-primitives').click();
  await page.getByTestId('add-box').click();
  await settled(page);
  await expect(page.getByTestId('body-panel')).toBeVisible();

  await setField(page, 'param-w', '30,25');
  await settled(page);
  await expect(page.getByTestId('size-X')).toHaveValue('30,25');

  await setField(page, 'pos-X', '15');
  await settled(page);
  await expect(page.getByTestId('pos-X')).toHaveValue('15');

  await page.getByTestId('rot90-Z').click();
  await settled(page);
  await expect(page.getByTestId('size-Y')).toHaveValue('30,25');
  await expect(page.getByTestId('size-X')).toHaveValue('20');

  await setField(page, 'size-Z', '40');
  await settled(page);
  await expect(page.getByTestId('size-X')).toHaveValue('40');
  await expect(page.getByTestId('size-Y')).toHaveValue('60,5');

  await page.getByTestId('undo').click();
  await settled(page);
  await expect(page.getByTestId('size-Z')).toHaveValue('20');

  // wszystkie bryły gotowe
  for (const k of ['cylinder', 'sphere', 'cone', 'torus', 'prism', 'wedge']) {
    await page.getByTestId('tool-primitives').click();
    await page.getByTestId(`add-${k}`).click();
    await settled(page);
  }
  await expect(page.locator('.history li')).toHaveCount(7);
  await expect(page.locator('.history li.error')).toHaveCount(0);
});

test('ostrzeżenie, gdy model nie mieści się na stole', async ({ page }) => {
  await freshStart(page);
  await page.getByTestId('tool-primitives').click();
  await page.getByTestId('add-box').click();
  await settled(page);
  await setField(page, 'param-h', '300');
  await settled(page);
  await expect(page.getByTestId('bed-warning')).toBeVisible();
  await setField(page, 'param-h', '200');
  await settled(page);
  await expect(page.getByTestId('bed-warning')).toHaveCount(0);
});
