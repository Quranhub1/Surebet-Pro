import React, { useEffect, useState } from 'react';
import { Activity, BrainCircuit, CheckCircle2, Clock3, Database, Loader2, Settings as SettingsIcon } from 'lucide-react';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

interface Scheduler { enabled?: boolean; intervalHours?: number; timezone?: string; lastRunAt?: string | null; lastRunStatus?: string | null; nextRunAt?: string | null; }
interface AiConfig { provider?: string; model?: string; configured?: boolean; }

export function Settings() {
  const [loading, setLoading] = useState(true);
  const [scheduler, setScheduler] = useState<Scheduler>({});
  const [ai, setAi] = useState<AiConfig>({});
  const [database, setDatabase] = useState(false);
  const [footballData, setFootballData] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE_URL}/api/health`).then(response => response.json()),
      fetch(`${API_BASE_URL}/api/ai/models`).then(response => response.json()),
      fetch(`${API_BASE_URL}/api/scheduler`).then(response => response.json()),
    ]).then(([health, models, schedule]) => {
      setDatabase(Boolean(health.database));
      setFootballData(Boolean(health.footballData));
      setAi(models.active || {});
      setScheduler(schedule || {});
    }).catch(error => console.error('Error loading analysis settings:', error)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="h-full w-full flex items-center justify-center"><Loader2 className="w-10 h-10 text-indigo-600 animate-spin" /></div>;

  return (
    <div className="min-h-full bg-slate-50 p-6 md:p-10 w-full">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex items-center gap-4 mb-2">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center border border-indigo-100 shadow-sm"><SettingsIcon className="w-6 h-6 text-indigo-600" /></div>
          <h1 className="text-3xl font-extrabold text-slate-900">Analysis Settings</h1>
        </div>
        <p className="text-slate-500 text-sm font-medium mb-10 ml-16">View the configuration and health of the football prediction analysis system.</p>

        <div className="grid gap-6 md:grid-cols-3 mb-8">
          <div className="rounded-2xl border bg-white p-6 shadow-sm"><BrainCircuit className="w-6 h-6 text-indigo-600 mb-4" /><div className="text-sm text-slate-500">AI provider</div><div className="mt-1 text-xl font-extrabold text-slate-900">{ai.provider ? String(ai.provider).toUpperCase() : 'Not configured'}</div>{ai.model && <div className="mt-1 text-xs text-slate-500">{ai.model}</div>}</div>
          <div className="rounded-2xl border bg-white p-6 shadow-sm"><Database className="w-6 h-6 text-indigo-600 mb-4" /><div className="text-sm text-slate-500">Database</div><div className="mt-2 flex items-center gap-2 font-bold text-slate-900">{database ? <CheckCircle2 className="text-emerald-600" /> : <Activity className="text-red-600" />}{database ? 'Connected' : 'Unavailable'}</div></div>
          <div className="rounded-2xl border bg-white p-6 shadow-sm"><Activity className="w-6 h-6 text-indigo-600 mb-4" /><div className="text-sm text-slate-500">Football data</div><div className="mt-2 flex items-center gap-2 font-bold text-slate-900">{footballData ? <CheckCircle2 className="text-emerald-600" /> : <Activity className="text-red-600" />}{footballData ? 'Configured' : 'Unavailable'}</div></div>
        </div>

        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6"><Clock3 className="w-5 h-5 text-indigo-600" /><div><h2 className="text-xl font-bold text-slate-900">Automatic analysis schedule</h2><p className="text-sm text-slate-500 mt-1">Analysis runs automatically and keeps the prediction dashboard refreshed.</p></div></div>
          <div className="divide-y divide-slate-100">
            <div className="flex justify-between gap-4 py-4"><span className="text-slate-500">Automatic analysis</span><strong className="text-slate-900">{scheduler.enabled === false ? 'Disabled' : 'Enabled'}</strong></div>
            <div className="flex justify-between gap-4 py-4"><span className="text-slate-500">Frequency</span><strong className="text-slate-900">Every {scheduler.intervalHours || 12} hours</strong></div>
            <div className="flex justify-between gap-4 py-4"><span className="text-slate-500">Timezone</span><strong className="text-slate-900">{scheduler.timezone || 'Africa/Kampala'}</strong></div>
            <div className="flex justify-between gap-4 py-4"><span className="text-slate-500">Last analysis</span><strong className="text-slate-900">{scheduler.lastRunAt ? new Date(scheduler.lastRunAt).toLocaleString() : 'Not run yet'}</strong></div>
            <div className="flex justify-between gap-4 py-4"><span className="text-slate-500">Last status</span><strong className="uppercase text-slate-900">{scheduler.lastRunStatus || 'Waiting'}</strong></div>
            <div className="flex justify-between gap-4 py-4"><span className="text-slate-500">Next analysis</span><strong className="text-slate-900">{scheduler.nextRunAt ? new Date(scheduler.nextRunAt).toLocaleString() : 'Not scheduled'}</strong></div>
          </div>
        </section>
      </div>
    </div>
  );
}
