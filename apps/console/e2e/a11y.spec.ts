import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signIn } from './users';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function checkPage(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `sideways scroll on ${label}`).toBeLessThanOrEqual(0);
}

test('every console page has 0 axe violations and no sideways scroll', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to flagken' })).toBeVisible();
  await checkPage(page, 'login');

  await signIn(page);
  await expect(page.locator('[data-flag="new-checkout"]')).toBeVisible();
  await checkPage(page, 'flags');

  await page.getByRole('button', { name: 'New flag' }).click();
  await expect(page.getByRole('heading', { name: 'New flag' })).toBeVisible();
  await checkPage(page, 'flags with the new flag form');

  await page.goto('/flags/search-ranking');
  await expect(page.getByRole('heading', { name: 'Targeting in development' })).toBeVisible();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.locator('input[name="fallthrough-mode"][value="rollout"]').check();
  await expect(page.getByLabel('Exact % for Semantic')).toBeVisible();
  await checkPage(page, 'flag editor with a rule and a rollout');

  await page.goto('/flags/payments-provider-b');
  await expect(page.getByRole('button', { name: 'Turn kill switch off' })).toBeVisible();
  await checkPage(page, 'flag editor with the kill switch on');

  await page.goto('/environments');
  await expect(page.getByRole('heading', { name: 'API keys for development' })).toBeVisible();
  await checkPage(page, 'environments and API keys');

  // A webhook with its delivery log open, so the log table is checked too.
  const hook = await page.request.post('/api/v1/projects/demo-shop/webhooks', {
    data: { name: `a11y ${test.info().project.name}`, url: 'http://127.0.0.1:9/a11y', events: ['flag.schedule.cancelled'] },
  });
  expect(hook.status()).toBe(201);
  await page.goto('/webhooks');
  await expect(page.getByRole('heading', { name: 'New webhook' })).toBeVisible();
  await page.getByRole('button', { name: `Delivery log of a11y ${test.info().project.name}` }).click();
  await expect(page.getByRole('table', { name: `Deliveries of a11y ${test.info().project.name}` })).toBeVisible();
  await checkPage(page, 'webhooks with a delivery log');

  await page.goto('/audit');
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await page.locator('details summary').first().click();
  await expect(page.locator('details[open] table').first()).toBeVisible();
  await checkPage(page, 'audit log with a diff open');

  await page.goto('/users');
  await expect(page.getByRole('heading', { name: 'Console users' })).toBeVisible();
  await checkPage(page, 'users');
});
