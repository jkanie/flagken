import createClient from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type { components, paths };
export type Schemas = components['schemas'];
export type FlagDto = Schemas['FlagDto'];
export type FlagListItemDto = Schemas['FlagListItemDto'];
export type FlagStateDto = Schemas['FlagStateDto'];
export type UpdateFlagStateDto = Schemas['UpdateFlagStateDto'];
export type ProjectDto = Schemas['ProjectDto'];
export type ApiKeyDto = Schemas['ApiKeyDto'];
export type CreatedApiKeyDto = Schemas['CreatedApiKeyDto'];
export type WebhookDto = Schemas['WebhookDto'];
export type CreatedWebhookDto = Schemas['CreatedWebhookDto'];
export type WebhookDeliveryDto = Schemas['WebhookDeliveryDto'];
export type AuditEntryDto = Schemas['AuditEntryDto'];
export type ScheduledChangeDto = Schemas['ScheduledChangeDto'];
export type MeDto = Schemas['MeDto'];
export type UserDto = Schemas['UserDto'];
export type SdkFlagsDto = Schemas['SdkFlagsDto'];
export type SdkEvaluationDto = Schemas['SdkEvaluationDto'];
export type EvaluatedFlagDto = Schemas['EvaluatedFlagDto'];
export type FlagConfigDto = Schemas['FlagConfigDto'];

export interface ApiClientOptions {
  /** Server origin, for example https://flags.example.com. Leave empty in the console, which calls its own origin. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
}

/** Typed client for the flagken HTTP API. Every path, body, response type comes from the OpenAPI document. */
export function createApiClient(options: ApiClientOptions = {}) {
  return createClient<paths>({
    baseUrl: options.baseUrl ?? '',
    credentials: 'same-origin',
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Reads the error message of a failed call: Nest sends { message: string | string[] }. */
export function errorMessage(error: unknown, fallback = 'request failed'): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string') return message;
  }
  return fallback;
}
