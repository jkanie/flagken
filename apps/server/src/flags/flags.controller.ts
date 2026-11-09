import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Put, Post, Query, Res } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiPreconditionFailedResponse,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { MinRole } from '../auth/decorators.js';
import { CreateFlagDto, FlagDto, FlagListItemDto, FlagStateDto, KillDto, UpdateFlagDto, UpdateFlagStateDto } from '../common/dto.js';
import { etagFor, expectedVersion } from '../common/etag.js';
import { KeyPipe } from '../common/keys.js';
import { FlagsService } from './flags.service.js';

const IF_MATCH = { name: 'If-Match', required: true, description: 'ETag from your last read. A stale value gets 412.' };

@ApiTags('flags')
@Controller('api/v1/projects/:project/flags')
export class FlagsController {
  constructor(private readonly flags: FlagsService) {}

  @Get()
  @ApiOkResponse({ type: [FlagListItemDto] })
  @ApiQuery({ name: 'environment', required: true })
  @ApiQuery({ name: 'q', required: false, description: 'Search in key, name and description.' })
  list(
    @Param('project', KeyPipe) project: string,
    @Query('environment', KeyPipe) environment: string,
    @Query('q') q: string | undefined,
  ): Promise<FlagListItemDto[]> {
    return this.flags.list(project, environment, q);
  }

  @Post()
  @MinRole('editor')
  @ApiCreatedResponse({ type: FlagDto })
  async create(
    @Param('project', KeyPipe) project: string,
    @Body() body: CreateFlagDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FlagDto> {
    const flag = await this.flags.create(project, body);
    response.setHeader('ETag', etagFor(flag.version));
    return flag;
  }

  @Get(':flag')
  @ApiOkResponse({ type: FlagDto, headers: { ETag: { description: 'Version of the flag.', schema: { type: 'string' } } } })
  async get(
    @Param('project', KeyPipe) project: string,
    @Param('flag', KeyPipe) key: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FlagDto> {
    const flag = await this.flags.get(project, key);
    response.setHeader('ETag', etagFor(flag.version));
    return flag;
  }

  @Put(':flag')
  @MinRole('editor')
  @ApiHeader(IF_MATCH)
  @ApiOkResponse({ type: FlagDto })
  @ApiPreconditionFailedResponse({ description: 'Someone saved a newer version first.' })
  @ApiResponse({ status: 428, description: 'If-Match is missing.' })
  async update(
    @Param('project', KeyPipe) project: string,
    @Param('flag', KeyPipe) key: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdateFlagDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FlagDto> {
    const flag = await this.flags.update(project, key, expectedVersion(ifMatch), body);
    response.setHeader('ETag', etagFor(flag.version));
    return flag;
  }

  @Delete(':flag')
  @MinRole('editor')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The flag is archived. SDKs stop seeing it.' })
  archive(@Param('project', KeyPipe) project: string, @Param('flag', KeyPipe) key: string): Promise<void> {
    return this.flags.archive(project, key);
  }

  @Get(':flag/environments/:environment')
  @ApiOkResponse({ type: FlagStateDto, headers: { ETag: { description: 'Version of this state.', schema: { type: 'string' } } } })
  async getState(
    @Param('project', KeyPipe) project: string,
    @Param('flag', KeyPipe) key: string,
    @Param('environment', KeyPipe) environment: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FlagStateDto> {
    const state = await this.flags.getState(project, key, environment);
    response.setHeader('ETag', etagFor(state.version));
    return state;
  }

  @Put(':flag/environments/:environment')
  @MinRole('editor')
  @ApiHeader(IF_MATCH)
  @ApiOkResponse({ type: FlagStateDto })
  @ApiPreconditionFailedResponse({ description: 'Someone saved a newer version first.' })
  @ApiResponse({ status: 428, description: 'If-Match is missing.' })
  async updateState(
    @Param('project', KeyPipe) project: string,
    @Param('flag', KeyPipe) key: string,
    @Param('environment', KeyPipe) environment: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdateFlagStateDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FlagStateDto> {
    const state = await this.flags.updateState(project, key, environment, expectedVersion(ifMatch), body);
    response.setHeader('ETag', etagFor(state.version));
    return state;
  }

  @Put(':flag/environments/:environment/kill')
  @MinRole('editor')
  @ApiOkResponse({ type: FlagStateDto })
  async kill(
    @Param('project', KeyPipe) project: string,
    @Param('flag', KeyPipe) key: string,
    @Param('environment', KeyPipe) environment: string,
    @Body() body: KillDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FlagStateDto> {
    const state = await this.flags.setKilled(project, key, environment, body.killed);
    response.setHeader('ETag', etagFor(state.version));
    return state;
  }
}
