import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { MinRole } from '../auth/decorators.js';
import {
  ApiKeyDto,
  CreateApiKeyDto,
  CreateEnvironmentDto,
  CreateProjectDto,
  CreatedApiKeyDto,
  EnvironmentDto,
  ProjectDto,
} from '../common/dto.js';
import { KeyPipe } from '../common/keys.js';
import type { FlagkenRequest } from '../common/request.js';
import { ProjectsService } from './projects.service.js';

@ApiTags('projects')
@Controller('api/v1/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOkResponse({ type: [ProjectDto] })
  list(): Promise<ProjectDto[]> {
    return this.projects.list();
  }

  @Post()
  @MinRole('owner')
  @ApiCreatedResponse({ type: ProjectDto })
  create(@Body() body: CreateProjectDto): Promise<ProjectDto> {
    return this.projects.create(body.key, body.name);
  }

  @Post(':project/environments')
  @MinRole('owner')
  @ApiCreatedResponse({ type: EnvironmentDto })
  createEnvironment(@Param('project', KeyPipe) project: string, @Body() body: CreateEnvironmentDto): Promise<EnvironmentDto> {
    return this.projects.createEnvironment(project, body.key, body.name);
  }

  @Get(':project/environments/:environment/api-keys')
  @MinRole('owner')
  @ApiOkResponse({ type: [ApiKeyDto] })
  listApiKeys(@Param('project', KeyPipe) project: string, @Param('environment', KeyPipe) environment: string): Promise<ApiKeyDto[]> {
    return this.projects.listApiKeys(project, environment);
  }

  @Post(':project/environments/:environment/api-keys')
  @MinRole('owner')
  @ApiCreatedResponse({ type: CreatedApiKeyDto })
  createApiKey(
    @Param('project', KeyPipe) project: string,
    @Param('environment', KeyPipe) environment: string,
    @Body() body: CreateApiKeyDto,
    @Req() request: FlagkenRequest,
  ): Promise<CreatedApiKeyDto> {
    return this.projects.createApiKey(project, environment, body.name, body.kind, request.user?.id ?? null);
  }

  @Delete(':project/environments/:environment/api-keys/:id')
  @MinRole('owner')
  @HttpCode(204)
  @ApiNoContentResponse()
  revokeApiKey(
    @Param('project', KeyPipe) project: string,
    @Param('environment', KeyPipe) environment: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.projects.revokeApiKey(project, environment, id);
  }
}
