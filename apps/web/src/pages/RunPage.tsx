import { isTerminal, type JobStatus } from '@railyard/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { RunDetail } from '../api/types';
import { AnsiLog } from '../components/AnsiLog';
import { RunGraph } from '../components/RunGraph';
import { StatusPill } from '../components/StatusPill';
import { useJobLog } from '../hooks/useJobLog';
import { formatDuration } from './time';

export function RunPage() {
  const { runId } = useParams();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await api<RunDetail>('GET', `/api/runs/${runId}`);
        setRun(res.data);
        setSelected((current) => current ?? res.data.jobs[0]?.key ?? null);
        const active = res.data.jobs.some((job) => !isTerminal(job.status as JobStatus));
        if (active) timer = setTimeout(() => void load(), 1500);
      } catch (err) {
        setError((err as Error).message);
      }
    };
    void load();
    return () => clearTimeout(timer);
  }, [runId]);

  const job = run?.jobs.find((j) => j.key === selected) ?? null;
  const log = useJobLog(runId, job?.id ?? null);

  if (error) return <p className="error">{error}</p>;
  if (!run) return <p className="loading">Loading run…</p>;
  return (
    <section>
      <div className="page-head">
        <h1>
          <Link to={`/projects/${run.projectId}`}>{run.pipelineName}</Link> #{run.number}{' '}
          <StatusPill status={run.status} />
        </h1>
        <span className="muted">
          <code>{run.branch}</code> @ <code>{run.commitSha.slice(0, 10)}</code> ·{' '}
          {formatDuration(run.startedAt, run.finishedAt)}
        </span>
      </div>
      <div className="graph-scroll card">
        <RunGraph
          jobs={run.jobs}
          criticalPath={run.criticalPath}
          selectedKey={selected}
          onSelect={setSelected}
        />
      </div>
      {run.excluded.length > 0 ? (
        <p className="muted">
          Excluded: {run.excluded.map((e) => `${e.jobId} (${e.reason})`).join(', ')}
        </p>
      ) : null}
      {job ? (
        <div className="job-panel">
          <div className="job-head">
            <h2>{job.name}</h2>
            <StatusPill status={log.status ?? job.status} />
            <span className="muted">attempt {job.attempt}</span>
            {job.failureReason ? <span className="error">{job.failureReason}</span> : null}
          </div>
          <ol className="steps">
            {job.steps.map((step) => (
              <li key={step.id}>
                <StatusPill status={step.status} /> {step.name}
                {step.exitCode !== null ? (
                  <span className="muted"> exit {step.exitCode}</span>
                ) : null}
              </li>
            ))}
          </ol>
          <AnsiLog lines={log.lines} />
        </div>
      ) : null}
    </section>
  );
}
