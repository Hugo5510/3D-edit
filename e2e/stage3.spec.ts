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
async function addBox(page: Page) {
  await page.getByTestId('tool-primitives').click();
  await page.getByTestId('add-box').click();
  await settled(page);
}
const vol = (v: number) => `objętość ${(v / 1000).toFixed(2).replace('.', ',')} cm³`;

test('otwór z odległościami od krawędzi, na wylot i na głębokość', async ({ page }) => {
  await freshStart(page);
  await addBox(page);
  await setField(page, 'param-w', '40');
  await settled(page);
  await page.getByTestId('fit-view').click();
  await page.waitForTimeout(500);
  await page.getByTestId('tool-hole').click();
  await clickAt(page, 5, 3, 20);
  await expect(page.getByTestId('hole-panel')).toBeVisible();
  await setField(page, 'hole-d', '6');
  await setField(page, 'hole-o1', '10');
  await setField(page, 'hole-o2', '7');
  await settled(page);
  await page.getByTestId('hole-ok').click();
  await settled(page);
  await expect(page.getByTestId('body-panel')).toContainText(vol(40 * 20 * 20 - Math.PI * 9 * 20));
  // drugi otwór o głębokości 5 mm
  await page.getByTestId('tool-hole').click();
  await clickAt(page, -12, -4, 20);
  await setField(page, 'hole-d', '4');
  await page.getByTestId('hole-through').uncheck();
  await setField(page, 'hole-depth', '5');
  await settled(page);
  await page.getByTestId('hole-ok').click();
  await settled(page);
  await expect(page.getByTestId('body-panel')).toContainText(vol(40 * 20 * 20 - Math.PI * 9 * 20 - Math.PI * 4 * 5));
  await expect(page.locator('.history li.error')).toHaveCount(0);
});

test('różnica brył i zaokrąglenie wszystkich krawędzi', async ({ page }) => {
  await freshStart(page);
  await addBox(page);
  await page.getByTestId('tool-primitives').click();
  await page.getByTestId('add-cylinder').click();
  await settled(page);
  await setField(page, 'param-r', '5');
  await setField(page, 'param-h', '30');
  await setField(page, 'pos-X', '0');
  await settled(page);
  await page.getByTestId('fit-view').click();
  await page.waitForTimeout(500);
  await page.getByTestId('tool-subtract').click();
  await clickAt(page, 8, -10, 10); // przód prostopadłościanu
  await clickAt(page, 0, 0, 25); // walec wystaje ponad
  await expect(page.getByTestId('boolean-panel')).toContainText('Walec 1');
  await page.getByTestId('boolean-ok').click();
  await settled(page);
  await expect(page.getByTestId('body-panel')).toContainText(vol(8000 - Math.PI * 25 * 20));
  await page.getByTestId('tool-chamfer').click();
  await page.getByTestId('fillet-all').click();
  await setField(page, 'fillet-r', '1');
  await page.getByTestId('fillet-ok').click();
  await settled(page);
  await expect(page.locator('.history li.error')).toHaveCount(0);
  await expect(page.locator('.history li')).toHaveCount(4);
});

test('zaokrąglenie wybranej krawędzi i pomiar', async ({ page }) => {
  await freshStart(page);
  await addBox(page);
  await page.getByTestId('fit-view').click();
  await page.waitForTimeout(500);
  await page.getByTestId('tool-fillet').click();
  await clickAt(page, 0, -10, 20); // przednia górna krawędź
  await expect(page.getByTestId('fillet-count')).toContainText('1');
  await setField(page, 'fillet-r', '5');
  await page.getByTestId('fillet-ok').click();
  await settled(page);
  await expect(page.getByTestId('body-panel')).toContainText(vol(8000 - (25 - (Math.PI * 25) / 4) * 20));
  await page.getByTestId('tool-measure').click();
  await clickAt(page, -10, -10, 0);
  await clickAt(page, 10, 10, 0);
  await expect(page.getByTestId('measure-result')).toHaveText(/28,28 mm/);
});
