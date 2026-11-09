import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

// Made-up accounts for the end-to-end tests only.
export const OWNER = { email: 'owner@example.com', password: 'made-up-e2e-password' };
export const EDITOR = { email: 'editor@example.com', password: 'made-up-e2e-password' };

export async function signIn(page: Page, user = OWNER): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Flags', level: 1 })).toBeVisible();
}

/** Makes sure the editor account exists (idempotent), using the owner's API session. */
export async function ensureEditor(request: APIRequestContext): Promise<void> {
  const login = await request.post('/api/v1/auth/login', { data: OWNER });
  expect(login.ok()).toBe(true);
  const created = await request.post('/api/v1/users', { data: { ...EDITOR, role: 'editor' } });
  expect([201, 409]).toContain(created.status());
}

/** Reads a flag state and saves a change with its ETag, as a second user would. */
export async function changeState(request: APIRequestContext, path: string, change: Record<string, unknown>, user = OWNER) {
  expect((await request.post('/api/v1/auth/login', { data: user })).ok()).toBe(true);
  const current = await request.get(path);
  const { environment: _e, killed: _k, version: _v, updatedAt: _u, ...body } = await current.json();
  const saved = await request.put(path, { data: { ...body, ...change }, headers: { 'if-match': current.headers().etag! } });
  expect(saved.status()).toBe(200);
}
