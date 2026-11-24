import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiRequestError } from '../api/client';
import type { Project } from '../api/types';
import { StatusPill } from '../components/StatusPill';

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', repositoryPath: '' });

  const load = useCallback(() => {
    api<Project[]>('GET', '/api/projects')
      .then((res) => setProjects(res.data))
      .catch((err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api('POST', '/api/projects', form);
      setForm({ name: '', slug: '', repositoryPath: '' });
      load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create project');
    }
  }

  return (
    <section>
      <h1>Projects</h1>
      <table className="table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Repository</th>
            <th>Last run</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id}>
              <td>
                <Link to={`/projects/${project.id}`}>{project.name}</Link>
              </td>
              <td>
                <code>{project.repositoryPath}</code>
              </td>
              <td>
                {project.lastRun ? (
                  <>
                    <span>#{project.lastRun.number}</span>{' '}
                    <StatusPill status={project.lastRun.status} />
                  </>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
          {projects.length === 0 ? (
            <tr>
              <td colSpan={3} className="muted">
                No projects yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <form className="card inline-form" onSubmit={(e) => void onCreate(e)}>
        <h2>New project</h2>
        <input
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <input
          placeholder="slug"
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })}
          required
        />
        <input
          placeholder="/srv/git/repo.git"
          value={form.repositoryPath}
          onChange={(e) => setForm({ ...form, repositoryPath: e.target.value })}
          required
        />
        <button type="submit" className="button">
          Create
        </button>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
