import type { EvaluatedFlag, FlagConfig } from '@flagken/shared';

/** What the SDK keeps so it can start without the server. */
export interface Snapshot {
  version: 1;
  mode: 'server' | 'client';
  environment: string;
  savedAt: string;
  /** Client mode: a hash of the context the values belong to. The context itself is not stored. */
  contextHash?: string;
  flags: FlagConfig[] | EvaluatedFlag[];
}

export interface SnapshotStore {
  load(): Promise<Snapshot | undefined>;
  save(snapshot: Snapshot): Promise<void>;
}

export function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<Snapshot>;
  return s.version === 1 && (s.mode === 'server' || s.mode === 'client') && typeof s.environment === 'string' && Array.isArray(s.flags);
}

/** Keeps the last snapshot in memory. The default: survives reconnects, not restarts. */
export function memoryStore(): SnapshotStore {
  let kept: Snapshot | undefined;
  return {
    load: async () => kept,
    save: async (snapshot) => {
      kept = snapshot;
    },
  };
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Keeps the last snapshot in browser localStorage. A full or blocked storage (private windows) only costs the
 * offline copy, the SDK keeps working.
 */
export function localStorageStore(key = 'flagken:snapshot', storage?: KeyValueStorage): SnapshotStore {
  const target = (): KeyValueStorage | undefined => {
    try {
      return storage ?? globalThis.localStorage;
    } catch {
      return undefined;
    }
  };
  return {
    load: async () => {
      try {
        const raw = target()?.getItem(key);
        if (!raw) return undefined;
        const parsed: unknown = JSON.parse(raw);
        return isSnapshot(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    },
    save: async (snapshot) => {
      try {
        target()?.setItem(key, JSON.stringify(snapshot));
      } catch {
        // Quota or privacy settings: skip the offline copy.
      }
    },
  };
}
