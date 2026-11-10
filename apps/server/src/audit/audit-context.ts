import { AsyncLocalStorage } from 'node:async_hooks';
import type { JsonValue } from '@flagken/shared';
import type { Actor } from './audit.service.js';

/** 1 change a request made. Services record these, the audit interceptor writes them. */
export interface AuditRecord {
  action: string;
  projectId: string | null;
  projectKey: string | null;
  environmentKey: string | null;
  resourceType: string;
  resourceKey: string;
  before: JsonValue | null;
  after: JsonValue | null;
}

/** Who made the request, for services that write their audit entry inside their own transaction. */
export interface AuditMeta {
  actor: Actor;
  requestId: string | null;
}

interface Store {
  records: AuditRecord[];
  meta: AuditMeta | null;
}

const storage = new AsyncLocalStorage<Store>();

export const AuditContext = {
  run<T>(fn: () => T, meta: AuditMeta | null = null): T {
    return storage.run({ records: [], meta }, fn);
  },
  /** Adds a record to the current request. Outside a request (a background job) it returns false. */
  record(entry: AuditRecord): boolean {
    const store = storage.getStore();
    if (!store) return false;
    store.records.push(entry);
    return true;
  },
  current(): AuditRecord[] {
    return storage.getStore()?.records ?? [];
  },
  /** The actor and request id of the current request, or null outside a request. */
  meta(): AuditMeta | null {
    return storage.getStore()?.meta ?? null;
  },
};
