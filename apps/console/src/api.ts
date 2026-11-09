import { createApiClient, errorMessage } from '@flagken/api-client';

/** The console calls its own origin: the Vite proxy in development, the server itself in production. */
export const api = createApiClient();

export { errorMessage };

/** The error text of a failed call, or null when it worked. Works for routes that document no error body. */
export function failureOf(result: { response: Response; error?: unknown }): string | null {
  return result.response.ok ? null : errorMessage(result.error, `request failed (${result.response.status})`);
}

/** Saved per browser only: the last project and environment. Storage can be blocked, so every access is guarded. */
export const prefs = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`flagken:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`flagken:${key}`, value);
    } catch {
      // Private window or blocked storage: the choice lasts for this visit only.
    }
  },
};
