import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Registry, collectDefaultMetrics } from '@prometheus-io/client';

/**
 * Prometheus metrics. Each app instance owns its registry, so 2 instances in 1 process (the tests) do not clash.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly evaluations = new Counter({
    name: 'flagken_flag_evaluations_total',
    help: 'Flag evaluations the server made for client keys, by environment, flag and reason.',
    labelNames: ['environment', 'flag', 'reason'] as const,
    registers: [this.registry],
  });

  readonly connectedClients = new Gauge({
    name: 'flagken_connected_clients',
    help: 'Open live connections: sse for SDKs, websocket for the console.',
    labelNames: ['transport'] as const,
    registers: [this.registry],
  });

  readonly webhookDeliveries = new Counter({
    name: 'flagken_webhook_deliveries_total',
    help: 'Webhook delivery attempts by outcome.',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'flagken_' });
    this.connectedClients.set({ transport: 'sse' }, 0);
    this.connectedClients.set({ transport: 'websocket' }, 0);
  }
}
