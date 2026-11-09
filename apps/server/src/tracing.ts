import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';

type Env = Record<string, string | undefined>;

/** The traces URL from OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, or OTEL_EXPORTER_OTLP_ENDPOINT plus /v1/traces. */
export function tracesEndpoint(env: Env): string | undefined {
  const traces = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (traces) return traces;
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (base) return `${base.replace(/\/+$/, '')}/v1/traces`;
  return undefined;
}

/**
 * OpenTelemetry tracing over OTLP/HTTP. Without an endpoint this returns undefined and starts nothing:
 * no exporter, no instrumentation, no data leaves the server.
 */
export function createTracing(env: Env = process.env): NodeSDK | undefined {
  const url = tracesEndpoint(env);
  if (!url) return undefined;
  // Traces only: metrics go to Prometheus at /metrics, so the SDK's own OTLP metrics and logs stay off
  // unless someone sets these variables on purpose.
  process.env.OTEL_METRICS_EXPORTER ??= 'none';
  process.env.OTEL_LOGS_EXPORTER ??= 'none';
  return new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME?.trim() || 'flagken-server',
    traceExporter: new OTLPTraceExporter({ url }),
    instrumentations: [
      new HttpInstrumentation({
        // Health probes and Prometheus scrapes would fill the trace store with noise.
        ignoreIncomingRequestHook: (request) => /^\/(health|metrics)/.test(request.url ?? ''),
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
    ],
  });
}
