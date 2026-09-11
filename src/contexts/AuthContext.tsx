import React, { createContext, useContext, useEffect, useState } from 'react';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'surebetpro_session';

export interface User { id: string; email: string; name: string; role: string; plan: string; }
interface AuthContextType { user: User | null; profile: User | null; isLoading: boolean; signOut: () => Promise<void>; refreshSession: () => Promise<void>; }
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function getAuthToken(): string | null { return localStorage.getItem(TOKEN_KEY); }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null); const [isLoading, setIsLoading] = useState(true);
  const refreshSession = async () => {
    const token = getAuthToken();
    if (!token) { setUser(null); setIsLoading(false); return; }
    try { const response = await fetch(`${API_BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('Session expired'); const data = await response.json(); setUser(data.user || null); }
    catch { localStorage.removeItem(TOKEN_KEY); setUser(null); }
    finally { setIsLoading(false); }
  };
  useEffect(() => { refreshSession(); }, []);
  const signOut = async () => { localStorage.removeItem(TOKEN_KEY); setUser(null); };
  return <AuthContext.Provider value={{ user, profile: user, isLoading, signOut, refreshSession }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => { const context = useContext(AuthContext); if (!context) throw new Error('useAuth must be used inside AuthProvider'); return context; };
export const AUTH_TOKEN_KEY = TOKEN_KEY;
