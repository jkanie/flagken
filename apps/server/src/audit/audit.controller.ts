import { Controller, Get, Param, ParseIntPipe, DefaultValuePipe, Query, BadRequestException } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { JsonValue } from '@flagken/shared';
import { AuditEntryDto } from '../common/dto.js';
import { KeyPipe } from '../common/keys.js';
import { ProjectsService } from '../projects/projects.service.js';
import { AuditService } from './audit.service.js';

@ApiTags('audit')
@Controller('api/v1/projects/:project/audit')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
  ) {}

  @Get()
  @ApiOkResponse({ type: [AuditEntryDto] })
  @ApiQuery({ name: 'environment', required: false })
  @ApiQuery({ name: 'flag', required: false })
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
  @ApiQuery({ name: 'before', required: false, description: 'Entry id: list entries older than this one.' })
  async list(
    @Param('project', KeyPipe) projectKey: string,
    @Query('environment') environment: string | undefined,
    @Query('flag') flag: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('before') before: string | undefined,
  ): Promise<AuditEntryDto[]> {
    if (limit < 1 || limit > 200) throw new BadRequestException('limit must be from 1 to 200');
    if (before !== undefined && !/^\d{1,18}$/.test(before)) throw new BadRequestException('before must be an entry id');
    const project = await this.projects.getProject(projectKey);
    const rows = await this.audit.list(project.id, {
      limit,
      ...(environment ? { environment } : {}),
      ...(flag ? { flag } : {}),
      ...(before ? { before } : {}),
    });
    return rows.map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      actor: { type: row.actorType, label: row.actorLabel },
      action: row.action,
      environment: row.environmentKey,
      resourceType: row.resourceType,
      resourceKey: row.resourceKey,
      before: row.before as JsonValue,
      after: row.after as JsonValue,
    }));
  }
}
