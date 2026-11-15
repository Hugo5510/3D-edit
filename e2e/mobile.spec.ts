import { test, expect, devices, type Page } from '@playwright/test';
import { setField, settled } from './helpers';

test.use({ ...devices['Pixel 7'] });

async function scr(page: Page, x: number, y: number, z = 0): Promise<[number, number]> {
  return page.evaluate(
    ([x, y, z]) => {
      const v = (window as unknown as { __viewer: { toScreen: (p: number[]) => { x: number; y: number }; renderer: { domElement: HTMLCanvasElement } } }).__viewer;
      const s = v.toScreen([x, y, z]);
      const r = v.renderer.domElement.getBoundingClientRect();
      return [s.x + r.left, s.y + r.top] as [number, number];
    },
    [x, y, z],
  );
}

test('telefon: szkic stuknięciami, wypełnienie, wyciągnięcie, klawiatura numeryczna', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => new Promise<void>((r) => { const q = indexedDB.deleteDatabase('3d-edit'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  await page.reload();
  await expect(page.getByTestId('status')).toHaveText('Gotowe', { timeout: 60_000 });
  await page.getByTestId('tool-sketchPlane').tap();
  await page.getByTestId('plane-XY').tap();
  await page.waitForTimeout(500);
  await page.getByTestId('sk-rect').tap();
  await page.touchscreen.tap(...(await scr(page, -30, -20)));
  await page.touchscreen.tap(...(await scr(page, 30, 20)));
  await page.getByTestId('sk-fill').tap();
  await page.touchscreen.tap(...(await scr(page, 0, 0)));
  await expect(page.getByTestId('profile-panel')).toContainText('2400');
  await page.getByTestId('extrude-profile').tap();
  const field = page.getByTestId('extrude-distance');
  await expect(field).toHaveAttribute('inputmode', 'decimal');
  await setField(page, 'extrude-distance', '7,5');
  await settled(page);
  await page.getByTestId('extrude-ok').tap();
  await settled(page);
  await expect(page.getByTestId('size-Z')).toHaveValue('7,5');
  // menu plików na telefonie
  await page.getByTestId('file-menu').tap();
  await page.getByTestId('m-export').tap();
  await expect(page.getByTestId('program-hints')).toBeVisible();
});
