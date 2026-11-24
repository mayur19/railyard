import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { principal, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="loading">Loading…</p>;
  if (!principal) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
