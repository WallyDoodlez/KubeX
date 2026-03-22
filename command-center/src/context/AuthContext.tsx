import React, { createContext, useContext, useState, useCallback } from 'react';

interface AuthContextValue {
  token: string;
  setToken: (token: string) => void;
  isConfigured: boolean;
  clearToken: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Initialize from env var or empty
  const [token, setTokenState] = useState<string>(
    () => import.meta.env.VITE_MANAGER_TOKEN ?? ''
  );

  const setToken = useCallback((t: string) => {
    setTokenState(t);
  }, []);

  const clearToken = useCallback(() => {
    setTokenState('');
  }, []);

  const isConfigured = token.length > 0;

  return (
    <AuthContext.Provider value={{ token, setToken, isConfigured, clearToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
