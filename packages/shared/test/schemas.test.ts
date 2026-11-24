import { describe, expect, it } from 'vitest';
import {
  createProjectSchema,
  createRunSchema,
  hasPermission,
  loginSchema,
  registerSchema,
  ROLE_PERMISSIONS,
  validatePipelineSchema,
} from '../src/api/schemas.js';

describe('RBAC', () => {
  it('grants owners everything and viewers read-only', () => {
    expect(hasPermission('owner', 'org:manage')).toBe(true);
    expect(hasPermission('admin', 'org:manage')).toBe(false);
    expect(hasPermission('developer', 'run:create')).toBe(true);
    expect(hasPermission('viewer', 'run:create')).toBe(false);
    expect(ROLE_PERMISSIONS.viewer).toEqual(['project:read', 'run:read']);
  });
});

describe('API schemas', () => {
  it('normalises registration input', () => {
    const parsed = registerSchema.parse({
      organizationName: ' Acme ',
      organizationSlug: 'ACME-ci',
      name: 'Dev',
      email: ' Dev@Example.COM ',
      password: 'correct horse battery',
    });
    expect(parsed.email).toBe('dev@example.com');
    expect(parsed.organizationSlug).toBe('acme-ci');
  });

  it('rejects weak passwords and bad slugs', () => {
    const base = { organizationName: 'Acme', name: 'x', email: 'a@b.co' };
    expect(
      registerSchema.safeParse({ ...base, organizationSlug: 'acme', password: 'short' }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...base, organizationSlug: '-bad-', password: 'long enough pass' })
        .success,
    ).toBe(false);
    expect(loginSchema.safeParse({ email: 'x', password: 'y' }).success).toBe(false);
  });

  it('requires absolute repository paths', () => {
    const ok = createProjectSchema.safeParse({
      name: 'Web',
      slug: 'web',
      repositoryPath: '/srv/git/web.git',
    });
    expect(ok.success && ok.data.defaultBranch).toBe('main');
    expect(
      createProjectSchema.safeParse({ name: 'Web', slug: 'web', repositoryPath: 'web.git' })
        .success,
    ).toBe(false);
  });

  it('defaults run and validation context', () => {
    expect(createRunSchema.parse({ yaml: 'x' })).toMatchObject({
      branch: 'main',
      sha: '0000000',
      event: 'manual',
    });
    expect(validatePipelineSchema.parse({ yaml: 'x' }).context.event).toBe('manual');
    expect(createRunSchema.safeParse({ yaml: 'x', branch: 'bad branch' }).success).toBe(false);
    expect(createRunSchema.safeParse({ yaml: 'x', sha: 'xyz' }).success).toBe(false);
  });
});
