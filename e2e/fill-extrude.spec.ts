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
async function line(page: Page, a: [number, number], b: [number, number]) {
  await page.getByTestId('sk-line').click();
  await clickAt(page, ...a);
  await clickAt(page, ...b);
  await page.keyboard.press('Escape');
}
async function startSketchXY(page: Page) {
  await freshStart(page);
  await page.getByTestId('tool-sketchPlane').click();
  await page.getByTestId('plane-XY').click();
  await page.waitForTimeout(500);
}
async function extrudeTo(page: Page, h: string) {
  await expect(page.getByTestId('extrude-distance')).toBeVisible();
  await setField(page, 'extrude-distance', h);
  await settled(page);
  await page.getByTestId('extrude-ok').click();
  await settled(page);
  await expect(page.getByTestId('body-panel')).toBeVisible();
}

test('wypełnienie obszaru między przecinającymi się liniami i wyciągnięcie przyciskiem w pasku szkicu', async ({ page }) => {
  await startSketchXY(page);
  await page.getByTestId('sk-rect').click();
  await clickAt(page, -20, -10);
  await clickAt(page, 20, 10);
  // linia przecinająca prostokąt i wystająca poza niego (bez wspólnych punktów)
  await line(page, [0, -15], [0, 15]);
  await page.getByTestId('sk-fill').click();
  await clickAt(page, -10, 0);
  await expect(page.getByTestId('profile-panel')).toContainText('Pole ≈ 400');
  await page.getByTestId('sk-extrude').click();
  await extrudeTo(page, '10');
  await expect(page.getByTestId('size-X')).toHaveValue('20');
  await expect(page.getByTestId('body-panel')).toContainText(/objętość 4(,00)? cm³/);
});

test('kratka z czterech linii: „Wyciągnij” sam wypełnia jedyny zamknięty obszar', async ({ page }) => {
  await startSketchXY(page);
  await line(page, [-25, -10], [25, -10]);
  await line(page, [-25, 10], [25, 10]);
  await line(page, [-10, -25], [-10, 25]);
  await line(page, [10, -25], [10, 25]);
  await page.keyboard.press('e');
  await extrudeTo(page, '5');
  await expect(page.getByTestId('body-panel')).toContainText(/objętość 2(,00)? cm³/);
});

test('narzędzie „Wyciągnij” po zakończeniu szkicu: klik w niewypełniony obszar dwóch okręgów', async ({ page }) => {
  await startSketchXY(page);
  await page.getByTestId('sk-circle').click();
  await clickAt(page, 0, 0);
  await setField(page, 'dim-d', '20');
  await clickAt(page, 14, 0);
  await setField(page, 'dim-d', '20');
  await page.getByTestId('sk-finish').click();
  await page.getByTestId('tool-extrude').click();
  await clickAt(page, 7, 0);
  await extrudeTo(page, '4');
  // soczewka: r=10, odległość środków 14
  const r = 10, d = 14;
  const lens = 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
  await expect(page.getByTestId('body-panel')).toContainText(`objętość ${((lens * 4) / 1000).toFixed(2).replace('.', ',')} cm³`);
});
