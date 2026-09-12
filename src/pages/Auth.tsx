import React, { useEffect, useRef, useState } from 'react';
import { Activity, Mail, Lock, UserRound, AlertCircle, Loader2 } from 'lucide-react';
import { AUTH_TOKEN_KEY } from '../contexts/AuthContext';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

declare global { interface Window { google?: any; } }

export function Auth() {
  const [isLogin, setIsLogin] = useState(true); const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [loading, setLoading] = useState(false); const [googleLoading, setGoogleLoading] = useState(false); const [error, setError] = useState<string | null>(null); const googleButtonRef = useRef<HTMLDivElement>(null);
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/${isLogin ? 'login' : 'register'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Authentication failed.');
      localStorage.setItem(AUTH_TOKEN_KEY, data.token); window.location.href = '/';
    } catch (err) { setError(err instanceof Error ? err.message : 'Authentication failed.'); } finally { setLoading(false); }
  };
  const handleGoogle = async (credential: string) => {
    setGoogleLoading(true); setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: `__GOOGLE_ID_TOKEN__:${credential}` }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Google authentication failed.');
      localStorage.setItem(AUTH_TOKEN_KEY, data.token); window.location.href = '/';
    } catch (err) { setError(err instanceof Error ? err.message : 'Google authentication failed.'); } finally { setGoogleLoading(false); }
  };
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleButtonRef.current) return;
    const render = () => { if (!window.google || !googleButtonRef.current) return; googleButtonRef.current.innerHTML = ''; window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (response: any) => handleGoogle(response.credential), ux_mode: 'popup' }); window.google.accounts.id.renderButton(googleButtonRef.current, { theme: 'outline', size: 'large', width: 360, text: isLogin ? 'signin_with' : 'signup_with', shape: 'rectangular' }); };
    if (window.google) render(); else { const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true; script.onload = render; document.head.appendChild(script); return () => { script.remove(); }; }
  }, [isLogin]);
  return <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8"><div className="sm:mx-auto sm:w-full sm:max-w-md"><div className="flex justify-center"><div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg"><Activity className="text-white w-8 h-8" /></div></div><h2 className="mt-6 text-center text-4xl font-extrabold text-slate-900">Surebet<span className="text-indigo-600">Pro</span></h2><p className="mt-2 text-center text-sm font-medium text-slate-500">{isLogin ? 'Sign in to access your dashboard' : 'Create your account to get started'}</p></div>
    <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md"><div className="bg-white py-10 px-6 shadow-xl sm:rounded-2xl sm:px-10 border border-slate-100"><form className="space-y-6" onSubmit={handleAuth}>{error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3 items-start text-red-700 text-sm font-medium"><AlertCircle className="w-5 h-5" /><p>{error}</p></div>}{!isLogin && <div><label className="block text-sm font-bold text-slate-700">Name</label><div className="mt-2 relative"><UserRound className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" /><input type="text" required value={name} onChange={e => setName(e.target.value)} className="block w-full pl-11 bg-white border border-slate-300 rounded-xl py-3 text-slate-900" placeholder="Your name" /></div></div>}<div><label className="block text-sm font-bold text-slate-700">Email</label><div className="mt-2 relative"><Mail className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" /><input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="block w-full pl-11 bg-white border border-slate-300 rounded-xl py-3 text-slate-900" placeholder="you@example.com" /></div></div><div><label className="block text-sm font-bold text-slate-700">Password</label><div className="mt-2 relative"><Lock className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" /><input type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} className="block w-full pl-11 bg-white border border-slate-300 rounded-xl py-3 text-slate-900" placeholder="At least 8 characters" /></div></div><button type="submit" disabled={loading || googleLoading} className="w-full flex justify-center py-3 px-4 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : isLogin ? 'Sign In' : 'Create Account'}</button></form>
      {GOOGLE_CLIENT_ID && <><div className="my-6 flex items-center gap-3"><div className="h-px flex-1 bg-slate-200" /><span className="text-xs font-bold uppercase text-slate-400">or</span><div className="h-px flex-1 bg-slate-200" /></div><div className="flex justify-center min-h-10" ref={googleButtonRef}>{googleLoading && <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />}</div></>}
      <div className="mt-8 text-center"><button onClick={() => { setIsLogin(!isLogin); setError(null); }} className="text-sm font-bold text-indigo-600 hover:text-indigo-800">{isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}</button></div></div></div>
  </div>;
}
