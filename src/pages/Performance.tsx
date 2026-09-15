import React, { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, CheckCircle2, Gauge, Target, TrendingUp, XCircle } from 'lucide-react';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
type Row = { homeTeam: string; awayTeam: string; confidence: number | null; predictionCorrect: boolean | null; scoreCorrect: boolean | null; aiProvider: string | null; kickoffAt: string | null; predictedWinner: string | null; actualResult: string | null; predictedHomeGoals: number | null; predictedAwayGoals: number | null; actualHomeGoals: number | null; actualAwayGoals: number | null; analysis: string | null; advice: string | null; };
const pct = (n: number, d: number) => d ? Math.round(n / d * 100) : null;
const winnerFromScore = (home: number | null, away: number | null) => home == null || away == null ? null : home > away ? 'Home' : home < away ? 'Away' : 'Draw';
const winnerName = (home: string, away: string, result: string | null) => result === 'Home' ? home : result === 'Away' ? away : result === 'Draw' ? 'Draw' : null;

function normalizeRow(row: any): Row {
  const predictedHomeGoals = row.predictedHomeGoals == null ? null : Number(row.predictedHomeGoals);
  const predictedAwayGoals = row.predictedAwayGoals == null ? null : Number(row.predictedAwayGoals);
  const actualHomeGoals = row.actualHomeGoals == null ? null : Number(row.actualHomeGoals);
  const actualAwayGoals = row.actualAwayGoals == null ? null : Number(row.actualAwayGoals);
  const predictedResult = winnerFromScore(predictedHomeGoals, predictedAwayGoals);
  const actualResult = row.actualResult || winnerName(row.homeTeam || 'Home', row.awayTeam || 'Away', winnerFromScore(actualHomeGoals, actualAwayGoals));
  const actualResultKey = winnerFromScore(actualHomeGoals, actualAwayGoals);
  const predictionCorrect = row.predictionCorrect != null
    ? Boolean(row.predictionCorrect)
    : predictedResult != null && actualResultKey != null
      ? predictedResult === actualResultKey
      : null;
  const scoreCorrect = row.scoreCorrect != null
    ? Boolean(row.scoreCorrect)
    : predictedHomeGoals != null && predictedAwayGoals != null && actualHomeGoals != null && actualAwayGoals != null
      ? predictedHomeGoals === actualHomeGoals && predictedAwayGoals === actualAwayGoals
      : null;
  return {
    homeTeam: row.homeTeam || 'Home',
    awayTeam: row.awayTeam || 'Away',
    confidence: row.confidence == null ? null : Number(row.confidence),
    predictionCorrect,
    scoreCorrect,
    aiProvider: row.aiProvider === 'gemini' || row.aiProvider === 'groq' ? row.aiProvider : null,
    kickoffAt: row.kickoffAt || row.kickoff || row.startTime || null,
    predictedWinner: row.predictedWinner || winnerName(row.homeTeam || 'Home', row.awayTeam || 'Away', predictedResult),
    actualResult,
    predictedHomeGoals,
    predictedAwayGoals,
    actualHomeGoals,
    actualAwayGoals,
    analysis: row.analysis || null,
    advice: row.advice || null,
  };
}

export function Performance() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPerformance = async () => {
    try {
      setError(null);
      const response = await fetch(`${API_BASE_URL}/api/football/history?limit=5000`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load performance data');
      setRows(Array.isArray(data.history) ? data.history.map(normalizeRow) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPerformance();
    const timer = window.setInterval(() => void loadPerformance(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stats = useMemo(() => {
    const evaluated = rows.filter(r => r.predictionCorrect !== null);
    const correct = evaluated.filter(r => r.predictionCorrect === true).length;
    const exact = evaluated.filter(r => r.scoreCorrect === true).length;
    const bands = [{ label: 'High confidence', min: 75 }, { label: 'Medium confidence', min: 55 }, { label: 'Low confidence', min: 0 }].map((band, i, all) => {
      const max = i === 0 ? 101 : all[i - 1].min;
      const list = evaluated.filter(r => r.confidence != null && r.confidence >= band.min && r.confidence < max);
      const wins = list.filter(r => r.predictionCorrect === true).length;
      return { ...band, total: list.length, correct: wins, accuracy: pct(wins, list.length) };
    });
    const providers = ['gemini', 'groq'].map(provider => {
      const list = evaluated.filter(r => r.aiProvider === provider);
      const wins = list.filter(r => r.predictionCorrect === true).length;
      return { provider, total: list.length, accuracy: pct(wins, list.length), exact: list.filter(r => r.scoreCorrect === true).length };
    });
    const recent = [...evaluated].sort((a, b) => new Date(b.kickoffAt || 0).getTime() - new Date(a.kickoffAt || 0).getTime()).slice(0, 20);
    return { evaluated, correct, exact, accuracy: pct(correct, evaluated.length), bands, providers, recent };
  }, [rows]);

  return <div className="mx-auto w-full max-w-7xl p-5 pb-16 md:p-8">
    <header className="mb-8"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#39FF14]/10 text-[#39FF14]"><BrainCircuit className="h-6 w-6" /></div><div><h1 className="text-3xl font-extrabold text-white">Analysis Performance</h1><p className="mt-1 text-sm text-gray-400">Live metrics calculated from the complete saved analysis history and completed results.</p></div></div></header>
    {loading ? <div className="rounded-2xl border border-[#292929] bg-[#111] p-10 text-center text-gray-400">Loading verified analysis results...</div> : error ? <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-red-300">{error}</div> : <>
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">{[['Evaluated', stats.evaluated.length], ['Winner accuracy', stats.accuracy == null ? '—' : `${stats.accuracy}%`], ['Correct winners', stats.correct], ['Exact scores', stats.exact]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-[#292929] bg-[#111] p-5"><div className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}</div><div className="mt-2 text-2xl font-black text-white">{value}</div></div>)}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-[#292929] bg-[#111] p-5"><div className="mb-5 flex items-center gap-2"><Gauge className="h-5 w-5 text-[#39FF14]" /><h2 className="font-bold">Confidence reliability</h2></div><div className="space-y-3">{stats.bands.map(b => <div key={b.label} className="rounded-xl border border-[#292929] bg-[#151515] p-4"><div className="flex items-center justify-between"><span className="font-semibold text-white">{b.label}</span><span className="font-black text-[#39FF14]">{b.accuracy == null ? 'No data' : `${b.accuracy}%`}</span></div><div className="mt-2 flex justify-between text-xs text-gray-500"><span>{b.total} evaluated</span><span>{b.correct} correct</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#292929]"><div className="h-full rounded-full bg-[#39FF14]" style={{ width: `${b.accuracy || 0}%` }} /></div></div>)}</div></section>
        <section className="rounded-2xl border border-[#292929] bg-[#111] p-5"><div className="mb-5 flex items-center gap-2"><TrendingUp className="h-5 w-5 text-[#39FF14]" /><h2 className="font-bold">AI provider performance</h2></div><div className="grid gap-3 sm:grid-cols-2">{stats.providers.map(p => <div key={p.provider} className="rounded-xl border border-[#292929] bg-[#151515] p-5"><div className="flex justify-between"><span className="font-bold capitalize">{p.provider}</span><span className="text-xl font-black text-[#39FF14]">{p.accuracy == null ? '—' : `${p.accuracy}%`}</span></div><p className="mt-3 text-xs text-gray-500">{p.total} evaluated · {p.exact} exact scores</p></div>)}</div><div className="mt-4 rounded-xl border border-[#39FF14]/20 bg-[#39FF14]/5 p-4 text-xs leading-5 text-gray-400">Provider accuracy is recalculated from the same complete completed-fixture dataset used by History.</div></section>
      </div>
      <section className="mt-4 rounded-2xl border border-[#292929] bg-[#111] p-5"><div className="mb-4 flex items-center gap-2"><Target className="h-5 w-5 text-[#39FF14]" /><h2 className="font-bold">Recent evaluated analyses</h2></div>{stats.recent.length === 0 ? <p className="text-sm text-gray-500">Completed analyses will appear here after results are evaluated.</p> : <div className="space-y-2">{stats.recent.map((r, i) => <div key={`${r.homeTeam}-${r.awayTeam}-${i}`} className="flex flex-col gap-2 rounded-xl border border-[#292929] bg-[#151515] p-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm font-bold text-white">{r.homeTeam} <span className="text-gray-600">vs</span> {r.awayTeam}</div><div className="mt-1 text-xs text-gray-500">Prediction: {r.predictedWinner || '—'} · Confidence: {r.confidence == null ? '—' : `${r.confidence}%`}</div></div><div className="flex items-center gap-2 text-xs">{r.predictionCorrect === true ? <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Correct</span> : r.predictionCorrect === false ? <span className="flex items-center gap-1 text-red-400"><XCircle className="h-4 w-4" /> Missed</span> : <span className="text-gray-500">Awaiting evaluation</span>}{r.scoreCorrect === true && <span className="rounded-full bg-[#39FF14]/10 px-2 py-1 font-bold text-[#39FF14]">Exact</span>}</div></div>)}</div>}</section>
    </>}
  </div>;
}
