import { hasPermission, type Permission } from '@railyard/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthPrincipal, AuthService } from '../modules/auth/auth.service.js';
import { AppError, forbidden, unauthorized } from './errors.js';

export const SESSION_COOKIE = 'ry_session';
export const CSRF_COOKIE = 'ry_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

declare module 'fastify' {
  interface FastifyRequest {
    principal: AuthPrincipal | null;
  }
}

/** Loads the session (if any) for every request. Authorization happens per route. */
export function registerSessionLoader(app: FastifyInstance, auth: AuthService): void {
  app.decorateRequest('principal', null);
  app.addHook('preHandler', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.principal = token ? await auth.authenticate(token) : null;
  });
}

/** Route guard: requires a session, a permission, and (for mutating requests) a CSRF token. */
export function guard(permission?: Permission) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const principal = request.principal;
    if (!principal) throw unauthorized();
    if (MUTATING.has(request.method)) verifyCsrf(request, principal);
    if (permission && !hasPermission(principal.role, permission)) throw forbidden();
  };
}

function verifyCsrf(request: FastifyRequest, principal: AuthPrincipal): void {
  const header = request.headers[CSRF_HEADER];
  if (typeof header !== 'string' || header !== principal.csrfToken) {
    throw new AppError(403, 'CSRF_FAILED', 'Missing or invalid CSRF token');
  }
}

export function principalOf(request: FastifyRequest): AuthPrincipal {
  if (!request.principal) throw unauthorized();
  return request.principal;
}
