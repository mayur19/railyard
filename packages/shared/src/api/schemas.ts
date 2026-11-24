import { z } from 'zod';
import { PIPELINE_LIMITS } from '../pipeline/limits.js';

export const ROLES = ['owner', 'admin', 'developer', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'project:read',
  'project:write',
  'pipeline:validate',
  'run:read',
  'run:create',
  'run:cancel',
  'secret:write',
  'runner:manage',
  'org:manage',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== 'org:manage'),
  developer: ['project:read', 'pipeline:validate', 'run:read', 'run:create', 'run:cancel'],
  viewer: ['project:read', 'run:read'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12, 'password must be at least 12 characters').max(256);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, 'use 3-50 lowercase letters, digits or dashes');

export const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(100),
  organizationSlug: slug,
  name: z.string().trim().min(1).max(100),
  email,
  password,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug,
  repositoryPath: z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .refine((p) => p.startsWith('/'), 'repository path must be absolute'),
  defaultBranch: z.string().trim().min(1).max(255).default('main'),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

const pipelineYaml = z.string().min(1).max(PIPELINE_LIMITS.maxYamlBytes);
const branch = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._/-]+$/, 'invalid branch name');
const sha = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,40}$/i, 'sha must be 7-40 hex characters');

export const validatePipelineSchema = z.object({
  yaml: pipelineYaml,
  context: z
    .object({
      branch: branch.default('main'),
      sha: sha.default('0000000'),
      event: z.enum(['push', 'manual', 'schedule', 'api']).default('manual'),
    })
    .default({}),
});
export type ValidatePipelineInput = z.infer<typeof validatePipelineSchema>;

export const createRunSchema = z.object({
  yaml: pipelineYaml,
  branch: branch.default('main'),
  sha: sha.default('0000000'),
  event: z.enum(['manual', 'api']).default('manual'),
});
export type CreateRunInput = z.infer<typeof createRunSchema>;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

export const uuidParam = z.object({ id: z.string().uuid() });

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface ApiEnvelope<T> {
  readonly data: T | null;
  readonly error: ApiError | null;
  readonly meta?: Record<string, unknown>;
}
