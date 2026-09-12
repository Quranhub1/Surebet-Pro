import React, { useEffect, useState } from 'react';
import { Activity, BrainCircuit, CheckCircle2, Clock3, Database, Loader2, RefreshCw, Server, Sparkles, UserCheck, Ban, Trash2, ShieldCheck } from 'lucide-react';
import { getAuthToken } from '../contexts/AuthContext';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const STAFF_ROLES = new Set(['ADMIN', 'SUPERADMIN', 'OWNER']);
const PLAN_LABELS: Record<string, string> = {
  weekly: 'Weekly • UGX 5,000 • 7 days',
  monthly: 'Monthly • UGX 15,000 • 30 days',
  annual: 'Annual • UGX 200,000 • 365 days',
};

interface HealthState { database: boolean; footballData: boolean; }
interface AiConfig { provider?: string; model?: string; configured?: boolean; }
interface SchedulerState { enabled: boolean; intervalHours: number; timezone: string; lastRunAt: string | null; lastRunStatus: string | null; nextRunAt: string | null; }
interface Subscription { id: string; user_id: string; name: string; email: string; role: string; plan: string; status: string; requested_at: string | null; approved_at: string | null; expires_at: string | null; }

export function Admin() {
  const [health, setHealth] = useState<HealthState>({ database: false, footballData: false });
  const [ai, setAi] = useState<AiConfig>({});
  const [scheduler, setScheduler] = useState<SchedulerState | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [subLoading, setSubLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [actionId, setActionId] = useState('');
  const [message, setMessage] = useState('');

  const headers = () => ({ Authorization: `Bearer ${getAuthToken()}` });

  const loadSubscriptions = async () => {
    setSubLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/subscriptions`, { headers: headers() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load subscription requests.');
      setSubscriptions(data.subscriptions || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load subscription requests.');
    } finally {
      setSubLoading(false);
    }
  };

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

  useEffect(() => { void loadStatus(); void loadSubscriptions(); }, []);

  const runAnalysis = async () => {
    setRunning(true); setMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/football/analyze-now`, { method: 'POST', headers: headers() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to start football analysis.');
      setMessage('Football analysis started. Predictions will appear progressively as each AI batch completes.');
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start football analysis.');
    } finally { setRunning(false); }
  };

  const action = async (id: string, type: 'approve' | 'ban' | 'delete') => {
    setActionId(id); setMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/subscriptions/${id}/${type === 'delete' ? '' : type}`, { method: type === 'delete' ? 'DELETE' : 'POST', headers: headers() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `${type} failed.`);
      setMessage(type === 'approve' ? 'Subscription approved.' : type === 'ban' ? 'Subscription banned.' : 'Subscription removed and blocked.');
      await loadSubscriptions();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Subscription action failed.');
    } finally { setActionId(''); }
  };

  if (loading) return <div className="h-full flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-indigo-600" /></div>;

  const staff = subscriptions.filter(sub => STAFF_ROLES.has(String(sub.role || '').toUpperCase()));
  const userRequests = subscriptions.filter(sub => !STAFF_ROLES.has(String(sub.role || '').toUpperCase()));
  const pending = userRequests.filter(sub => sub.status === 'pending');

  return (
    <div className="min-h-full bg-slate-50 p-6 md:p-10 w-full">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div><div className="flex items-center gap-3"><BrainCircuit className="h-8 w-8 text-indigo-600" /><h1 className="text-3xl font-extrabold text-slate-900">Admin Dashboard</h1></div><p className="mt-2 text-slate-500">Manage user subscription requests and monitor the football AI analysis system.</p></div>
          <div className="flex gap-2"><button onClick={() => { void loadStatus(); void loadSubscriptions(); }} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100"><RefreshCw className="h-4 w-4" />Refresh</button><button onClick={() => void runAnalysis()} disabled={running} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"><Sparkles className="h-4 w-4" />{running ? 'Starting...' : 'Analyze now'}</button></div>
        </div>

        <div className="grid gap-6 md:grid-cols-3 mb-8">
          <div className="rounded-2xl border bg-white p-6 shadow-sm"><Database className="mb-4 h-6 w-6 text-indigo-600" /><h2 className="font-bold text-lg text-slate-900">Database</h2><div className="mt-3 flex items-center gap-2 font-semibold text-slate-700">{health.database ? <CheckCircle2 className="text-emerald-600" /> : <Activity className="text-red-600" />}Neon PostgreSQL {health.database ? 'connected' : 'unavailable'}</div></div>
          <div className="rounded-2xl border bg-white p-6 shadow-sm"><Server className="mb-4 h-6 w-6 text-indigo-600" /><h2 className="font-bold text-lg text-slate-900">Football data</h2><div className="mt-3 flex items-center gap-2 font-semibold text-slate-700">{health.footballData ? <CheckCircle2 className="text-emerald-600" /> : <Activity className="text-red-600" />}football-data.org {health.footballData ? 'configured' : 'not configured'}</div></div>
          <div className="rounded-2xl border bg-white p-6 shadow-sm"><BrainCircuit className="mb-4 h-6 w-6 text-indigo-600" /><h2 className="font-bold text-lg text-slate-900">AI provider</h2><div className="mt-3 font-semibold text-slate-700">{ai.provider ? String(ai.provider).toUpperCase() : 'Not configured'}</div>{ai.model && <div className="mt-1 text-sm text-slate-500">Model: {ai.model}</div>}</div>
        </div>

        <section className="rounded-2xl border bg-white p-6 shadow-sm mb-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-6"><div><h2 className="text-xl font-bold text-slate-900">User subscription requests</h2><p className="text-sm text-slate-500 mt-1">Only normal user accounts use payment requests. Approve a pending request after payment is confirmed.</p></div><div className="rounded-full bg-amber-50 px-3 py-1 text-sm font-bold text-amber-700">{pending.length} pending</div></div>
          {subLoading ? <div className="py-10 text-center"><Loader2 className="mx-auto w-8 h-8 animate-spin text-indigo-600" /></div> : userRequests.length === 0 ? <div className="rounded-xl border border-dashed py-10 text-center text-slate-500">No user subscription requests yet.</div> : <div className="space-y-3">{userRequests.map(sub => <div key={sub.id} className="rounded-xl border p-4"><div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><div className="font-bold text-slate-900">{sub.name}</div><div className="text-sm text-slate-500">{sub.email}</div><div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-full px-2 py-1 font-bold uppercase ${sub.status === 'pending' ? 'bg-amber-100 text-amber-800' : sub.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{sub.status}</span><span className="rounded-full bg-indigo-50 px-2 py-1 font-bold text-indigo-700">{PLAN_LABELS[sub.plan] || PLAN_LABELS.monthly}</span>{sub.requested_at && <span className="flex items-center gap-1 text-slate-500"><Clock3 className="w-3 h-3" />Requested {new Date(sub.requested_at).toLocaleString()}</span>}{sub.expires_at && <span className="text-slate-500">Expires {new Date(sub.expires_at).toLocaleDateString()}</span>}</div></div><div className="flex flex-wrap gap-2">{sub.status === 'pending' && <button disabled={actionId === sub.id} onClick={() => void action(sub.id, 'approve')} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white"><UserCheck className="w-4 h-4" />Approve</button>}{sub.status !== 'banned' && <button disabled={actionId === sub.id} onClick={() => void action(sub.id, 'ban')} className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-white"><Ban className="w-4 h-4" />Ban</button>}<button disabled={actionId === sub.id} onClick={() => void action(sub.id, 'delete')} className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white"><Trash2 className="w-4 h-4" />Remove</button></div></div></div>)}</div>}
        </section>

        <section className="rounded-2xl border bg-white p-6 shadow-sm mb-8"><div className="flex items-center gap-3 mb-5"><ShieldCheck className="h-6 w-6 text-indigo-600" /><div><h2 className="text-xl font-bold text-slate-900">Administrator access</h2><p className="text-sm text-slate-500 mt-1">ADMIN, SUPERADMIN, and OWNER accounts are permanently active and never require payment approval.</p></div></div>{staff.length === 0 ? <div className="text-sm text-slate-500">No administrator accounts are present in the subscription records.</div> : <div className="grid gap-3 md:grid-cols-2">{staff.map(sub => <div key={sub.id} className="rounded-xl border p-4"><div className="font-bold text-slate-900">{sub.name}</div><div className="text-sm text-slate-500">{sub.email}</div><div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-indigo-50 px-2 py-1 font-bold text-indigo-700">{String(sub.role).toUpperCase()}</span><span className="rounded-full bg-emerald-100 px-2 py-1 font-bold text-emerald-800">PERMANENT ACTIVE</span></div></div>)}</div>}</section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex items-center gap-3 mb-5"><Sparkles className="h-5 w-5 text-indigo-600" /><h2 className="text-xl font-bold text-slate-900">Football AI analysis</h2></div><p className="text-sm leading-6 text-slate-600">The analysis engine fetches upcoming football fixtures, processes them in small AI batches, stores completed predictions, and keeps the dashboard populated.</p><button onClick={() => void runAnalysis()} disabled={running} className="mt-6 w-full rounded-xl bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-700 disabled:opacity-60">{running ? 'Analysis is starting...' : 'Run analysis now'}</button>{message && <div className="mt-4 rounded-xl bg-slate-100 p-4 text-sm font-semibold text-slate-700">{message}</div>}</section>
          <section className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex items-center gap-3 mb-5"><Activity className="h-5 w-5 text-indigo-600" /><h2 className="text-xl font-bold text-slate-900">Automatic analysis</h2></div><div className="space-y-4 text-sm"><div className="flex justify-between gap-4"><span className="text-slate-500">Schedule</span><strong className="text-slate-900">Every {scheduler?.intervalHours || 12} hours</strong></div><div className="flex justify-between gap-4"><span className="text-slate-500">Timezone</span><strong className="text-slate-900">{scheduler?.timezone || 'Africa/Kampala'}</strong></div><div className="flex justify-between gap-4"><span className="text-slate-500">Last run</span><strong className="text-slate-900">{scheduler?.lastRunAt ? new Date(scheduler.lastRunAt).toLocaleString() : 'Not run yet'}</strong></div><div className="flex justify-between gap-4"><span className="text-slate-500">Status</span><strong className="uppercase text-slate-900">{scheduler?.lastRunStatus || 'waiting'}</strong></div><div className="flex justify-between gap-4"><span className="text-slate-500">Next run</span><strong className="text-slate-900">{scheduler?.nextRunAt ? new Date(scheduler.nextRunAt).toLocaleString() : 'Not scheduled'}</strong></div></div></section>
        </div>
      </div>
    </div>
  );
}
