import { useEffect, useMemo, useState } from 'react';
import { Activity, Brain, Database, History, RefreshCw, ShieldCheck, Target } from 'lucide-react';

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('surebet_token') || ''}` });

export function Analytics() {
  const [data, setData] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  async function load() {
    setLoading(true);
    const headers = authHeaders();
    const [analytics, system] = await Promise.all([
      fetch(`/api/football/analytics?from=${from}&to=${to}`, { headers, cache: 'no-store' }),
      fetch('/api/system/health', { headers, cache: 'no-store' }),
    ]);
    if (analytics.ok) setData(await analytics.json());
    if (system.ok) setHealth(await system.json());
    setLoading(false);
  }

  useEffect(() => { void load(); }, [from, to]);

  const lessons = useMemo(() => (data?.calibration || [])
    .filter((band: any) => band.total >= 3 && band.correct / band.total < 0.5)
    .map((band: any) => `The ${band.band}% confidence band is underperforming at ${Math.round(100 * band.correct / band.total)}%. Treat this band as overconfident.`), [data]);

  return <div className="space-y-6 p-5 md:p-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-[#39FF14]">Prediction intelligence</p><h1 className="text-3xl font-bold text-white">Analytics & audit</h1><p className="mt-1 text-sm text-slate-400">Calibration, provider performance, prediction changes and system health.</p></div>
      <div className="flex gap-2"><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" /><input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" /><button onClick={() => void load()} className="rounded-lg border border-slate-700 p-2 text-slate-300"><RefreshCw size={17} /></button></div>
    </div>
    {loading && !data ? <div className="text-slate-400">Loading analytics...</div> : <>
      <div className="grid gap-4 md:grid-cols-4">{[[Target, 'Settled', (data?.overall?.correct || 0) + (data?.overall?.failed || 0)], [Brain, 'Accuracy', `${Math.round(100 * (data?.overall?.correct || 0) / Math.max(1, (data?.overall?.correct || 0) + (data?.overall?.failed || 0)))}%`], [Activity, 'Prediction changes', data?.audit?.prediction_changes || 0], [Database, 'Pending settlement', health?.pendingSettlement || 0]].map(([Icon, label, value]: any) => <div className="rounded-xl border border-slate-800 bg-slate-900 p-4" key={label}><Icon size={18} className="text-[#39FF14]" /><div className="mt-3 text-xs text-slate-500">{label}</div><div className="text-2xl font-bold text-white">{value}</div></div>)}</div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="mb-4 font-semibold text-white">Provider leaderboard</h2>{(data?.providers || []).map((provider: any) => <div className="mb-3 flex items-center justify-between rounded-lg bg-slate-950 p-3" key={provider.provider}><div><div className="font-medium text-white">{provider.provider || 'unknown'}</div><div className="text-xs text-slate-500">{provider.total} predictions · average confidence {Number(provider.avg_confidence || 0).toFixed(1)}%</div></div><div className="text-lg font-bold text-[#39FF14]">{Math.round(100 * provider.correct / Math.max(1, provider.correct + provider.failed))}%</div></div>)}</section>
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="mb-4 font-semibold text-white">Confidence calibration</h2>{(data?.calibration || []).map((band: any) => <div className="mb-3" key={band.band}><div className="mb-1 flex justify-between text-xs text-slate-400"><span>{band.band}%</span><span>{band.correct}/{band.total} correct</span></div><div className="h-2 overflow-hidden rounded bg-slate-800"><div className="h-full rounded bg-[#39FF14]" style={{ width: `${100 * band.correct / Math.max(1, band.total)}%` }} /></div></div>)}</section>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="mb-4 flex items-center gap-2 font-semibold text-white"><ShieldCheck size={17} /> AI feedback loop</h2>{lessons.length ? lessons.map((lesson: string) => <div className="mb-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200" key={lesson}>{lesson}</div>) : <div className="text-sm text-slate-400">No statistically meaningful calibration warnings in this range.</div>}</section>
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="mb-4 flex items-center gap-2 font-semibold text-white"><History size={17} /> Audit trail</h2><div className="text-sm text-slate-400">{data?.audit?.audit_events || 0} audit events recorded. Prediction changes are preserved for post-match review.</div><div className="mt-4 text-sm text-slate-300">Analysis: {health?.lastAnalysis?.analysis_last_run_status || 'unknown'} · audit events in 24h: {health?.auditEvents24h || 0}</div></section>
      </div>
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="mb-4 font-semibold text-white">Team intelligence</h2><div className="grid gap-2 md:grid-cols-2">{(data?.teams || []).slice(0, 20).map((team: any) => <div className="flex items-center justify-between rounded-lg bg-slate-950 p-3" key={team.team}><span className="text-sm text-white">{team.team}</span><span className="text-xs text-slate-400">{team.wins}-{team.draws}-{team.losses} · {team.goals_for}:{team.goals_against}</span></div>)}</div></section>
    </>}
  </div>;
}
