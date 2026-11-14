import { test, expect, type Page } from '@playwright/test';
import { freshStart, setField, settled } from './helpers';

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
async function clickAt(page: Page, x: number, y: number, z = 0) {
  const [sx, sy] = await scr(page, x, y, z);
  await page.mouse.move(sx, sy);
  await page.mouse.click(sx, sy);
}
async function dragFromTo(page: Page, a: [number, number], b: [number, number]) {
  const [ax, ay] = await scr(page, ...a);
  const [bx, by] = await scr(page, ...b);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(ax + ((bx - ax) * i) / 8, ay + ((by - ay) * i) / 8);
  await page.mouse.up();
}

test('szkic z osobnych linii: przerwa, domknięcie przeciągnięciem, zaokrąglenie, wypełnienie i wyciągnięcie', async ({ page }) => {
  await freshStart(page);
  await page.getByTestId('tool-sketchPlane').click();
  await page.getByTestId('plane-XY').click();
  await page.waitForTimeout(500);
  // trzy linie łańcuchem + czwarta niedomknięta
  await clickAt(page, -20, -10);
  await clickAt(page, 20, -10);
  await clickAt(page, 20, 10);
  await clickAt(page, -20, 10);
  await clickAt(page, -20, -4);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('gap-info')).toBeVisible();
  await page.getByTestId('sk-fill').click();
  await clickAt(page, 0, 0);
  await expect(page.getByTestId('toast')).toContainText('niedomknięty');
  // przeciągnięcie końca na punkt startowy łączy punkty
  await page.getByTestId('sk-select').click();
  await dragFromTo(page, [-20, -4], [-20, -10]);
  await expect(page.getByTestId('gap-info')).toHaveCount(0);
  // zaokrąglenie narożnika R3
  await page.getByTestId('sk-sketchFillet').click();
  await setField(page, 'dim-r', '3');
  await clickAt(page, 20, 10);
  // wypełnienie i wyciągnięcie na 12,5 mm
  await page.getByTestId('sk-fill').click();
  await clickAt(page, 0, 0);
  await expect(page.getByTestId('profile-panel')).toBeVisible();
  await page.getByTestId('extrude-profile').click();
  await setField(page, 'extrude-distance', '12,5');
  await settled(page);
  await page.getByTestId('extrude-ok').click();
  await settled(page);
  await expect(page.getByTestId('body-panel')).toBeVisible();
  await expect(page.getByTestId('size-Z')).toHaveValue('12,5');
  const vol = (40 * 20 - (9 - (Math.PI * 9) / 4)) * 12.5;
  await expect(page.getByTestId('body-panel')).toContainText(`objętość ${(vol / 1000).toFixed(2).replace('.', ',')} cm³`);
});

test('wycięcie konturem narysowanym na ścianie bryły', async ({ page }) => {
  await freshStart(page);
  await page.getByTestId('tool-primitives').click();
  await page.getByTestId('add-box').click();
  await settled(page);
  await page.getByTestId('tool-sketchPlane').click();
  // klik w górną ścianę prostopadłościanu (20x20x20, góra na z=20)
  await clickAt(page, 0, 0, 20);
  await expect(page.getByTestId('sketch-bar')).toBeVisible();
  await page.getByTestId('sk-circle').click();
  await clickAt(page, 0, 0, 20);
  await setField(page, 'dim-d', '8');
  await page.getByTestId('sk-fill').click();
  await clickAt(page, 0, 0, 20);
  await page.getByTestId('extrude-profile').click();
  await page.getByTestId('mode-cut').click();
  await setField(page, 'extrude-distance', '-5');
  await settled(page);
  await page.getByTestId('extrude-ok').click();
  await settled(page);
  const vol = 8000 - Math.PI * 16 * 5;
  await expect(page.getByTestId('body-panel')).toContainText(`objętość ${(vol / 1000).toFixed(2).replace('.', ',')} cm³`);
  await expect(page.locator('.history li.error')).toHaveCount(0);
});
