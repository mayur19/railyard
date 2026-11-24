import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiRequestError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const FIELDS = [
  { name: 'organizationName', label: 'Organization name', type: 'text' },
  { name: 'organizationSlug', label: 'Organization slug', type: 'text' },
  { name: 'name', label: 'Your name', type: 'text' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'password', label: 'Password (12+ characters)', type: 'password' },
] as const;

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await register(values);
      navigate('/projects');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Registration failed');
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={(e) => void onSubmit(e)}>
        <h1>Create an organization</h1>
        {FIELDS.map((field) => (
          <label key={field.name}>
            {field.label}
            <input
              type={field.type}
              value={values[field.name] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
              required
            />
          </label>
        ))}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="button">
          Create organization
        </button>
        <p className="muted">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
