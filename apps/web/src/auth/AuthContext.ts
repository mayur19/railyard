import { createContext, useContext } from 'react';
import type { Principal } from '../api/types';

export interface AuthState {
  readonly principal: Principal | null;
  readonly loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: Record<string, string>): Promise<void>;
  logout(): Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error('useAuth must be used inside AuthProvider');
  return state;
}
