-- First vertical slice: projects, pipeline runs, planned jobs and steps, logs and runners.

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  repository_path text NOT NULL CHECK (repository_path LIKE '/%'),
  default_branch text NOT NULL DEFAULT 'main',
  next_run_number integer NOT NULL DEFAULT 1 CHECK (next_run_number > 0),
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE TABLE pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  number integer NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  pipeline_name text NOT NULL,
  source_yaml text NOT NULL,
  plan jsonb NOT NULL,
  branch text NOT NULL,
  commit_sha text NOT NULL,
  trigger_event text NOT NULL CHECK (trigger_event IN ('push', 'manual', 'schedule', 'api')),
  triggered_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (project_id, number)
);
CREATE INDEX pipeline_runs_org_project_idx ON pipeline_runs (organization_id, project_id, number DESC);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES pipeline_runs (id) ON DELETE CASCADE,
  key text NOT NULL,
  job_ref text NOT NULL,
  name text NOT NULL,
  stage text NOT NULL,
  stage_index integer NOT NULL,
  level integer NOT NULL,
  matrix jsonb,
  needs text[] NOT NULL DEFAULT '{}',
  run_when text NOT NULL CHECK (run_when IN ('on_success', 'on_failure', 'always')),
  allow_failure boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('blocked', 'queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled', 'skipped')),
  attempt integer NOT NULL DEFAULT 0,
  retries integer NOT NULL DEFAULT 0 CHECK (retries BETWEEN 0 AND 5),
  timeout_seconds integer NOT NULL CHECK (timeout_seconds > 0),
  runs_on text[] NOT NULL DEFAULT '{}',
  env jsonb NOT NULL DEFAULT '{}'::jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  exit_code integer,
  failure_reason text,
  queued_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, key),
  CHECK ((status = 'running') = (lease_owner IS NOT NULL))
);
-- Leasing scans only queued rows in FIFO order; the partial index keeps that O(log n).
CREATE INDEX jobs_queue_idx ON jobs (queued_at, id) WHERE status = 'queued';
-- The reaper scans only running rows by lease expiry.
CREATE INDEX jobs_lease_idx ON jobs (lease_expires_at) WHERE status = 'running';
CREATE INDEX jobs_run_idx ON jobs (run_id);

CREATE TABLE job_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  position integer NOT NULL,
  name text NOT NULL,
  script text NOT NULL,
  env jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_seconds integer NOT NULL CHECK (timeout_seconds > 0),
  continue_on_error boolean NOT NULL DEFAULT false,
  working_directory text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'timed_out', 'skipped', 'cancelled')),
  exit_code integer,
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (job_id, position)
);

CREATE TABLE job_log_chunks (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  seq integer NOT NULL,
  attempt integer NOT NULL,
  stream text NOT NULL CHECK (stream IN ('stdout', 'stderr', 'system')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, seq)
);

CREATE TABLE runners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  hostname text NOT NULL,
  labels text[] NOT NULL DEFAULT '{}',
  version text NOT NULL,
  status text NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'offline')),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
