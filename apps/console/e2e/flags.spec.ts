import { expect, test } from '@playwright/test';
import { EDITOR, changeState, ensureEditor, signIn } from './users';

test.describe('flags in the console', () => {
  test('create a flag, roll it out to 30%, see the change in the audit log', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'New flag' }).click();
    await page.getByLabel('Key').fill('e2e-banner');
    await page.getByLabel('Name', { exact: true }).fill('E2E banner');
    await page.getByRole('button', { name: 'Create flag' }).click();
    const row = page.locator('[data-flag="e2e-banner"]');
    await expect(row).toBeVisible();
    await expect(row.locator('[data-state]')).toHaveText('Off');

    await row.getByRole('link', { name: 'E2E banner' }).click();
    await page.getByLabel('Targeting on').check();
    await page.locator('input[name="fallthrough-mode"][value="rollout"]').check();
    const exact = page.getByLabel('Exact % for 1: true');
    await exact.fill('30');
    await exact.dispatchEvent('change');
    await expect(page.getByText('1: true: 30%, 0: false: 70%')).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/Saved\. development now runs version 2/)).toBeVisible();

    await page.getByRole('link', { name: 'Audit log' }).click();
    const entry = page.locator('li[data-action="flag.state.updated"]').first();
    await expect(entry).toContainText('e2e-banner');
    await entry.locator('summary').click();
    await expect(entry.getByRole('row', { name: /\/on/ })).toContainText('false');
    await expect(entry.getByRole('row', { name: /\/on/ })).toContainText('true');
    // The default rule went from 1 variation to a rollout: 7,000 and 3,000 of 10,000 buckets.
    await expect(entry.getByRole('row', { name: /\/fallthrough\/rollout/ })).toContainText('"weight":3000');
  });

  test('the kill switch serves the off variation and shows on the list', async ({ page }) => {
    await signIn(page);
    await page.goto('/flags/max-cart-items');
    await page.getByRole('button', { name: 'Kill this flag' }).click();
    await expect(page.getByText('Kill switch on: every user gets the off variation.')).toBeVisible();
    await page.getByRole('link', { name: 'Flags', exact: true }).click();
    await expect(page.locator('[data-flag="max-cart-items"] [data-state]')).toHaveText('Killed');
    await page.goto('/flags/max-cart-items');
    await page.getByRole('button', { name: 'Turn kill switch off' }).click();
    await expect(page.getByText('Kill switch off: targeting applies again.')).toBeVisible();
  });

  test('a stale save gets the 412 conflict notice', async ({ page, request }) => {
    await signIn(page);
    await page.goto('/flags/holiday-banner');
    await page.getByLabel('Targeting on').check();
    // Another user saves first.
    await changeState(request, '/api/v1/projects/demo-shop/flags/holiday-banner/environments/development', { offVariation: 1 });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/your save was refused \(412\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Re-load', exact: true }).click();
    await expect(page.getByLabel('When targeting is off, serve')).toHaveValue('1');
  });

  test("another user's change reaches an open console without a re-load", async ({ browser, page, request }) => {
    await ensureEditor(request);
    await signIn(page);
    await expect(page.locator('[data-flag="search-ranking"] [data-state]')).toHaveText('On');
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();

    const other = await browser.newContext();
    const editorPage = await other.newPage();
    await signIn(editorPage, EDITOR);
    await editorPage.goto('/flags/search-ranking');
    await editorPage.getByRole('button', { name: 'Kill this flag' }).click();
    await expect(editorPage.getByText('Kill switch on')).toBeVisible();

    await expect(page.locator('[data-flag="search-ranking"] [data-state]')).toHaveText('Killed');
    await editorPage.getByRole('button', { name: 'Turn kill switch off' }).click();
    await expect(page.locator('[data-flag="search-ranking"] [data-state]')).toHaveText('On');
    await other.close();
  });
});
