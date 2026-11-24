import type { Permission } from '@railyard/shared';
import type { FastifyInstance } from 'fastify';
import { guard } from '../../http/auth-hooks.js';
import { fail } from '../../http/envelope.js';

export interface PendingRoute {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly ticket: string;
  readonly summary: string;
  readonly permission: Permission;
}

/**
 * Planned API surface. Each route is registered (authenticated + authorised like the real thing)
 * and answers 501 with the backlog ticket, so the running API matches docs/api/openapi.yaml.
 */
export const PENDING_ROUTES: readonly PendingRoute[] = [
  {
    method: 'PATCH',
    url: '/api/projects/:id',
    ticket: 'RY-011',
    summary: 'Update project settings',
    permission: 'project:write',
  },
  {
    method: 'DELETE',
    url: '/api/projects/:id',
    ticket: 'RY-011',
    summary: 'Archive or delete a project',
    permission: 'project:write',
  },
  {
    method: 'POST',
    url: '/api/projects/:id/sync',
    ticket: 'RY-012',
    summary: 'Poll the bare repository now',
    permission: 'project:write',
  },
  {
    method: 'GET',
    url: '/api/projects/:id/branches',
    ticket: 'RY-013',
    summary: 'List branches and head commits',
    permission: 'project:read',
  },
  {
    method: 'GET',
    url: '/api/projects/:id/commits',
    ticket: 'RY-013',
    summary: 'List commits for a branch',
    permission: 'project:read',
  },
  {
    method: 'GET',
    url: '/api/projects/:id/pipeline-file',
    ticket: 'RY-014',
    summary: 'Read .railyard.yml at a commit',
    permission: 'project:read',
  },
  {
    method: 'POST',
    url: '/api/runs/:id/cancel',
    ticket: 'RY-043',
    summary: 'Cancel a run',
    permission: 'run:cancel',
  },
  {
    method: 'POST',
    url: '/api/runs/:id/jobs/:jobId/cancel',
    ticket: 'RY-043',
    summary: 'Cancel one job',
    permission: 'run:cancel',
  },
  {
    method: 'POST',
    url: '/api/runs/:id/jobs/:jobId/retry',
    ticket: 'RY-044',
    summary: 'Retry a failed job',
    permission: 'run:create',
  },
  {
    method: 'POST',
    url: '/api/runs/:id/rerun',
    ticket: 'RY-044',
    summary: 'Re-run a pipeline with the same inputs',
    permission: 'run:create',
  },
  {
    method: 'GET',
    url: '/api/runs/:id/jobs/:jobId/logs/raw',
    ticket: 'RY-065',
    summary: 'Download raw job log',
    permission: 'run:read',
  },
  {
    method: 'GET',
    url: '/api/projects/:id/secrets',
    ticket: 'RY-071',
    summary: 'List secret names',
    permission: 'project:read',
  },
  {
    method: 'PUT',
    url: '/api/projects/:id/secrets/:name',
    ticket: 'RY-071',
    summary: 'Create or replace a secret',
    permission: 'secret:write',
  },
  {
    method: 'DELETE',
    url: '/api/projects/:id/secrets/:name',
    ticket: 'RY-071',
    summary: 'Delete a secret',
    permission: 'secret:write',
  },
  {
    method: 'GET',
    url: '/api/runs/:id/artifacts',
    ticket: 'RY-081',
    summary: 'List run artifacts',
    permission: 'run:read',
  },
  {
    method: 'GET',
    url: '/api/artifacts/:id/download',
    ticket: 'RY-081',
    summary: 'Download an artifact',
    permission: 'run:read',
  },
  {
    method: 'DELETE',
    url: '/api/projects/:id/caches',
    ticket: 'RY-084',
    summary: 'Purge project caches',
    permission: 'project:write',
  },
  {
    method: 'GET',
    url: '/api/projects/:id/environments',
    ticket: 'RY-090',
    summary: 'List deployment environments',
    permission: 'project:read',
  },
  {
    method: 'POST',
    url: '/api/projects/:id/environments',
    ticket: 'RY-090',
    summary: 'Create a deployment environment',
    permission: 'project:write',
  },
  {
    method: 'GET',
    url: '/api/projects/:id/deployments',
    ticket: 'RY-090',
    summary: 'Deployment history',
    permission: 'project:read',
  },
  {
    method: 'GET',
    url: '/api/approvals',
    ticket: 'RY-091',
    summary: 'Pending approvals for the current user',
    permission: 'run:read',
  },
  {
    method: 'POST',
    url: '/api/approvals/:id/approve',
    ticket: 'RY-091',
    summary: 'Approve a gated job',
    permission: 'run:create',
  },
  {
    method: 'POST',
    url: '/api/approvals/:id/reject',
    ticket: 'RY-091',
    summary: 'Reject a gated job',
    permission: 'run:create',
  },
  {
    method: 'GET',
    url: '/api/projects/:id/schedules',
    ticket: 'RY-101',
    summary: 'List schedules with next fire time',
    permission: 'project:read',
  },
  {
    method: 'POST',
    url: '/api/projects/:id/schedules',
    ticket: 'RY-101',
    summary: 'Create a schedule',
    permission: 'project:write',
  },
  {
    method: 'DELETE',
    url: '/api/schedules/:id',
    ticket: 'RY-101',
    summary: 'Delete a schedule',
    permission: 'project:write',
  },
  {
    method: 'GET',
    url: '/api/runners',
    ticket: 'RY-053',
    summary: 'List runners and their health',
    permission: 'runner:manage',
  },
  {
    method: 'POST',
    url: '/api/runners/registration-tokens',
    ticket: 'RY-053',
    summary: 'Issue a runner registration token',
    permission: 'runner:manage',
  },
  {
    method: 'DELETE',
    url: '/api/runners/:id',
    ticket: 'RY-053',
    summary: 'Deregister a runner',
    permission: 'runner:manage',
  },
  {
    method: 'GET',
    url: '/api/metrics/queue',
    ticket: 'RY-110',
    summary: 'Queue depth and wait-time percentiles',
    permission: 'run:read',
  },
  {
    method: 'GET',
    url: '/api/projects/:id/metrics',
    ticket: 'RY-110',
    summary: 'Duration percentiles and success rate',
    permission: 'run:read',
  },
  {
    method: 'GET',
    url: '/api/org/members',
    ticket: 'RY-025',
    summary: 'List organization members',
    permission: 'org:manage',
  },
  {
    method: 'POST',
    url: '/api/org/invitations',
    ticket: 'RY-024',
    summary: 'Invite a member',
    permission: 'org:manage',
  },
  {
    method: 'PATCH',
    url: '/api/org/members/:userId',
    ticket: 'RY-025',
    summary: 'Change member role',
    permission: 'org:manage',
  },
  {
    method: 'GET',
    url: '/api/audit-logs',
    ticket: 'RY-026',
    summary: 'Query the audit log',
    permission: 'audit:read',
  },
  {
    method: 'GET',
    url: '/api/tokens',
    ticket: 'RY-028',
    summary: 'List personal API tokens',
    permission: 'project:read',
  },
  {
    method: 'POST',
    url: '/api/tokens',
    ticket: 'RY-028',
    summary: 'Create a personal API token',
    permission: 'project:read',
  },
  {
    method: 'GET',
    url: '/api/notifications',
    ticket: 'RY-130',
    summary: 'In-app notifications',
    permission: 'project:read',
  },
];

export function registerPendingRoutes(app: FastifyInstance): void {
  for (const route of PENDING_ROUTES) {
    app.route({
      method: route.method,
      url: route.url,
      preHandler: guard(route.permission),
      handler: async (_request, reply) =>
        reply.status(501).send(
          fail({
            code: 'NOT_IMPLEMENTED',
            message: `${route.summary} is planned but not implemented yet`,
            details: { ticket: route.ticket },
          }),
        ),
    });
  }
}
