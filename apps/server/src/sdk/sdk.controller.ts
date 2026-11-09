import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Req, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import type { EvalContext } from '@flagken/shared';
import { SdkKey } from '../auth/decorators.js';
import { CONFIG } from '../config.js';
import type { Config } from '../config.js';
import { EvalContextDto, SdkEvaluationDto, SdkFlagsDto } from '../common/dto.js';
import type { FlagkenRequest } from '../common/request.js';
import { FlagsService } from '../flags/flags.service.js';
import { LiveService } from '../live/live.service.js';
import { contextFromHeader, toContext } from './context.js';

@ApiTags('sdk')
@ApiBearerAuth('apiKey')
@Controller('sdk/v1')
export class SdkController {
  constructor(
    private readonly flags: FlagsService,
    private readonly live: LiveService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** Server keys: every flag with its rules, for local evaluation. */
  @Get('flags')
  @SdkKey('server')
  @ApiOkResponse({ type: SdkFlagsDto })
  async all(@Req() request: FlagkenRequest): Promise<SdkFlagsDto> {
    const key = request.apiKey!;
    const configs = (await this.flags.configsFor(key.environmentId)).map(({ archived: _a, ...rest }) => rest);
    return { environment: key.environmentKey, flags: configs };
  }

  /** Client keys: values for 1 context. Rules stay on the server. */
  @Post('evaluate')
  @HttpCode(200)
  @SdkKey('client')
  @ApiOkResponse({ type: SdkEvaluationDto })
  async evaluate(@Req() request: FlagkenRequest, @Body() body: EvalContextDto): Promise<SdkEvaluationDto> {
    const key = request.apiKey!;
    const context = toContext(body);
    const configs = (await this.flags.configsFor(key.environmentId)).map(({ archived: _a, ...rest }) => rest);
    return { environment: key.environmentKey, flags: configs.map((c) => this.live.evaluate(key, c, context)) };
  }

  /**
   * Server-Sent Events. Events: put (all flags), patch (1 flag), delete (archived flag), ping (heartbeat).
   * Server keys get flag rules, client keys get values for the context in X-Flagken-Context.
   */
  @Sse('stream')
  @SdkKey('server', 'client')
  @ApiProduces('text/event-stream')
  @ApiHeader({ name: 'X-Flagken-Context', required: false, description: 'Client keys: base64url JSON of { key, attributes }.' })
  @ApiOkResponse({ description: 'An event stream.' })
  stream(@Req() request: FlagkenRequest, @Headers('x-flagken-context') header: string | undefined): Observable<MessageEvent> {
    const key = request.apiKey!;
    const context: EvalContext | undefined = key.kind === 'client' ? contextFromHeader(header) : undefined;
    return new Observable<MessageEvent>((subscriber) => {
      const connection = this.live.openStream(
        key,
        context,
        (event) => subscriber.next({ type: event.type, data: event.data as object }),
        () => subscriber.complete(),
      );
      const heartbeat = setInterval(() => subscriber.next({ type: 'ping', data: {} }), this.config.sseHeartbeatMs);
      this.live.initialPut(connection).catch((error: unknown) => subscriber.error(error));
      return () => {
        clearInterval(heartbeat);
        this.live.closeStream(connection);
      };
    });
  }
}
