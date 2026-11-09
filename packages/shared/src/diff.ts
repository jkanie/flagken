import type { JsonValue } from './types.js';

export interface DiffEntry {
  /** JSON Pointer style path, for example /rules/0/serve/variation. */
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: JsonValue;
  after?: JsonValue;
}

function isObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escape(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Lists the leaf differences between 2 JSON values. The audit log view shows these. */
export function diffJson(before: JsonValue | undefined, after: JsonValue | undefined, path = ''): DiffEntry[] {
  if (before === undefined && after === undefined) return [];
  if (before === undefined) return [{ path: path || '/', kind: 'added', after: after as JsonValue }];
  if (after === undefined) return [{ path: path || '/', kind: 'removed', before }];

  if (Array.isArray(before) && Array.isArray(after)) {
    const out: DiffEntry[] = [];
    const length = Math.max(before.length, after.length);
    for (let i = 0; i < length; i++) out.push(...diffJson(before[i], after[i], `${path}/${i}`));
    return out;
  }
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => diffJson(before[key], after[key], `${path}/${escape(key)}`));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ path: path || '/', kind: 'changed', before, after }];
}
