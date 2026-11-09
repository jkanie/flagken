import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createApiClient, errorMessage } from '../src/index.js';

describe('createApiClient', () => {
  it('builds typed requests: path parameters, query, If-Match header, JSON body', async () => {
    const requests: Request[] = [];
    const api = createApiClient({
      baseUrl: 'https://flags.example.com',
      fetch: async (input) => {
        requests.push(input as Request);
        return Response.json({ environment: 'production', on: true }, { headers: { etag: '"v4"' } });
      },
    });
    const list = await api.GET('/api/v1/projects/{project}/flags', {
      params: { path: { project: 'demo-shop' }, query: { environment: 'production', q: 'check out' } },
    });
    expect(list.response.ok).toBe(true);
    expect(requests[0]!.url).toBe('https://flags.example.com/api/v1/projects/demo-shop/flags?environment=production&q=check%20out');

    const saved = await api.PUT('/api/v1/projects/{project}/flags/{flag}/environments/{environment}', {
      params: { path: { project: 'demo-shop', flag: 'new-checkout', environment: 'production' }, header: { 'If-Match': '"v3"' } },
      body: { on: true, offVariation: 0, fallthrough: { variation: 1 }, targets: [], rules: [] },
    });
    expect(saved.response.headers.get('etag')).toBe('"v4"');
    expect(requests[1]!.method).toBe('PUT');
    expect(requests[1]!.headers.get('if-match')).toBe('"v3"');
    expect(await requests[1]!.json()).toEqual({ on: true, offVariation: 0, fallthrough: { variation: 1 }, targets: [], rules: [] });
  });

  it('sends fixed headers, such as an SDK key', async () => {
    let seen: Request | undefined;
    const api = createApiClient({
      baseUrl: 'http://localhost:3000',
      headers: { authorization: 'Bearer fk_srv_example' },
      fetch: async (input) => {
        seen = input as Request;
        return Response.json({ environment: 'development', flags: [] });
      },
    });
    const { data } = await api.GET('/sdk/v1/flags');
    expect(data).toEqual({ environment: 'development', flags: [] });
    expect(seen!.headers.get('authorization')).toBe('Bearer fk_srv_example');
  });
});

describe('errorMessage', () => {
  it('reads Nest error bodies', () => {
    expect(errorMessage({ message: ['a', 'b'] })).toBe('a, b');
    expect(errorMessage({ message: 'flag changed' })).toBe('flag changed');
    expect(errorMessage(undefined, 'fallback')).toBe('fallback');
  });
});

describe('the committed OpenAPI document', () => {
  it('describes every route the console and SDK use', async () => {
    const document = JSON.parse(await readFile(new URL('../openapi.json', import.meta.url), 'utf8'));
    expect(document.openapi).toMatch(/^3\./);
    for (const path of [
      '/api/v1/auth/login',
      '/api/v1/projects/{project}/flags/{flag}/environments/{environment}',
      '/sdk/v1/stream',
      '/sdk/v1/evaluate',
    ]) {
      expect(Object.keys(document.paths)).toContain(path);
    }
  });
});
