import { expect, test } from '@playwright/test';
import { FlagkenClient } from '@flagken/sdk';
import { signIn } from './users';

test('a flag changed in the console arrives in an SDK client over SSE', async ({ page, baseURL }) => {
  await signIn(page);

  // Make a client key in the console, as an owner would.
  await page.getByRole('link', { name: 'Environments and keys' }).click();
  const keys = page.getByRole('region', { name: 'API keys for development' });
  await keys.getByLabel('Name').fill('e2e web app');
  await keys.getByLabel('Kind').selectOption('client');
  await page.getByRole('button', { name: 'Create key' }).click();
  const apiKey = (await page.getByTestId('new-key').textContent())!.trim();
  expect(apiKey).toMatch(/^fk_cli_/);

  const sdk = new FlagkenClient({ baseUrl: baseURL!, apiKey, context: { key: 'u_e2e001', country: 'CA' } });
  const seen: string[] = [];
  sdk.on('change', (change) => seen.push(change.key));
  await sdk.start();
  try {
    expect(sdk.status).toBe('live');
    // The seed turns new-checkout on in development with variation 1 (true).
    expect(sdk.variation('new-checkout', false)).toBe(true);

    await page.goto('/flags/new-checkout');
    await page.getByLabel('Targeting on').uncheck();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/Saved\./)).toBeVisible();

    await expect.poll(() => sdk.variation('new-checkout', true), { timeout: 5000 }).toBe(false);
    expect(sdk.variationDetail('new-checkout', true).reason.kind).toBe('OFF');
    expect(seen).toContain('new-checkout');

    await page.getByLabel('Targeting on').check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(() => sdk.variation('new-checkout', false), { timeout: 5000 }).toBe(true);
  } finally {
    await sdk.close();
  }
});
