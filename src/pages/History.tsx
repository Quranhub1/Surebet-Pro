import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, History as HistoryIcon, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { getAuthToken } from '../contexts/AuthContext';

interface HistoryItem {
  id: string; league: string; homeTeam: string; awayTeam: string; startTime: string;
  winner: string | null; advice: string | null; analysis: string | null;
  confidence: number | null; predictedHomeGoals: number | null; predictedAwayGoals: number | null;
  actualHomeScore: number | null; actualAwayScore: number | null;
  predictionResult: 'true' | 'lose' | 'pending' | null; settledAt: string | null;
  aiProvider: 'gemini' | 'groq' | null; aiModel: string | null;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const authHeaders = () => ({ Authorization: `Bearer ${getAuthToken() || ''}` });
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export function History() {
  const today = useMemo(() => new Date(), []);
  const initialFrom = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() - 29); return isoDate(d); }, [today]);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(isoDate(today));
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [summary, setSummary] = useState({ total: 0, correct: 0, failed: 0, pending: 0, accuracy: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = async (manual = false) => {
    if (manual) setRefreshing(true); else setLoading(true);
    try {
      if (from > to) throw new Error('The From date cannot be after the To date.');
      const response = await fetch(`${API_BASE_URL}/api/football/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&ts=${Date.now()}`, { cache: 'no-store', headers: authHeaders() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `History returned ${response.status}`);
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setSummary(payload.summary || { total: 0, correct: 0, failed: 0, pending: 0, accuracy: 0 });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load prediction history.');
    } finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { loadHistory(); }, []);

  const grouped = useMemo(() => {
    const groups = new Map<string, HistoryItem[]>();
    items.forEach(item => { const key = new Date(item.startTime).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); const existing = groups.get(key) || []; existing.push(item); groups.set(key, existing); });
    return Array.from(groups.entries());
  }, [items]);

  const resultLabel = (item: HistoryItem) => item.predictionResult === 'true' ? 'TRUE' : item.predictionResult === 'lose' ? 'LOSE' : 'PENDING';
  const resultIcon = (item: HistoryItem) => item.predictionResult === 'true' ? <CheckCircle2 className="h-5 w-5 text-[#39FF14]" /> : item.predictionResult === 'lose' ? <XCircle className="h-5 w-5 text-red-400" /> : <Loader2 className="h-5 w-5 animate-spin text-yellow-400" />;

  return <div className="min-h-screen bg-[#0a0a0a] text-white p-6 md:p-10"><div className="w-full max-w-7xl mx-auto">
    <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-8"><div><div className="flex items-center gap-3 mb-2"><div className="w-11 h-11 rounded-2xl bg-[#39FF14]/10 border border-[#39FF14]/20 flex items-center justify-center"><HistoryIcon className="w-6 h-6 text-[#39FF14]" /></div><h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Prediction History</h1></div><p className="text-[#8b8d93] text-sm md:text-base max-w-2xl">Every AI prediction is kept with its final match result, so accuracy can be checked instead of relying on the ancient human tradition of selective memory.</p></div><div className="flex flex-col sm:flex-row gap-2"><label className="text-xs text-[#8b8d93]">From<input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="mt-1 block rounded-xl border border-[#2c2e33] bg-[#161618] px-3 py-2 text-sm text-white outline-none focus:border-[#39FF14]" /></label><label className="text-xs text-[#8b8d93]">To<input type="date" value={to} min={from} max={isoDate(today)} onChange={e => setTo(e.target.value)} className="mt-1 block rounded-xl border border-[#2c2e33] bg-[#161618] px-3 py-2 text-sm text-white outline-none focus:border-[#39FF14]" /></label><button type="button" onClick={() => loadHistory(true)} disabled={refreshing} className="self-end inline-flex items-center justify-center gap-2 rounded-xl bg-[#39FF14] px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50"><CalendarDays className="h-4 w-4" />Apply</button></div></header>

    <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8"><div className="rounded-2xl border border-[#2c2e33] bg-[#111113] p-4"><p className="text-xs text-[#8b8d93]">Analysed games</p><p className="mt-1 text-2xl font-extrabold">{summary.total}</p></div><div className="rounded-2xl border border-[#39FF14]/20 bg-[#39FF14]/5 p-4"><p className="text-xs text-[#8b8d93]">Correct</p><p className="mt-1 text-2xl font-extrabold text-[#39FF14]">{summary.correct}</p></div><div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4"><p className="text-xs text-[#8b8d93]">Failed</p><p className="mt-1 text-2xl font-extrabold text-red-300">{summary.failed}</p></div><div className="rounded-2xl border border-[#2c2e33] bg-[#111113] p-4"><p className="text-xs text-[#8b8d93]">Accuracy</p><p className="mt-1 text-2xl font-extrabold">{summary.accuracy.toFixed(1)}%</p></div></section>

    {loading ? <div className="rounded-2xl border border-[#2c2e33] bg-[#111113] p-12 flex items-center justify-center gap-3 text-sm text-[#8b8d93]"><Loader2 className="h-5 w-5 animate-spin" />Loading prediction history...</div> : error ? <div className="rounded-2xl border border-red-500/20 bg-[#111113] p-10 text-center"><p className="text-red-300 mb-4">{error}</p><button type="button" onClick={() => loadHistory(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#39FF14] px-4 py-2 text-sm font-bold text-black"><RefreshCw className="h-4 w-4" />Retry</button></div> : grouped.length === 0 ? <div className="rounded-2xl border border-[#2c2e33] bg-[#111113] p-12 text-center"><HistoryIcon className="h-10 w-10 mx-auto mb-3 text-[#555]" /><p className="font-semibold">No saved predictions in this date range.</p><p className="text-sm text-[#8b8d93] mt-1">AI analyses remain stored in the database even after their 12-hour dashboard visibility window expires.</p></div> : <div className="space-y-8">{grouped.map(([day, dayItems]) => <section key={day}><div className="flex items-center gap-3 mb-3"><h2 className="font-bold text-lg">{day}</h2><span className="text-xs rounded-full border border-[#2c2e33] bg-[#161618] px-2.5 py-1 text-[#8b8d93]">{dayItems.length} games</span></div><div className="space-y-3">{dayItems.map(item => <article key={item.id} className="rounded-2xl border border-[#2c2e33] bg-[#111113] p-5"><div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"><div className="min-w-0"><p className="text-[11px] uppercase tracking-wider text-[#6f727a] mb-1">{item.league} · {new Date(item.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p><h3 className="font-bold text-lg">{item.homeTeam} <span className="text-[#555]">vs</span> {item.awayTeam}</h3><p className="text-sm text-[#8b8d93] mt-1">AI prediction: <span className="font-semibold text-white">{item.winner || 'No winner selected'}</span>{item.predictedHomeGoals !== null && item.predictedAwayGoals !== null ? ` · predicted ${item.predictedHomeGoals}-${item.predictedAwayGoals}` : ''}</p></div><div className="flex items-center gap-5"><div className="text-right"><p className="text-[10px] uppercase tracking-wider text-[#6f727a]">Actual</p><p className="text-xl font-extrabold">{item.actualHomeScore !== null && item.actualAwayScore !== null ? `${item.actualHomeScore} - ${item.actualAwayScore}` : '—'}</p></div><div className="flex items-center gap-2 min-w-[90px]">{resultIcon(item)}<div><p className="text-[10px] uppercase tracking-wider text-[#6f727a]">Prediction</p><p className={`font-extrabold ${item.predictionResult === 'true' ? 'text-[#39FF14]' : item.predictionResult === 'lose' ? 'text-red-300' : 'text-yellow-300'}`}>{resultLabel(item)}</p></div></div></div></div>{item.analysis && <p className="mt-4 rounded-xl bg-[#0d0d0f] border border-[#222] p-3 text-sm leading-6 text-[#bfc1c7]">{item.analysis}</p>}<div className="mt-3 flex flex-wrap gap-3 text-[10px] text-[#6f727a]"><span>{item.confidence !== null ? `Confidence ${item.confidence.toFixed(0)}%` : 'Confidence unavailable'}</span><span>{item.aiProvider ? item.aiProvider.toUpperCase() : 'AI'}</span>{item.aiModel && <span>{item.aiModel}</span>}</div></article>)}</div></section>)}</div>}
  </div></div>;
}
