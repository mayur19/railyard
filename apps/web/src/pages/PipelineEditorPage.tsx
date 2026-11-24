import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiRequestError } from '../api/client';
import type { PlanPreview, Project, RunDetail } from '../api/types';
import { IssueList } from '../components/IssueList';
import { RunGraph } from '../components/RunGraph';
import { SAMPLE_PIPELINE } from './samplePipeline';

export function PipelineEditorPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [yaml, setYaml] = useState(SAMPLE_PIPELINE);
  const [branch, setBranch] = useState('main');
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(params.get('project') ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Project[]>('GET', '/api/projects')
      .then((res) => {
        setProjects(res.data);
        setProjectId((current) => current || res.data[0]?.id || '');
      })
      .catch(() => setProjects([]));
  }, []);

  // Debounced validation as the user types.
  useEffect(() => {
    const timer = setTimeout(() => {
      api<PlanPreview>('POST', '/api/pipelines/validate', {
        yaml,
        context: { branch, event: 'manual' },
      })
        .then((res) => setPreview(res.data))
        .catch((err: Error) => setError(err.message));
    }, 400);
    return () => clearTimeout(timer);
  }, [yaml, branch]);

  async function startRun() {
    setError(null);
    try {
      const res = await api<RunDetail>('POST', `/api/projects/${projectId}/runs`, { yaml, branch });
      navigate(`/runs/${res.data.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not start run');
    }
  }

  const graphJobs = (preview?.plan?.jobs ?? []).map((job) => ({ ...job, status: 'planned' }));
  return (
    <section>
      <h1>Pipeline editor</h1>
      <div className="editor-grid">
        <div>
          <textarea
            className="yaml"
            spellCheck={false}
            value={yaml}
            onChange={(e) => setYaml(e.target.value)}
            aria-label="Pipeline YAML"
          />
          <IssueList issues={preview?.issues ?? []} />
        </div>
        <div>
          <div className="card inline-form">
            <label>
              Branch <input value={branch} onChange={(e) => setBranch(e.target.value)} />
            </label>
            <label>
              Project
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button"
              disabled={!preview?.valid || !projectId}
              onClick={() => void startRun()}
            >
              Run pipeline
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}
          {preview?.plan ? (
            <>
              <p className="muted">
                {preview.plan.jobs.length} jobs in {preview.plan.levels.length} levels · critical
                path {preview.plan.criticalPath.length}
                {preview.plan.excluded.length > 0
                  ? ` · excluded: ${preview.plan.excluded.map((e) => e.jobId).join(', ')}`
                  : ''}
              </p>
              <div className="graph-scroll card">
                <RunGraph jobs={graphJobs} criticalPath={preview.plan.criticalPath} />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
