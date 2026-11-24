import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Project, RunSummary } from '../api/types';
import { StatusPill } from '../components/StatusPill';
import { formatDuration } from './time';

export function ProjectRunsPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return undefined;
    const load = () =>
      Promise.all([
        api<Project>('GET', `/api/projects/${projectId}`),
        api<RunSummary[]>('GET', `/api/projects/${projectId}/runs?limit=50`),
      ])
        .then(([p, r]) => {
          setProject(p.data);
          setRuns(r.data);
        })
        .catch((err: Error) => setError(err.message));
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [projectId]);

  return (
    <section>
      <div className="page-head">
        <h1>{project?.name ?? 'Project'}</h1>
        <Link className="button" to={`/editor?project=${projectId ?? ''}`}>
          New run
        </Link>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <table className="table">
        <thead>
          <tr>
            <th>Run</th>
            <th>Pipeline</th>
            <th>Branch</th>
            <th>Status</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <Link to={`/runs/${run.id}`}>#{run.number}</Link>
              </td>
              <td>{run.pipelineName}</td>
              <td>
                <code>{run.branch}</code>
              </td>
              <td>
                <StatusPill status={run.status} />
              </td>
              <td>{formatDuration(run.startedAt, run.finishedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
