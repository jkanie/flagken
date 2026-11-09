import { Controller, Get, Header, Headers, Inject, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { Registry } from '@prometheus-io/client';
import { Public } from '../auth/decorators.js';
import { bearerToken } from '../auth/api-keys.js';
import { CONFIG } from '../config.js';
import type { Config } from '../config.js';
import { MetricsService } from './metrics.service.js';

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** Prometheus text format. With METRICS_TOKEN set, the scraper must send it as a bearer token. */
  @Get()
  @Public()
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', Registry.PROMETHEUS_CONTENT_TYPE)
  async scrape(@Headers('authorization') authorization: string | undefined): Promise<string> {
    const expected = this.config.metricsToken;
    if (expected) {
      const given = Buffer.from(bearerToken(authorization) ?? '');
      const want = Buffer.from(expected);
      if (given.length !== want.length || !timingSafeEqual(given, want)) throw new UnauthorizedException();
    }
    return this.metrics.registry.metrics();
  }
}
