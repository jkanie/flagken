import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { MinRole } from '../auth/decorators.js';
import { CreateScheduleDto, ScheduledChangeDto } from '../common/dto.js';
import { KeyPipe } from '../common/keys.js';
import type { FlagkenRequest } from '../common/request.js';
import { SchedulesService } from './schedules.service.js';

@ApiTags('scheduled changes')
@Controller('api/v1/projects/:project/flags/:flag/environments/:environment/schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  @ApiOkResponse({ type: [ScheduledChangeDto] })
  list(
    @Param('project', KeyPipe) project: string,
    @Param('flag', KeyPipe) flag: string,
    @Param('environment', KeyPipe) environment: string,
  ): Promise<ScheduledChangeDto[]> {
    return this.schedules.list(project, flag, environment);
  }

  @Post()
  @MinRole('editor')
  @ApiCreatedResponse({ type: ScheduledChangeDto })
  create(
    @Param('project', KeyPipe) project: string,
    @Param('flag', KeyPipe) flag: string,
    @Param('environment', KeyPipe) environment: string,
    @Body() body: CreateScheduleDto,
    @Req() request: FlagkenRequest,
  ): Promise<ScheduledChangeDto> {
    return this.schedules.create(project, flag, environment, body.runAt, body.change, request.user?.id ?? null);
  }

  @Delete(':id')
  @MinRole('editor')
  @HttpCode(204)
  @ApiNoContentResponse()
  cancel(
    @Param('project', KeyPipe) project: string,
    @Param('flag', KeyPipe) flag: string,
    @Param('environment', KeyPipe) environment: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.schedules.cancel(project, flag, environment, id);
  }
}
