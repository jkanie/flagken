import type { Request } from 'express';
import type { ApiKeyKind, Role } from '@flagken/shared';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
}

export interface ApiKeyPrincipal {
  id: string;
  kind: ApiKeyKind;
  name: string;
  environmentId: string;
  environmentKey: string;
  projectId: string;
  projectKey: string;
}

export interface FlagkenRequest extends Request {
  user?: SessionUser;
  apiKey?: ApiKeyPrincipal;
  requestId?: string;
}
