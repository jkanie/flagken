import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { CONFIG } from '../config.js';
import type { Config } from '../config.js';

export const SESSION_COOKIE = 'flagken_session';

/** Signed session tokens (JWT, HS256) kept in an HttpOnly cookie. */
@Injectable()
export class SessionService {
  private readonly key: Uint8Array;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.key = new TextEncoder().encode(config.sessionSecret);
  }

  get ttlSeconds(): number {
    return this.config.sessionTtlHours * 3600;
  }

  sign(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setIssuer('flagken')
      .setAudience('flagken-console')
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.key);
  }

  /** Returns the user id, or undefined for a token that is missing, expired, forged. */
  async verify(token: string | undefined): Promise<string | undefined> {
    if (!token) return undefined;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: 'flagken',
        audience: 'flagken-console',
      });
      return payload.sub;
    } catch {
      return undefined;
    }
  }

  cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'strict' as const,
      path: '/',
      maxAge: this.ttlSeconds * 1000,
    };
  }
}

/** Reads 1 cookie from a raw Cookie header (the WebSocket handshake has no cookie parser). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
