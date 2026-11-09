import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { verifyWebhookSignature } from '@flagken/sdk';
import { signIn } from './users';

test('a webhook made in the console delivers a signed event and logs it', async ({ page }) => {
  const received: Array<{ body: string; signature: string }> = [];
  const receiver = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      received.push({ body, signature: String(request.headers['flagken-signature']) });
      response.end('ok');
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const port = (receiver.address() as AddressInfo).port;
  try {
    await signIn(page);
    await page.getByRole('link', { name: 'Webhooks' }).click();
    await page.getByLabel('Name', { exact: true }).fill('e2e receiver');
    await page.getByLabel('URL').fill(`http://127.0.0.1:${port}/hook`);
    await page.getByRole('button', { name: 'Add webhook' }).click();
    const secret = (await page.getByTestId('webhook-secret').textContent())!.trim();
    expect(secret).toMatch(/^whsec_/);

    await page.getByRole('button', { name: 'Send test to e2e receiver' }).click();
    const hook = page.locator('[data-webhook="e2e receiver"]');
    await expect(hook.locator('[data-delivery="ok"]').first()).toContainText('webhook.test');
    expect(received).toHaveLength(1);
    expect(await verifyWebhookSignature({ secret, body: received[0]!.body, header: received[0]!.signature })).toBe(true);

    // A flag change sends a subscribed event too (flag.killed is on by default in the form).
    await page.goto('/flags/holiday-banner');
    await page.getByRole('button', { name: 'Kill this flag' }).click();
    await expect.poll(() => received.map((r) => JSON.parse(r.body).type)).toContain('flag.killed');
    const event = JSON.parse(received.find((r) => JSON.parse(r.body).type === 'flag.killed')!.body);
    expect(event).toMatchObject({ project: 'demo-shop', environment: 'development', resource: { key: 'holiday-banner' } });
    await page.getByRole('button', { name: 'Turn kill switch off' }).click();
    await expect(page.getByText('Kill switch off: targeting applies again.')).toBeVisible();
  } finally {
    await new Promise((resolve) => receiver.close(resolve));
  }
});
