import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Kysely } from 'kysely';
import { DB } from '../db/database.js';
import type { Database } from '../db/schema.js';
import { CreateUserDto, LoginDto, MeDto, UpdateUserDto, UserDto } from '../common/dto.js';
import type { FlagkenRequest } from '../common/request.js';
import { LoginThrottle, MinRole, Public } from './decorators.js';
import { dummyHash, verifyPassword } from './passwords.js';
import { SESSION_COOKIE, SessionService } from './session.js';
import { UsersService } from './users.service.js';

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly sessions: SessionService,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  @LoginThrottle()
  @ApiOkResponse({ type: MeDto })
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response): Promise<MeDto> {
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', body.email.trim().toLowerCase())
      .where('disabledAt', 'is', null)
      .executeTakeFirst();
    const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash()), body.password);
    if (!user || !ok) throw new UnauthorizedException('wrong e-mail or password');
    response.cookie(SESSION_COOKIE, await this.sessions.sign(user.id), this.sessions.cookieOptions());
    return { id: user.id, email: user.email, role: user.role };
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  @ApiNoContentResponse()
  logout(@Res({ passthrough: true }) response: Response): void {
    const { maxAge: _maxAge, ...options } = this.sessions.cookieOptions();
    response.clearCookie(SESSION_COOKIE, options);
  }

  @Get('me')
  @ApiOkResponse({ type: MeDto })
  me(@Req() request: FlagkenRequest): MeDto {
    return request.user!;
  }
}

@ApiTags('users')
@Controller('api/v1/users')
@MinRole('owner')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOkResponse({ type: [UserDto] })
  list(): Promise<UserDto[]> {
    return this.users.list();
  }

  @Post()
  @ApiCreatedResponse({ type: UserDto })
  create(@Body() body: CreateUserDto): Promise<UserDto> {
    return this.users.create(body.email, body.password, body.role);
  }

  @Patch(':id')
  @ApiOkResponse({ type: UserDto })
  update(@Req() request: FlagkenRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateUserDto): Promise<UserDto> {
    return this.users.update(request.user!.id, id, body);
  }
}
