import { hash, verify } from '@node-rs/argon2';

// Argon2id with the OWASP 2024 minimum: 19 MiB of memory, 2 passes, 1 lane.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** A fixed hash to check against when the e-mail is unknown, so both cases take the same time. */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword('not-a-real-password-used-for-timing');
  return dummy;
}
