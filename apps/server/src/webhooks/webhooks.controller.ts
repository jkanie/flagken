import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiAcceptedResponse, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { MinRole } from '../auth/decorators.js';
import { CreateWebhookDto, CreatedWebhookDto, UpdateWebhookDto, WebhookDeliveryDto, WebhookDto, WebhookTestDto } from '../common/dto.js';
import { KeyPipe } from '../common/keys.js';
import type { FlagkenRequest } from '../common/request.js';
import { WebhooksService } from './webhooks.service.js';

@ApiTags('webhooks')
@Controller('api/v1/projects/:project/webhooks')
@MinRole('owner')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @ApiOkResponse({ type: [WebhookDto] })
  list(@Param('project', KeyPipe) project: string): Promise<WebhookDto[]> {
    return this.webhooks.list(project);
  }

  @Post()
  @ApiCreatedResponse({ type: CreatedWebhookDto })
  create(@Param('project', KeyPipe) project: string, @Body() body: CreateWebhookDto): Promise<CreatedWebhookDto> {
    return this.webhooks.create(project, body);
  }

  @Put(':id')
  @ApiOkResponse({ type: WebhookDto })
  update(
    @Param('project', KeyPipe) project: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateWebhookDto,
  ): Promise<WebhookDto> {
    return this.webhooks.update(project, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(@Param('project', KeyPipe) project: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.webhooks.remove(project, id);
  }

  @Get(':id/deliveries')
  @ApiOkResponse({ type: [WebhookDeliveryDto] })
  deliveries(@Param('project', KeyPipe) project: string, @Param('id', ParseUUIDPipe) id: string): Promise<WebhookDeliveryDto[]> {
    return this.webhooks.deliveries(project, id);
  }

  @Post(':id/test')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: WebhookTestDto })
  test(
    @Param('project', KeyPipe) project: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FlagkenRequest,
  ): Promise<WebhookTestDto> {
    return this.webhooks.test(project, id, request.user!.email);
  }
}
