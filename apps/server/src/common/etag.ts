import { HttpException, HttpStatus, PreconditionFailedException } from '@nestjs/common';

/** Strong ETag for a resource version. */
export function etagFor(version: number): string {
  return `"v${version}"`;
}

/**
 * Reads the version a client expects from If-Match.
 * Missing header: 428, so a client cannot save over a change it never saw by forgetting the header.
 * "*" matches any version and returns undefined.
 */
export function expectedVersion(ifMatch: string | undefined): number | undefined {
  if (!ifMatch) {
    throw new HttpException(
      { statusCode: 428, message: 'If-Match is required: send the ETag from your last read', error: 'Precondition Required' },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  const tags = ifMatch.split(',').map((tag) => tag.trim());
  if (tags.includes('*')) return undefined;
  for (const tag of tags) {
    const match = /^"v(\d+)"$/.exec(tag);
    if (match) return Number(match[1]);
  }
  throw new PreconditionFailedException('If-Match does not name a version of this resource');
}
