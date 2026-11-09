import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isSnapshot } from './storage.js';
import type { SnapshotStore } from './storage.js';

export * from './index.js';

/**
 * Keeps the last snapshot in a JSON file, so a Node service can start with known flags while the server is down.
 * Writes go to a temporary file first, then a rename, so a crash never leaves half a file.
 */
export function fileStore(path: string): SnapshotStore {
  return {
    load: async () => {
      try {
        const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
        return isSnapshot(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    },
    save: async (snapshot) => {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
      await rename(temporary, path);
    },
  };
}
