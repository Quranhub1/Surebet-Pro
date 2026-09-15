import { StrictMode, Component, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const SESSION_TOKEN_KEY = 'surebetpro_session';
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.includes('/api/')) return nativeFetch(input, init);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (!headers.has('Authorization')) {
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  return nativeFetch(input, { ...init, headers });
};

// Remove legacy PWA workers/caches left by earlier releases before the app starts.
// This prevents an old cached JavaScript bundle from crashing after deployment.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.getRegistrations()
      .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
      .then(() => ('caches' in window ? caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))) : undefined))
      .catch(error => console.error('[PWA] Startup cache cleanup failed:', error));
  });
}

class GlobalErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('[React Crash] Error caught by ErrorBoundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center p-8 font-sans">
          <div className="bg-white border border-red-200 shadow-xl shadow-red-100 p-10 rounded-2xl max-w-2xl w-full text-center">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-100">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h1 className="text-red-600 text-2xl font-extrabold mb-2 tracking-tight">Rendering Error Detected</h1>
            <p className="text-slate-500 mb-8 font-medium">An unexpected application error occurred.</p>
            <div className="bg-slate-50 p-4 rounded-xl overflow-auto border border-slate-200 text-left mb-8"><pre className="text-slate-700 text-sm font-mono whitespace-pre-wrap">{this.state.error ? this.state.error.message : 'Unknown error'}</pre></div>
            <button onClick={() => window.location.reload()} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">Reload Application</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Application root element was not found.');

createRoot(root).render(
  <StrictMode>
    <GlobalErrorBoundary><App /></GlobalErrorBoundary>
  </StrictMode>,
);
