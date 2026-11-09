import { AsyncLocalStorage } from 'node:async_hooks';
import type { JsonValue } from '@flagken/shared';

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

const storage = new AsyncLocalStorage<AuditRecord[]>();

export const AuditContext = {
  run<T>(fn: () => T): T {
    return storage.run([], fn);
  },
  /** Adds a record to the current request. Outside a request (a background job) it returns false. */
  record(entry: AuditRecord): boolean {
    const store = storage.getStore();
    if (!store) return false;
    store.push(entry);
    return true;
  },
  current(): AuditRecord[] {
    return storage.getStore() ?? [];
  },
};
