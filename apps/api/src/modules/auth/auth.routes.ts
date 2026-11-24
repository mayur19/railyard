import { loginSchema, registerSchema } from '@railyard/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CSRF_COOKIE, guard, principalOf, SESSION_COOKIE } from '../../http/auth-hooks.js';
import type { AppContext } from '../../http/context.js';
import { ok } from '../../http/envelope.js';
import { tooManyRequests } from '../../http/errors.js';
import { normaliseIp } from '../../http/client-ip.js';
import { parse } from '../../http/validate.js';
import {
  AuthService,
  type AuthPrincipal,
  type ClientInfo,
  type IssuedSession,
} from './auth.service.js';

export function presentPrincipal(principal: AuthPrincipal) {
  return {
    user: { id: principal.userId, email: principal.email, name: principal.name },
    organization: {
      id: principal.organizationId,
      name: principal.organizationName,
      slug: principal.organizationSlug,
    },
    role: principal.role,
    csrfToken: principal.csrfToken,
  };
}

function clientInfo(request: FastifyRequest): ClientInfo {
  const ua = request.headers['user-agent'];
  return {
    ip: request.ip ?? null,
    userAgent: typeof ua === 'string' ? ua : null,
    requestId: request.id,
  };
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext, auth: AuthService): void {
  const secure = ctx.config.COOKIE_SECURE;

  const setCookies = (reply: FastifyReply, session: IssuedSession): void => {
    const common = { path: '/', sameSite: 'lax' as const, secure, expires: session.expiresAt };
    void reply.setCookie(SESSION_COOKIE, session.token, { ...common, httpOnly: true });
    void reply.setCookie(CSRF_COOKIE, session.principal.csrfToken, { ...common, httpOnly: false });
  };

  app.post('/api/auth/register', async (request, reply) => {
    const retryAfter = ctx.limiters.registerByIp.hit(normaliseIp(request.ip));
    if (retryAfter > 0) throw tooManyRequests(retryAfter);
    const input = parse(registerSchema, request.body);
    const session = await auth.register(input, clientInfo(request));
    setCookies(reply, session);
    return reply.status(201).send(ok(presentPrincipal(session.principal)));
  });

  app.post('/api/auth/login', async (request, reply) => {
    const input = parse(loginSchema, request.body);
    // All throttling decisions are taken synchronously, before the first await, and each attempt
    // is reserved up front: parallel requests cannot all slip past the checks.
    const { loginByIp, loginByEmail, emailsPerIp } = ctx.limiters;
    const ip = normaliseIp(request.ip);
    const ipWait = loginByIp.hit(ip);
    if (ipWait > 0) throw tooManyRequests(ipWait);
    const fanOutWait = emailsPerIp.admit(ip, input.email);
    if (fanOutWait > 0) throw tooManyRequests(fanOutWait);
    const emailWait = loginByEmail.reserve(input.email);
    if (emailWait > 0) throw tooManyRequests(emailWait);
    const session = await auth.login(input, clientInfo(request));
    loginByEmail.reset(input.email);
    setCookies(reply, session);
    return reply.send(ok(presentPrincipal(session.principal)));
  });

  app.post('/api/auth/logout', { preHandler: guard() }, async (request, reply) => {
    await auth.logout(principalOf(request), clientInfo(request));
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    void reply.clearCookie(CSRF_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/api/auth/me', { preHandler: guard() }, async (request) =>
    ok(presentPrincipal(principalOf(request))),
  );
}
