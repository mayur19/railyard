import { createHmac, randomBytes } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Keyed hash so a database leak alone cannot be replayed as session cookies. */
export function hmacToken(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}
