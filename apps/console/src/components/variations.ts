import type { FlagKind, JsonValue } from '@flagken/shared';

/** Turns the text of a variation input into a value of the flag's kind. Throws with a message on bad input. */
export function parseValue(kind: FlagKind, text: string): JsonValue {
  if (kind === 'boolean') return text === 'true';
  if (kind === 'string') return text;
  if (kind === 'number') {
    const value = Number(text);
    if (text.trim() === '' || !Number.isFinite(value)) throw new Error(`${text || 'empty'} is not a number`);
    return value;
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    throw new Error(`${text.slice(0, 40) || 'empty'} is not valid JSON`);
  }
}

export function formatValue(value: JsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Splits "a, b,c" into ["a", "b", "c"], dropping empty entries. */
export function splitList(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
