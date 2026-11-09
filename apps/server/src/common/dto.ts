import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { API_KEY_KINDS, CLAUSE_OPS, FLAG_KINDS, KEY_PATTERN, ROLES } from '@flagken/shared';
import type { ApiKeyKind, Clause, ClauseOp, ClauseValue, FlagKind, JsonValue, Role, Rule, Serve, Target, Variation } from '@flagken/shared';
import { MIN_PASSWORD_LENGTH } from '../auth/passwords.js';

const ANY_JSON = {
  description: 'Any JSON value.',
  oneOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'object', additionalProperties: true },
    { type: 'array', items: {} },
  ],
  nullable: true,
};

/* ---------- flag building blocks (documentation models, checked by @flagken/shared at run time) ---------- */

export class VariationDto implements Variation {
  @ApiProperty(ANY_JSON) value: JsonValue;
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional() description?: string;
}

export class ClauseDto implements Clause {
  @ApiProperty({ example: 'country' }) attribute: string;
  @ApiProperty({ enum: CLAUSE_OPS, enumName: 'ClauseOp' }) op: ClauseOp;
  @ApiProperty({ type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] } })
  values: ClauseValue[];
  @ApiPropertyOptional() negate?: boolean;
}

export class WeightedVariationDto {
  @ApiProperty({ type: 'integer' }) variation: number;
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 10_000, description: 'Share of 10,000 buckets.' }) weight: number;
}

export class RolloutDto {
  @ApiProperty({ type: [WeightedVariationDto] }) variations: WeightedVariationDto[];
  @ApiPropertyOptional({ description: 'Context attribute to bucket by. Defaults to key.' }) bucketBy?: string;
}

export class ServeVariationDto {
  @ApiProperty({ type: 'integer' }) variation: number;
}

export class ServeRolloutDto {
  @ApiProperty({ type: RolloutDto }) rollout: RolloutDto;
}

const SERVE_SCHEMA = { oneOf: [{ $ref: getSchemaPath(ServeVariationDto) }, { $ref: getSchemaPath(ServeRolloutDto) }] };

@ApiExtraModels(ServeVariationDto, ServeRolloutDto)
export class RuleDto implements Rule {
  @ApiProperty() id: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ type: [ClauseDto] }) clauses: ClauseDto[];
  @ApiProperty(SERVE_SCHEMA) serve: Serve;
}

export class TargetDto implements Target {
  @ApiProperty({ type: 'integer' }) variation: number;
  @ApiProperty({ type: [String] }) values: string[];
}

/* ---------- auth and users ---------- */

export class LoginDto {
  @ApiProperty({ example: 'owner@example.com' }) @IsEmail() @MaxLength(254) email: string;
  @ApiProperty() @IsString() @MaxLength(1024) password: string;
}

export class MeDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty({ enum: ROLES, enumName: 'Role' }) role: Role;
}

export class UserDto extends MeDto {
  @ApiProperty() createdAt: string;
  @ApiProperty() disabled: boolean;
}

export class CreateUserDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH }) @IsString() @MinLength(MIN_PASSWORD_LENGTH) @MaxLength(1024) password: string;
  @ApiProperty({ enum: ROLES, enumName: 'Role' }) @IsIn(ROLES) role: Role;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: ROLES, enumName: 'Role' }) @IsOptional() @IsIn(ROLES) role?: Role;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() disabled?: boolean;
}

/* ---------- projects, environments, API keys ---------- */

export class EnvironmentDto {
  @ApiProperty() key: string;
  @ApiProperty() name: string;
}

export class ProjectDto {
  @ApiProperty() key: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: [EnvironmentDto] }) environments: EnvironmentDto[];
}

export class CreateProjectDto {
  @ApiProperty({ pattern: KEY_PATTERN.source }) @Matches(KEY_PATTERN) key: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name: string;
}

export class CreateEnvironmentDto extends CreateProjectDto {}

export class ApiKeyDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: API_KEY_KINDS, enumName: 'ApiKeyKind' }) kind: ApiKeyKind;
  @ApiProperty({ description: 'First characters of the key.' }) prefix: string;
  @ApiProperty() createdAt: string;
  @ApiProperty({ nullable: true, type: String }) revokedAt: string | null;
}

export class CreatedApiKeyDto extends ApiKeyDto {
  @ApiProperty({ description: 'The whole key. Shown once, never stored.' }) key: string;
}

export class CreateApiKeyDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name: string;
  @ApiProperty({ enum: API_KEY_KINDS, enumName: 'ApiKeyKind' }) @IsIn(API_KEY_KINDS) kind: ApiKeyKind;
}

/* ---------- flags ---------- */

export class FlagDto {
  @ApiProperty() key: string;
  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiProperty({ enum: FLAG_KINDS, enumName: 'FlagKind' }) kind: FlagKind;
  @ApiProperty({ type: [VariationDto] }) variations: VariationDto[];
  @ApiProperty({ type: [String] }) tags: string[];
  @ApiProperty({ type: 'integer' }) version: number;
  @ApiProperty() archived: boolean;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}

export class FlagStateSummaryDto {
  @ApiProperty() on: boolean;
  @ApiProperty() killed: boolean;
  @ApiProperty({ type: 'integer' }) version: number;
  @ApiProperty({ type: 'integer' }) rules: number;
}

export class FlagListItemDto extends FlagDto {
  @ApiProperty({ type: FlagStateSummaryDto }) state: FlagStateSummaryDto;
}

export class CreateFlagDto {
  @ApiProperty({ pattern: KEY_PATTERN.source }) @Matches(KEY_PATTERN) key: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiProperty({ enum: FLAG_KINDS, enumName: 'FlagKind' }) @IsIn(FLAG_KINDS) kind: FlagKind;
  @ApiProperty({ type: [VariationDto] }) @IsArray() @ArrayMaxSize(20) @IsObject({ each: true }) variations: VariationDto[];
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
}

export class UpdateFlagDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name: string;
  @ApiProperty() @IsString() @MaxLength(1000) description: string;
  @ApiProperty({ type: [VariationDto] }) @IsArray() @ArrayMaxSize(20) @IsObject({ each: true }) variations: VariationDto[];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags: string[];
}

@ApiExtraModels(ServeVariationDto, ServeRolloutDto)
export class FlagStateDto {
  @ApiProperty() environment: string;
  @ApiProperty() on: boolean;
  @ApiProperty() killed: boolean;
  @ApiProperty({ type: 'integer' }) offVariation: number;
  @ApiProperty(SERVE_SCHEMA) fallthrough: Serve;
  @ApiProperty({ type: [TargetDto] }) targets: TargetDto[];
  @ApiProperty({ type: [RuleDto] }) rules: RuleDto[];
  @ApiProperty({ type: 'integer' }) version: number;
  @ApiProperty() updatedAt: string;
}

@ApiExtraModels(ServeVariationDto, ServeRolloutDto)
export class UpdateFlagStateDto {
  @ApiProperty() @IsBoolean() on: boolean;
  @ApiProperty({ type: 'integer' }) @IsInt() offVariation: number;
  @ApiProperty(SERVE_SCHEMA) @IsObject() fallthrough: Serve;
  @ApiProperty({ type: [TargetDto] }) @IsArray() targets: TargetDto[];
  @ApiProperty({ type: [RuleDto] }) @IsArray() rules: RuleDto[];
}

export class KillDto {
  @ApiProperty() @IsBoolean() killed: boolean;
}

/* ---------- scheduled changes ---------- */

@ApiExtraModels(ServeVariationDto, ServeRolloutDto)
export class ScheduledChangeBodyDto {
  @ApiPropertyOptional() on?: boolean;
  @ApiPropertyOptional(SERVE_SCHEMA) fallthrough?: Serve;
}

export class CreateScheduleDto {
  @ApiProperty({ format: 'date-time' }) @IsDateString() runAt: string;
  @ApiProperty({ type: ScheduledChangeBodyDto }) @IsObject() change: ScheduledChangeBodyDto;
}

export class ScheduledChangeDto {
  @ApiProperty() id: string;
  @ApiProperty() environment: string;
  @ApiProperty({ format: 'date-time' }) runAt: string;
  @ApiProperty({ type: ScheduledChangeBodyDto }) change: ScheduledChangeBodyDto;
  @ApiProperty({ enum: ['pending', 'done', 'failed', 'cancelled'] }) status: 'pending' | 'done' | 'failed' | 'cancelled';
  @ApiProperty({ nullable: true, type: String }) executedAt: string | null;
  @ApiProperty({ nullable: true, type: String }) error: string | null;
}

/* ---------- webhooks ---------- */

export const WEBHOOK_EVENTS = [
  '*',
  'flag.created',
  'flag.updated',
  'flag.archived',
  'flag.state.updated',
  'flag.killed',
  'flag.unkilled',
  'flag.schedule.created',
  'flag.schedule.cancelled',
  'flag.schedule.executed',
] as const;

export class WebhookDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() url: string;
  @ApiProperty({ type: [String], enum: WEBHOOK_EVENTS }) events: string[];
  @ApiProperty() active: boolean;
  @ApiProperty() createdAt: string;
}

export class CreatedWebhookDto extends WebhookDto {
  @ApiProperty({ description: 'HMAC-SHA256 signing secret. Shown once.' }) secret: string;
}

export class CreateWebhookDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name: string;
  @ApiProperty({ example: 'https://hooks.example.com/flagken' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(2000)
  url: string;
  @ApiProperty({ type: [String], enum: WEBHOOK_EVENTS })
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events: string[];
}

export class UpdateWebhookDto extends CreateWebhookDto {
  @ApiProperty() @IsBoolean() active: boolean;
}

export class WebhookDeliveryDto {
  @ApiProperty() id: string;
  @ApiProperty() eventId: string;
  @ApiProperty() eventType: string;
  @ApiProperty({ type: 'integer' }) attempt: number;
  @ApiProperty() ok: boolean;
  @ApiProperty({ nullable: true, type: 'integer' }) statusCode: number | null;
  @ApiProperty({ nullable: true, type: String }) error: string | null;
  @ApiProperty({ type: 'integer' }) durationMs: number;
  @ApiProperty() createdAt: string;
}

export class WebhookTestDto {
  @ApiProperty() eventId: string;
}

/* ---------- audit ---------- */

export class AuditActorDto {
  @ApiProperty({ enum: ['user', 'api_key', 'system'] }) type: 'user' | 'api_key' | 'system';
  @ApiProperty() label: string;
}

export class AuditEntryDto {
  @ApiProperty() id: string;
  @ApiProperty() at: string;
  @ApiProperty({ type: AuditActorDto }) actor: AuditActorDto;
  @ApiProperty() action: string;
  @ApiProperty({ nullable: true, type: String }) environment: string | null;
  @ApiProperty() resourceType: string;
  @ApiProperty() resourceKey: string;
  @ApiProperty({ ...ANY_JSON }) before: JsonValue;
  @ApiProperty({ ...ANY_JSON }) after: JsonValue;
}

/* ---------- SDK ---------- */

@ApiExtraModels(ServeVariationDto, ServeRolloutDto)
export class FlagConfigDto {
  @ApiProperty() key: string;
  @ApiProperty({ enum: FLAG_KINDS, enumName: 'FlagKind' }) kind: FlagKind;
  @ApiProperty({ type: [VariationDto] }) variations: VariationDto[];
  @ApiProperty({ type: 'integer' }) version: number;
  @ApiProperty() on: boolean;
  @ApiProperty() killed: boolean;
  @ApiProperty({ type: 'integer' }) offVariation: number;
  @ApiProperty(SERVE_SCHEMA) fallthrough: Serve;
  @ApiProperty({ type: [TargetDto] }) targets: TargetDto[];
  @ApiProperty({ type: [RuleDto] }) rules: RuleDto[];
}

export class SdkFlagsDto {
  @ApiProperty() environment: string;
  @ApiProperty({ type: [FlagConfigDto] }) flags: FlagConfigDto[];
}

export class EvalReasonDto {
  @ApiProperty({ enum: ['OFF', 'KILLED', 'TARGET_MATCH', 'RULE_MATCH', 'FALLTHROUGH', 'ERROR'] })
  kind: 'OFF' | 'KILLED' | 'TARGET_MATCH' | 'RULE_MATCH' | 'FALLTHROUGH' | 'ERROR';
  @ApiPropertyOptional() ruleId?: string;
  @ApiPropertyOptional({ type: 'integer' }) ruleIndex?: number;
  @ApiPropertyOptional({ type: 'integer' }) bucket?: number;
  @ApiPropertyOptional({ enum: ['FLAG_NOT_FOUND', 'MALFORMED_FLAG'] }) errorKind?: 'FLAG_NOT_FOUND' | 'MALFORMED_FLAG';
}

export class EvaluatedFlagDto {
  @ApiProperty() key: string;
  @ApiProperty(ANY_JSON) value: JsonValue;
  @ApiProperty({ nullable: true, type: 'integer' }) variation: number | null;
  @ApiProperty({ type: 'integer' }) version: number;
  @ApiProperty({ type: EvalReasonDto }) reason: EvalReasonDto;
}

export class SdkEvaluationDto {
  @ApiProperty() environment: string;
  @ApiProperty({ type: [EvaluatedFlagDto] }) flags: EvaluatedFlagDto[];
}

export class EvalContextDto {
  @ApiProperty({ description: 'Opaque id for the user or device. Never a name or e-mail address.', example: 'u_7f3a9c' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  key: string;
  @ApiPropertyOptional({
    description: 'Attributes rules can match on.',
    type: 'object',
    additionalProperties: true,
    example: { country: 'CA', plan: 'beta' },
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}
