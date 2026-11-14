import { expect, type Page } from '@playwright/test';

export async function freshStart(page: Page) {
  await page.goto('/');
  await page.evaluate(
    () =>
      new Promise<void>((res) => {
        const r = indexedDB.deleteDatabase('3d-edit');
        r.onsuccess = r.onerror = r.onblocked = () => res();
      }),
  );
  await page.reload();
  await expect(page.getByTestId('status')).toHaveText('Gotowe', { timeout: 60_000 });
}

export async function setField(page: Page, testId: string, value: string) {
  const f = page.getByTestId(testId);
  await f.fill(value);
  await f.press('Enter');
}

/** Czeka, aż przebudowa geometrii się zakończy. */
export async function settled(page: Page) {
  await page.waitForTimeout(150);
  await expect(page.getByTestId('status')).toHaveText('Gotowe', { timeout: 30_000 });
}
