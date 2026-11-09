/**
 * Loaded with `node --import ./dist/instrument.js` before the app, so instrumentation can patch modules as they load.
 * Starts tracing only when an OTLP endpoint is set.
 */
import { register } from 'node:module';
import { createTracing, tracesEndpoint } from './tracing.js';

if (tracesEndpoint(process.env)) {
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
  const sdk = createTracing(process.env);
  sdk?.start();
  const stop = () => void sdk?.shutdown();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
