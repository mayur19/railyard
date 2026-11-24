import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { Principal } from '../api/types';
import { AuthContext, type AuthState } from './AuthContext';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Principal>('GET', '/api/auth/me')
      .then((res) => setPrincipal(res.data))
      .catch(() => setPrincipal(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<Principal>('POST', '/api/auth/login', { email, password });
    setPrincipal(res.data);
  }, []);

  const register = useCallback(async (input: Record<string, string>) => {
    const res = await api<Principal>('POST', '/api/auth/register', input);
    setPrincipal(res.data);
  }, []);

  const logout = useCallback(async () => {
    await api('POST', '/api/auth/logout').catch(() => undefined);
    setPrincipal(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ principal, loading, login, register, logout }),
    [principal, loading, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
