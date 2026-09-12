import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarClock, CheckCircle2, Filter, History as HistoryIcon, Loader2, Target, Trophy, XCircle } from 'lucide-react';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
type HistoryRow = { id: string; league: string | null; homeTeam: string; awayTeam: string; kickoffAt: string; status: string; predictedWinner: string | null; predictedHomeGoals: number | null; predictedAwayGoals: number | null; confidence: number | null; actualHomeGoals: number | null; actualAwayGoals: number | null; actualResult: string | null; predictionCorrect: boolean | null; scoreCorrect: boolean | null; analysis: string | null; advice: string | null; keyFactors: string[]; aiProvider: string | null; aiModel: string | null; };
type FilterMode = 'all' | 'correct' | 'missed' | 'exact';

const winnerFromScore = (home: number | null, away: number | null) => home == null || away == null ? null : home > away ? 'Home' : home < away ? 'Away' : 'Draw';
const confidenceLabel = (value: number | null) => value == null ? '—' : value >= 75 ? 'High' : value >= 55 ? 'Medium' : 'Low';

export function History() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [provider, setProvider] = useState('all');
  const [league, setLeague] = useState('all');

  const loadHistory = async () => {
    try {
      setError(null);
      const response = await fetch(`${API_BASE_URL}/api/football/history?limit=200`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load analysis history.');
      setRows(Array.isArray(data.history) ? data.history : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analysis history.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void loadHistory(); const timer = window.setInterval(() => void loadHistory(), 5 * 60 * 1000); return () => window.clearInterval(timer); }, []);

  const stats = useMemo(() => {
    const evaluated = rows.filter(row => row.predictionCorrect !== null);
    const correct = evaluated.filter(row => row.predictionCorrect).length;
    const exact = evaluated.filter(row => row.scoreCorrect).length;
    const providers = (['gemini', 'groq'] as const).map(name => {
      const list = evaluated.filter(row => row.aiProvider === name);
      return { provider: name, total: list.length, correct: list.filter(row => row.predictionCorrect).length, exact: list.filter(row => row.scoreCorrect).length, accuracy: list.length ? Math.round(list.filter(row => row.predictionCorrect).length / list.length * 100) : null };
    });
    const leagues = Array.from(new Set(evaluated.map(row => row.league || 'Football'))).map(name => {
      const list = evaluated.filter(row => (row.league || 'Football') === name);
      const wins = list.filter(row => row.predictionCorrect).length;
      return { league: name, total: list.length, accuracy: Math.round(wins / list.length * 100) };
    }).sort((a, b) => b.accuracy - a.accuracy || b.total - a.total).slice(0, 8);
    return { total: rows.length, evaluated: evaluated.length, correct, accuracy: evaluated.length ? Math.round(correct / evaluated.length * 100) : null, exact, providers, leagues };
  }, [rows]);

  const leagues = useMemo(() => Array.from(new Set(rows.map(row => row.league || 'Football'))).sort(), [rows]);
  const filteredRows = useMemo(() => rows.filter(row => {
    const filterMatch = filter === 'all' || (filter === 'correct' && row.predictionCorrect === true) || (filter === 'missed' && row.predictionCorrect === false) || (filter === 'exact' && row.scoreCorrect === true);
    return filterMatch && (provider === 'all' || row.aiProvider === provider) && (league === 'all' || (row.league || 'Football') === league);
  }), [rows, filter, provider, league]);

  return <div className="mx-auto w-full max-w-7xl p-5 pb-16 md:p-8">
    <div className="mb-8 flex items-start justify-between gap-4"><div><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#39FF14]/10 text-[#39FF14]"><HistoryIcon className="h-6 w-6" /></div><h1 className="text-3xl font-extrabold text-white">Analysis History</h1></div><p className="mt-2 text-sm text-gray-400">Predicted results are preserved and evaluated against the actual completed score.</p></div><button onClick={() => void loadHistory()} className="rounded-xl border border-[#333] bg-[#171717] px-4 py-2 text-sm font-bold text-gray-200 hover:bg-[#222]">Refresh</button></div>

    <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">{[['Saved games', stats.total], ['Evaluated', stats.evaluated], ['Winner accuracy', stats.accuracy === null ? '—' : `${stats.accuracy}%`], ['Exact scores', stats.exact]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-[#292929] bg-[#111] p-5"><div className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}</div><div className="mt-2 text-2xl font-black text-white">{value}</div></div>)}</div>

    {stats.evaluated > 0 && <div className="mb-8 grid gap-4 lg:grid-cols-2"><section className="rounded-2xl border border-[#292929] bg-[#111] p-5"><div className="mb-4 flex items-center gap-2"><Trophy className="h-5 w-5 text-[#39FF14]" /><h2 className="font-bold text-white">Gemini vs Groq</h2></div><div className="grid gap-3 sm:grid-cols-2">{stats.providers.map(item => <div key={item.provider} className="rounded-xl border border-[#292929] bg-[#151515] p-4"><div className="flex justify-between"><span className="font-bold capitalize text-white">{item.provider}</span><span className="font-black text-[#39FF14]">{item.accuracy == null ? '—' : `${item.accuracy}%`}</span></div><p className="mt-2 text-xs text-gray-500">{item.total} evaluated · {item.correct} winners · {item.exact} exact</p></div>)}</div></section><section className="rounded-2xl border border-[#292929] bg-[#111] p-5"><div className="mb-4 flex items-center gap-2"><BarChart3 className="h-5 w-5 text-[#39FF14]" /><h2 className="font-bold text-white">League performance</h2></div><div className="space-y-2">{stats.leagues.length ? stats.leagues.map(item => <div key={item.league} className="flex items-center justify-between rounded-lg bg-[#151515] px-3 py-2 text-sm"><span className="truncate text-gray-200">{item.league}</span><span className="font-bold text-[#39FF14]">{item.accuracy}% <span className="text-xs text-gray-500">({item.total})</span></span></div>) : <p className="text-sm text-gray-500">League performance appears after results are evaluated.</p>}</div></section></div>}

    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-[#292929] bg-[#111] p-4"><Filter className="h-4 w-4 text-gray-500" />{(['all', 'correct', 'missed', 'exact'] as FilterMode[]).map(item => <button key={item} onClick={() => setFilter(item)} className={`rounded-lg px-3 py-2 text-xs font-bold capitalize ${filter === item ? 'bg-[#39FF14] text-black' : 'bg-[#1a1a1a] text-gray-300 hover:bg-[#242424]'}`}>{item === 'all' ? 'All games' : item === 'correct' ? 'Correct' : item === 'missed' ? 'Missed' : 'Exact score'}</button>)}<select value={provider} onChange={e => setProvider(e.target.value)} className="rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-2 text-xs font-bold text-gray-300"><option value="all">All providers</option><option value="gemini">Gemini</option><option value="groq">Groq</option></select><select value={league} onChange={e => setLeague(e.target.value)} className="max-w-52 rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-2 text-xs font-bold text-gray-300"><option value="all">All leagues</option>{leagues.map(item => <option key={item} value={item}>{item}</option>)}</select><span className="ml-auto text-xs text-gray-500">Showing {filteredRows.length} of {rows.length}</span></div>

    {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-9 w-9 animate-spin text-[#39FF14]" /></div> : error ? <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-red-300">{error}</div> : filteredRows.length === 0 ? <div className="rounded-2xl border border-[#292929] bg-[#111] p-10 text-center"><CalendarClock className="mx-auto h-10 w-10 text-gray-600" /><h2 className="mt-4 text-lg font-bold text-white">No matching history</h2><p className="mt-2 text-sm text-gray-500">Completed predictions will appear here automatically, with the original prediction preserved.</p></div> : <div className="space-y-4">{filteredRows.map(row => {
      const actualWinner = winnerFromScore(row.actualHomeGoals, row.actualAwayGoals);
      return <article key={row.id} className="overflow-hidden rounded-2xl border border-[#292929] bg-[#111]"><div className="flex flex-col gap-4 border-b border-[#242424] p-5 md:flex-row md:items-center md:justify-between"><div><div className="text-xs font-bold uppercase tracking-wider text-[#39FF14]">{row.league || 'Football'}</div><h2 className="mt-1 text-lg font-extrabold text-white">{row.homeTeam} <span className="text-gray-600">vs</span> {row.awayTeam}</h2><div className="mt-1 text-xs text-gray-500">{new Date(row.kickoffAt).toLocaleString()} · {row.status}</div></div><div className="flex flex-wrap items-center gap-2">{row.predictionCorrect === true ? <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Winner correct</span> : row.predictionCorrect === false ? <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1 text-xs font-bold text-red-400"><XCircle className="h-4 w-4" /> Winner missed</span> : <span className="rounded-full bg-gray-500/10 px-3 py-1 text-xs font-bold text-gray-400">Awaiting result</span>}{row.scoreCorrect && <span className="flex items-center gap-1 rounded-full bg-[#39FF14]/10 px-3 py-1 text-xs font-bold text-[#39FF14]"><Target className="h-4 w-4" /> Exact score</span>}</div></div>
        <div className="grid gap-4 p-5 md:grid-cols-3"><div className="rounded-xl border border-[#292929] bg-[#151515] p-5"><div className="text-xs font-bold uppercase tracking-wider text-gray-500">Predicted</div><div className="mt-3 text-xl font-black text-white">{row.predictedHomeGoals ?? '—'} <span className="text-gray-600">-</span> {row.predictedAwayGoals ?? '—'}</div><div className="mt-1 text-sm text-gray-300">{row.predictedWinner || 'Winner not specified'}</div><div className="mt-3 flex items-center justify-between border-t border-[#292929] pt-3 text-xs text-gray-500"><span>Confidence: <b className="text-gray-300">{row.confidence == null ? '—' : `${row.confidence}%`}</b></span><span>{confidenceLabel(row.confidence)}</span></div></div><div className="rounded-xl border border-[#292929] bg-[#151515] p-5"><div className="text-xs font-bold uppercase tracking-wider text-gray-500">Actual</div><div className="mt-3 text-xl font-black text-white">{row.actualHomeGoals ?? '—'} <span className="text-gray-600">-</span> {row.actualAwayGoals ?? '—'}</div><div className="mt-1 text-sm text-gray-300">{row.actualResult || actualWinner || '—'}</div><div className="mt-3 border-t border-[#292929] pt-3 text-xs text-gray-500">{row.scoreCorrect ? 'Exact score matched' : row.predictionCorrect ? 'Winner correct, score differed' : 'Predicted winner differed from actual result'}</div></div><div className="rounded-xl border border-[#292929] bg-[#151515] p-5"><div className="text-xs font-bold uppercase tracking-wider text-gray-500">AI analysis</div><p className="mt-3 max-h-28 overflow-y-auto text-sm leading-6 text-gray-300">{row.analysis || row.advice || 'No written analysis saved.'}</p><div className="mt-3 border-t border-[#292929] pt-3 text-xs text-gray-500">Provider: <span className="font-bold uppercase text-gray-300">{row.aiProvider || '—'}</span> · Model: {row.aiModel || 'default'}</div></div></div>
        {(row.keyFactors?.length > 0) && <div className="border-t border-[#242424] px-5 pb-5 pt-0"><div className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Key factors used</div><div className="flex flex-wrap gap-2">{row.keyFactors.map((factor, index) => <span key={`${row.id}-${index}`} className="rounded-lg bg-[#191919] px-3 py-1.5 text-xs text-gray-400">{factor}</span>)}</div></div>}
      </article>;
    })}</div>}
  </div>;
}
