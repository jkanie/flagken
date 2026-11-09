import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trace } from '@opentelemetry/api';
import { createTracing, tracesEndpoint } from '../../src/tracing.js';

describe('tracing settings', () => {
  it('starts nothing without an endpoint, so no data leaves the server', () => {
    expect(tracesEndpoint({})).toBeUndefined();
    expect(createTracing({})).toBeUndefined();
    // With no SDK the global tracer makes spans that record nothing.
    const span = trace.getTracer('test').startSpan('nothing');
    expect(span.isRecording()).toBe(false);
    span.end();
  });

  it('builds the traces URL from either variable', () => {
    expect(tracesEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318/' })).toBe('http://collector:4318/v1/traces');
    expect(tracesEndpoint({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://c:4318/custom', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://x' })).toBe(
      'http://c:4318/custom',
    );
  });
});

describe('OTLP export', () => {
  let collector: http.Server;
  const received: Array<{ url: string; body: string }> = [];
  let endpoint: string;

  beforeAll(async () => {
    collector = http.createServer((request, response) => {
      let body = '';
      request.on('data', (c) => (body += c));
      request.on('end', () => {
        received.push({ url: request.url ?? '', body });
        response.end('{}');
      });
    });
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(collector.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((resolve) => collector.close(resolve)));

  it('sends spans to the configured OTLP/HTTP endpoint', async () => {
    const sdk = createTracing({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_SERVICE_NAME: 'flagken-test' })!;
    sdk.start();
    const span = trace.getTracer('flagken-test').startSpan('flag.evaluate');
    expect(span.isRecording()).toBe(true);
    span.end();
    await sdk.shutdown();
    expect(received.length).toBeGreaterThan(0);
    // Only traces leave: no OTLP metrics or logs.
    expect(new Set(received.map((r) => r.url))).toEqual(new Set(['/v1/traces']));
    const all = received.map((r) => r.body).join('');
    expect(all).toContain('flag.evaluate');
    expect(all).toContain('flagken-test');
  });
});
