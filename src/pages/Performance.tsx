import React, { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, Brain, CheckCircle2, Gauge, RefreshCw, Search, Target, Users, XCircle } from 'lucide-react';
import { getAuthToken } from '../contexts/AuthContext';

interface Item {
  id: string; league: string; homeTeam: string; awayTeam: string; startTime: string;
  winner: string | null; confidence: number | null; predictedHomeGoals: number | null; predictedAwayGoals: number | null;
  actualHomeScore: number | null; actualAwayScore: number | null; predictionResult: 'true' | 'lose' | 'pending' | null;
  aiProvider: 'gemini' | 'groq' | null; aiModel: string | null;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const headers = () => ({ Authorization: `Bearer ${getAuthToken() || ''}` });
const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function Performance() {
  const today = useMemo(() => new Date(), []);
  const initialFrom = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() - 89); return dateKey(d); }, [today]);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(dateKey(today));
  const [items, setItems] = useState<Item[]>([]);
  const [teamQuery, setTeamQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (manual = false) => {
    manual ? setRefreshing(true) : setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/football/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&ts=${Date.now()}`, { cache: 'no-store', headers: headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load performance data.');
      setItems(Array.isArray(payload.items) ? payload.items : []); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load performance data.'); }
    finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { load(); }, []);

  const settled = useMemo(() => items.filter(i => i.predictionResult === 'true' || i.predictionResult === 'lose'), [items]);
  const correct = settled.filter(i => i.predictionResult === 'true').length;
  const accuracy = settled.length ? correct / settled.length * 100 : 0;

  const providers = useMemo(() => (['gemini', 'groq'] as const).map(provider => {
    const rows = settled.filter(i => i.aiProvider === provider); const wins = rows.filter(i => i.predictionResult === 'true').length;
    const avgConfidence = rows.length ? rows.reduce((s, i) => s + (i.confidence ?? 0), 0) / rows.length : 0;
    return { provider, total: rows.length, correct: wins, accuracy: rows.length ? wins / rows.length * 100 : 0, avgConfidence };
  }), [settled]);

  const confidence = useMemo(() => [
    { label: '0–59%', min: 0, max: 59 }, { label: '60–69%', min: 60, max: 69 }, { label: '70–79%', min: 70, max: 79 }, { label: '80–89%', min: 80, max: 89 }, { label: '90–100%', min: 90, max: 100 },
  ].map(b => { const rows = settled.filter(i => (i.confidence ?? 0) >= b.min && (i.confidence ?? 0) <= b.max); const wins = rows.filter(i => i.predictionResult === 'true').length; return { ...b, total: rows.length, accuracy: rows.length ? wins / rows.length * 100 : 0 }; }), [settled]);

  const categories = useMemo(() => (['home', 'draw', 'away'] as const).map(category => {
    const rows = settled.filter(i => category === 'home' ? i.winner === i.homeTeam : category === 'away' ? i.winner === i.awayTeam : i.winner === 'draw');
    const wins = rows.filter(i => i.predictionResult === 'true').length;
    return { category, total: rows.length, correct: wins, accuracy: rows.length ? wins / rows.length * 100 : 0 };
  }), [settled]);

  const daily = useMemo(() => {
    const map = new Map<string, { total: number; correct: number }>();
    settled.forEach(i => { const key = dateKey(new Date(i.startTime)); const v = map.get(key) || { total: 0, correct: 0 }; v.total++; if (i.predictionResult === 'true') v.correct++; map.set(key, v); });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-30).map(([date, v]) => ({ date, ...v, accuracy: v.correct / v.total * 100 }));
  }, [settled]);

  const teams = useMemo(() => {
    const map = new Map<string, { games: number; wins: number; draws: number; losses: number; gf: number; ga: number }>();
    items.forEach(i => {
      if (i.actualHomeScore == null || i.actualAwayScore == null) return;
      const add = (team: string, gf: number, ga: number, result: 'w'|'d'|'l') => { const v = map.get(team) || { games: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 }; v.games++; v.gf += gf; v.ga += ga; v[result === 'w' ? 'wins' : result === 'd' ? 'draws' : 'losses']++; map.set(team, v); };
      const outcome = i.actualHomeScore! > i.actualAwayScore! ? ['w','l'] : i.actualHomeScore! < i.actualAwayScore! ? ['l','w'] : ['d','d'];
      add(i.homeTeam, i.actualHomeScore!, i.actualAwayScore!, outcome[0] as 'w'|'d'|'l'); add(i.awayTeam, i.actualAwayScore!, i.actualHomeScore!, outcome[1] as 'w'|'d'|'l');
    });
    return Array.from(map.entries()).map(([team, v]) => ({ team, ...v, winRate: v.games ? v.wins / v.games * 100 : 0, goalDiff: v.gf - v.ga })).sort((a,b) => b.games - a.games || b.winRate - a.winRate);
  }, [items]);
  const filteredTeams = teams.filter(t => t.team.toLowerCase().includes(teamQuery.toLowerCase())).slice(0, 12);

  const calibrationScore = confidence.filter(b => b.total).reduce((s, b) => s + Math.abs(b.accuracy - ((b.min + b.max) / 2)) * b.total, 0);
  const calibrationLabel = !settled.length ? 'Not enough settled matches' : calibrationScore / settled.length < 10 ? 'Well calibrated' : calibrationScore / settled.length < 20 ? 'Moderately calibrated' : 'Needs calibration';
  const lessons = useMemo(() => {
    const high = settled.filter(i => (i.confidence ?? 0) >= 80); const highMiss = high.filter(i => i.predictionResult === 'lose').length;
    const home = categories.find(c => c.category === 'home'); const away = categories.find(c => c.category === 'away'); const draw = categories.find(c => c.category === 'draw');
    const out: string[] = [];
    if (high.length && highMiss / high.length > 0.35) out.push(`High-confidence calls are missing ${(highMiss / high.length * 100).toFixed(0)}% of the time. The model should be more conservative above 80%.`);
    if (home?.total && home.accuracy < 50) out.push('Home-win predictions are underperforming. Treat home advantage as evidence, not a conclusion.');
    if (away?.total && away.accuracy < 50) out.push('Away-win predictions are underperforming. Away calls need stronger supporting evidence.');
    if (draw?.total && draw.accuracy < 35) out.push('Draw predictions are weak in this sample. Require stronger evidence before selecting draw.');
    if (!out.length) out.push('No major failure pattern detected in the selected period. Keep collecting settled results before changing prompts.');
    return out;
  }, [settled, categories]);

  return <div className="min-h-screen bg-[#0a0a0a] text-white p-6 md:p-10"><div className="mx-auto w-full max-w-7xl">
    <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-3 mb-2"><div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#39FF14]/20 bg-[#39FF14]/10"><BarChart3 className="h-6 w-6 text-[#39FF14]" /></div><h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">AI Performance</h1></div><p className="max-w-3xl text-sm text-[#8b8d93] md:text-base">Accuracy, calibration, provider comparison, prediction categories, team intelligence and failure feedback. Finally, an AI gets a report card.</p></div><div className="flex flex-wrap items-end gap-2"><label className="text-xs text-[#8b8d93]">From<input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)} className="mt-1 block rounded-xl border border-[#2c2e33] bg-[#161618] px-3 py-2 text-sm text-white" /></label><label className="text-xs text-[#8b8d93]">To<input type="date" value={to} min={from} max={dateKey(today)} onChange={e=>setTo(e.target.value)} className="mt-1 block rounded-xl border border-[#2c2e33] bg-[#161618] px-3 py-2 text-sm text-white" /></label><button onClick={()=>load(true)} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl bg-[#39FF14] px-4 py-2.5 text-sm font-bold text-black"><RefreshCw className={`h-4 w-4 ${refreshing?'animate-spin':''}`} />Refresh</button></div></header>
    {loading ? <div className="rounded-2xl border border-[#2c2e33] bg-[#111113] p-12 text-center text-[#8b8d93]">Loading performance...</div> : error ? <div className="rounded-2xl border border-red-500/20 bg-[#111113] p-10 text-center text-red-300">{error}</div> : <>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-8"><Metric icon={<Target/>} label="Settled" value={settled.length.toString()} /><Metric icon={<CheckCircle2/>} label="Correct" value={correct.toString()} /><Metric icon={<Gauge/>} label="Accuracy" value={`${accuracy.toFixed(1)}%`} /><Metric icon={<Brain/>} label="Calibration" value={calibrationLabel}/></section>
      <div className="grid gap-5 lg:grid-cols-2 mb-5"><Panel title="Gemini vs Groq" icon={<Brain/>}><div className="space-y-4">{providers.map(p=><div key={p.provider}><div className="mb-1 flex justify-between text-sm"><span className="font-bold uppercase">{p.provider}</span><span className="text-[#8b8d93]">{p.correct}/{p.total} · {p.accuracy.toFixed(1)}% · avg confidence {p.avgConfidence.toFixed(0)}%</span></div><div className="h-2 rounded-full bg-[#222]"><div className="h-2 rounded-full bg-[#39FF14]" style={{width:`${clamp(p.accuracy,0,100)}%`}}/></div></div>)}{providers.every(p=>!p.total)&&<p className="text-sm text-[#8b8d93]">No settled provider results in this range.</p>}</div></Panel>
      <Panel title="Confidence calibration" icon={<Gauge/>}><div className="space-y-3">{confidence.map(b=><div key={b.label} className="grid grid-cols-[55px_1fr_70px] items-center gap-3 text-sm"><span>{b.label}</span><div className="h-2 rounded-full bg-[#222]"><div className="h-2 rounded-full bg-white" style={{width:`${clamp(b.accuracy,0,100)}%`}}/></div><span className="text-right text-[#8b8d93]">{b.total ? `${b.accuracy.toFixed(0)}%` : '—'}</span></div>)}<p className="pt-2 text-xs text-[#8b8d93]">Calibration compares realised accuracy with the confidence band. High confidence with low accuracy is a warning, not a personality trait.</p></div></Panel></div>
      <div className="grid gap-5 lg:grid-cols-2 mb-5"><Panel title="Prediction categories" icon={<Activity/>}><div className="grid grid-cols-3 gap-2">{categories.map(c=><div key={c.category} className="rounded-xl border border-[#2c2e33] bg-[#161618] p-3 text-center"><p className="text-xs uppercase text-[#777]">{c.category}</p><p className="mt-1 text-xl font-extrabold">{c.accuracy.toFixed(0)}%</p><p className="text-xs text-[#777]">{c.correct}/{c.total}</p></div>)}</div></Panel>
      <Panel title="Daily accuracy · last 30 active days" icon={<BarChart3/>}><div className="flex h-28 items-end gap-1">{daily.map(d=><div key={d.date} title={`${d.date}: ${d.accuracy.toFixed(1)}%`} className="flex-1 rounded-t bg-[#39FF14]/70" style={{height:`${Math.max(4,d.accuracy)}%`}}/>)}{!daily.length&&<p className="text-sm text-[#8b8d93]">No settled matches yet.</p>}</div></Panel></div>
      <Panel title="AI feedback loop" icon={<Brain/>}><div className="grid gap-3 md:grid-cols-3">{lessons.map((lesson,i)=><div key={i} className="rounded-xl border border-[#2c2e33] bg-[#161618] p-4 text-sm leading-6 text-[#bfc1c7]">{lesson}</div>)}</div></Panel>
      <div className="mt-5"><Panel title="Team intelligence" icon={<Users/>}><div className="mb-4 flex items-center gap-2 rounded-xl border border-[#2c2e33] bg-[#161618] px-3"><Search className="h-4 w-4 text-[#777]"/><input value={teamQuery} onChange={e=>setTeamQuery(e.target.value)} placeholder="Search a team" className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-[#666]"/></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-[#666]"><tr><th className="pb-2">Team</th><th>Games</th><th>W-D-L</th><th>Win rate</th><th>Goals</th><th>Diff</th></tr></thead><tbody>{filteredTeams.map(t=><tr key={t.team} className="border-t border-[#222]"><td className="py-3 font-semibold">{t.team}</td><td>{t.games}</td><td>{t.wins}-{t.draws}-{t.losses}</td><td>{t.winRate.toFixed(0)}%</td><td>{t.gf}-{t.ga}</td><td className={t.goalDiff>=0?'text-[#39FF14]':'text-red-300'}>{t.goalDiff>0?'+':''}{t.goalDiff}</td></tr>)}{!filteredTeams.length&&<tr><td colSpan={6} className="py-8 text-center text-[#777]">No team data in this range.</td></tr>}</tbody></table></div></Panel></div>
    </>}
  </div></div>;
}

function Metric({icon,label,value}:{icon:React.ReactNode;label:string;value:string}){return <div className="rounded-2xl border border-[#2c2e33] bg-[#111113] p-4"><div className="mb-2 flex items-center gap-2 text-[#39FF14]">{React.cloneElement(icon as React.ReactElement,{className:'h-4 w-4'})}<span className="text-xs text-[#8b8d93]">{label}</span></div><p className="text-xl font-extrabold md:text-2xl">{value}</p></div>}
function Panel({title,icon,children}:{title:string;icon:React.ReactNode;children:React.ReactNode}){return <section className="rounded-2xl border border-[#2c2e33] bg-[#111113] p-5"><div className="mb-4 flex items-center gap-2"><span className="text-[#39FF14]">{React.cloneElement(icon as React.ReactElement,{className:'h-5 w-5'})}</span><h2 className="font-bold">{title}</h2></div>{children}</section>}
