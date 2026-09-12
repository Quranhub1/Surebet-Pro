import React, { useEffect, useState } from 'react';
import { Activity, BrainCircuit, CheckCircle2, Database, Loader2, RefreshCw, Server, Sparkles } from 'lucide-react';
import { getAuthToken } from '../contexts/AuthContext';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

interface HealthState { database: boolean; footballData: boolean; }
interface AiConfig { provider?: string; model?: string; configured?: boolean; }
interface SchedulerState { enabled: boolean; intervalHours: number; timezone: string; lastRunAt: string | null; lastRunStatus: string | null; nextRunAt: string | null; }

export function Admin() {
  const [health, setHealth] = useState<HealthState>({ database: false, footballData: false });
  const [ai, setAi] = useState<AiConfig>({});
  const [scheduler, setScheduler] = useState<SchedulerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');

  const headers = () => ({ Authorization: `Bearer ${getAuthToken()}` });

  const loadStatus = async () => {
    setLoading(true);
    setMessage('');
    try {
      const [healthResponse, aiResponse, schedulerResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/api/health`),
        fetch(`${API_BASE_URL}/api/ai/models`),
        fetch(`${API_BASE_URL}/api/scheduler`),
      ]);
      const healthData = await healthResponse.json();
      const aiData = await aiResponse.json();
      const schedulerData = await schedulerResponse.json();
      setHealth({ database: Boolean(healthData.database), footballData: Boolean(healthData.footballData) });
      setAi(aiData.active || {});
      setScheduler(schedulerData);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load analysis status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadStatus(); }, []);

  const runAnalysis = async () => {
    setRunning(true);
    setMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/football/analyze-now`, { method: 'POST', headers: headers() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to start football analysis.');
      setMessage('Football analysis started. Predictions will appear progressively as each AI batch completes.');
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start football analysis.');
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <div className="h-full flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-indigo-600" /></div>;

  return (
    <div className="min-h-full bg-slate-50 p-6 md:p-10 w-full">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <div className="flex items-center gap-3">
              <BrainCircuit className="h-8 w-8 text-indigo-600" />
              <h1 className="text-3xl font-extrabold text-slate-900">Analysis Administration</h1>
            </div>
            <p className="mt-2 text-slate-500">Monitor the football data feed, AI providers, database, and automatic analysis cycle.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void loadStatus()} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100"><RefreshCw className="h-4 w-4" />Refresh</button>
            <button onClick={() => void runAnalysis()} disabled={running} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"><Sparkles className="h-4 w-4" />{running ? 'Starting...' : 'Analyze now'}</button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3 mb-8">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <Database className="mb-4 h-6 w-6 text-indigo-600" />
            <h2 className="font-bold text-lg text-slate-900">Database</h2>
            <div className="mt-3 flex items-center gap-2 font-semibold text-slate-700">{health.database ? <CheckCircle2 className="text-emerald-600" /> : <Activity className="text-red-600" />}Neon PostgreSQL {health.database ? 'connected' : 'unavailable'}</div>
          </div>
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <Server className="mb-4 h-6 w-6 text-indigo-600" />
            <h2 className="font-bold text-lg text-slate-900">Football data</h2>
            <div className="mt-3 flex items-center gap-2 font-semibold text-slate-700">{health.footballData ? <CheckCircle2 className="text-emerald-600" /> : <Activity className="text-red-600" />}football-data.org {health.footballData ? 'configured' : 'not configured'}</div>
          </div>
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <BrainCircuit className="mb-4 h-6 w-6 text-indigo-600" />
            <h2 className="font-bold text-lg text-slate-900">AI provider</h2>
            <div className="mt-3 font-semibold text-slate-700">{ai.provider ? String(ai.provider).toUpperCase() : 'Not configured'}</div>
            {ai.model && <div className="mt-1 text-sm text-slate-500">Model: {ai.model}</div>}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5"><Sparkles className="h-5 w-5 text-indigo-600" /><h2 className="text-xl font-bold text-slate-900">Football AI analysis</h2></div>
            <p className="text-sm leading-6 text-slate-600">The analysis engine fetches upcoming football fixtures, processes them in small AI batches, stores completed predictions, and keeps the dashboard populated without betting or bookmaker features.</p>
            <button onClick={() => void runAnalysis()} disabled={running} className="mt-6 w-full rounded-xl bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-700 disabled:opacity-60">{running ? 'Analysis is starting...' : 'Run analysis now'}</button>
            {message && <div className="mt-4 rounded-xl bg-slate-100 p-4 text-sm font-semibold text-slate-700">{message}</div>}
          </section>

          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5"><Activity className="h-5 w-5 text-indigo-600" /><h2 className="text-xl font-bold text-slate-900">Automatic analysis</h2></div>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between gap-4"><span className="text-slate-500">Schedule</span><strong className="text-slate-900">Every {scheduler?.intervalHours || 12} hours</strong></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">Timezone</span><strong className="text-slate-900">{scheduler?.timezone || 'Africa/Kampala'}</strong></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">Last run</span><strong className="text-slate-900">{scheduler?.lastRunAt ? new Date(scheduler.lastRunAt).toLocaleString() : 'Not run yet'}</strong></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">Status</span><strong className="uppercase text-slate-900">{scheduler?.lastRunStatus || 'waiting'}</strong></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">Next run</span><strong className="text-slate-900">{scheduler?.nextRunAt ? new Date(scheduler.nextRunAt).toLocaleString() : 'Not scheduled'}</strong></div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
