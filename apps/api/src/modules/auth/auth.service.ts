import type { LoginInput, RegisterInput, Role } from '@railyard/shared';
import type { AppConfig } from '../../config/env.js';
import { withTransaction, type Pool } from '../../db/pool.js';
import { AppError, conflict, unauthorized } from '../../http/errors.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../security/password.js';
import { hmacToken, randomToken } from '../../security/tokens.js';
import { writeAudit } from '../audit/audit.repository.js';
import { deleteSession, insertSession, touchSession } from './session.repository.js';
import {
  findUserByEmail,
  findUserInOrganization,
  insertMembership,
  insertOrganization,
  insertUser,
  type UserWithMembership,
} from './user.repository.js';

export interface AuthPrincipal {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly role: Role;
  readonly sessionId: string;
  readonly csrfToken: string;
}

export interface IssuedSession {
  readonly token: string;
  readonly principal: AuthPrincipal;
  readonly expiresAt: Date;
}

export interface ClientInfo {
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string;
}

const UNIQUE_VIOLATION = '23505';

/**
 * Deliberately identical for "email exists" and "slug taken" so the endpoint cannot be used to
 * enumerate accounts. Email-verified signup through the local outbox (RY-150) removes the
 * remaining signal entirely by always answering 202.
 */
function registrationRejected(): AppError {
  return conflict('Registration could not be completed with the supplied details');
}

export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly config: AppConfig,
  ) {}

  async register(input: RegisterInput, client: ClientInfo): Promise<IssuedSession> {
    const passwordHash = await hashPassword(input.password);
    try {
      return await withTransaction(this.pool, async (tx) => {
        if (await findUserByEmail(tx, input.email)) throw registrationRejected();
        const organizationId = await insertOrganization(
          tx,
          input.organizationName,
          input.organizationSlug,
        );
        const userId = await insertUser(tx, input.email, input.name, passwordHash);
        await insertMembership(tx, organizationId, userId, 'owner');
        await writeAudit(tx, {
          organizationId,
          actorUserId: userId,
          action: 'auth.registered',
          targetType: 'organization',
          targetId: organizationId,
          requestId: client.requestId,
          ...(client.ip ? { ip: client.ip } : {}),
        });
        const user = (await findUserInOrganization(
          tx,
          userId,
          organizationId,
        )) as UserWithMembership;
        return this.issueSession(tx, user, client);
      });
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw registrationRejected();
      }
      throw err;
    }
  }

  async login(input: LoginInput, client: ClientInfo): Promise<IssuedSession> {
    const user = await findUserByEmail(this.pool, input.email);
    // Always run scrypt so response time does not reveal whether the account exists.
    const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid || user.disabled) {
      await writeAudit(this.pool, {
        organizationId: user?.organizationId ?? null,
        actorUserId: user?.id ?? null,
        action: 'auth.login_failed',
        metadata: { email: input.email },
        requestId: client.requestId,
        ...(client.ip ? { ip: client.ip } : {}),
      });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    return withTransaction(this.pool, async (tx) => {
      await writeAudit(tx, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: 'auth.login',
        requestId: client.requestId,
        ...(client.ip ? { ip: client.ip } : {}),
      });
      return this.issueSession(tx, user, client);
    });
  }

  async logout(principal: AuthPrincipal, client: ClientInfo): Promise<void> {
    await withTransaction(this.pool, async (tx) => {
      await deleteSession(tx, principal.sessionId);
      await writeAudit(tx, {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'auth.logout',
        requestId: client.requestId,
      });
    });
  }

  /** Resolves a session cookie token into a principal, or null when invalid/expired. */
  async authenticate(token: string): Promise<AuthPrincipal | null> {
    const session = await touchSession(this.pool, hmacToken(this.config.SESSION_SECRET, token));
    if (!session) return null;
    const user = await findUserInOrganization(this.pool, session.userId, session.organizationId);
    if (!user || user.disabled) return null;
    return toPrincipal(user, session.id, session.csrfToken);
  }

  private async issueSession(
    tx: Parameters<typeof insertSession>[0],
    user: UserWithMembership,
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const token = randomToken();
    const id = hmacToken(this.config.SESSION_SECRET, token);
    const csrfToken = randomToken();
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_HOURS * 3600 * 1000);
    await insertSession(tx, {
      id,
      userId: user.id,
      organizationId: user.organizationId,
      csrfToken,
      expiresAt,
      userAgent: client.userAgent?.slice(0, 512) ?? null,
      ip: client.ip,
    });
    return { token, expiresAt, principal: toPrincipal(user, id, csrfToken) };
  }
}

function toPrincipal(
  user: UserWithMembership,
  sessionId: string,
  csrfToken: string,
): AuthPrincipal {
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: user.organizationId,
    organizationName: user.organizationName,
    organizationSlug: user.organizationSlug,
    role: user.role,
    sessionId,
    csrfToken,
  };
}

export function requirePrincipal(principal: AuthPrincipal | null): AuthPrincipal {
  if (!principal) throw unauthorized();
  return principal;
}
