import React, { useState, useEffect } from 'react';
import { Search, Loader2, Radar, Radio, Target } from 'lucide-react';
import { OpportunityCard, OpportunityCardSkeleton } from '../components/OpportunityCard';
import { CalculatorModal } from '../components/CalculatorModal';

interface SurebetLeg { id: string; outcome_name: string; bookmaker: string; price: number; stake_percentage: number; }
interface EventData { home_team: string; away_team: string; commence_time: string; league_title: string; sport_key: string; }
interface Opportunity { id: string; market_key: string; roi: number; profit: number; created_at: string; events: EventData; surebet_legs: SurebetLeg[]; }
interface LiveFootballMatch { id: string; league: string; homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; status: string; startTime: string; minute: number | null; }
interface MatchPrediction { id: string; league: string; homeTeam: string; awayTeam: string; startTime: string; winner: string | null; advice: string | null; homeWin: number | null; draw: number | null; awayWin: number | null; underOver: string | null; predictedHomeGoals: number | null; predictedAwayGoals: number | null; }

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export function Dashboard() {
  const [searchTerm, setSearchTerm] = useState('');
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [liveMatches, setLiveMatches] = useState<LiveFootballMatch[]>([]);
  const [predictions, setPredictions] = useState<MatchPrediction[]>([]);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<string | null>(null);
  const [predictionsUpdatedAt, setPredictionsUpdatedAt] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const [predictionsLoading, setPredictionsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchOpportunities = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/opportunities`);
      if (!response.ok) throw new Error(`Opportunity feed returned ${response.status}`);
      const payload = await response.json();
      setOpportunities(Array.isArray(payload.opportunities) ? payload.opportunities : []);
    } catch (error) { console.error('Error fetching opportunities from Neon API:', error); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchOpportunities();
    const timer = window.setInterval(fetchOpportunities, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchLiveMatches = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/football/live`);
        if (!response.ok) throw new Error(`Live football feed returned ${response.status}`);
        const payload = await response.json();
        if (!cancelled) { setLiveMatches(Array.isArray(payload.matches) ? payload.matches : []); setLiveUpdatedAt(payload.updatedAt || new Date().toISOString()); }
      } catch (error) { console.error('Error fetching live football updates:', error); }
      finally { if (!cancelled) setLiveLoading(false); }
    };
    fetchLiveMatches();
    const timer = window.setInterval(fetchLiveMatches, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchPredictions = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/football/predictions`);
        if (!response.ok) throw new Error(`Prediction feed returned ${response.status}`);
        const payload = await response.json();
        if (!cancelled) { setPredictions(Array.isArray(payload.predictions) ? payload.predictions : []); setPredictionsUpdatedAt(payload.updatedAt || new Date().toISOString()); }
      } catch (error) { console.error('Error fetching match predictions:', error); }
      finally { if (!cancelled) setPredictionsLoading(false); }
    };
    fetchPredictions();
    const timer = window.setInterval(fetchPredictions, 30 * 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const filteredBets = opportunities.filter(bet => {
    const eventName = `${bet.events?.home_team} vs ${bet.events?.away_team}`.toLowerCase();
    const leagueName = bet.events?.league_title?.toLowerCase() || '';
    const search = searchTerm.toLowerCase();
    return eventName.includes(search) || leagueName.includes(search);
  });

  const handleOpenCalculator = (id: string) => {
    const opp = opportunities.find(o => o.id === id);
    if (opp) { setSelectedOpportunity(opp); setIsModalOpen(true); }
  };

  const formatMatchStatus = (match: LiveFootballMatch) => match.minute !== null ? `${match.minute}'` : match.status.replace(/_/g, ' ');
  const formatProbability = (value: number | null) => value === null ? '—' : `${value.toFixed(0)}%`;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-6 md:p-10">
      <div className="w-full max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div className="flex-1 w-full">
            <h1 className="text-3xl font-extrabold text-white tracking-tight mb-1 flex items-center gap-3">Live Scanner<span className="text-xs font-bold bg-[#39FF14]/10 text-[#39FF14] px-3 py-1 rounded-full border border-[#39FF14]/20 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#39FF14] animate-pulse" />Automatic</span></h1>
            <p className="text-[#8b8d93] text-sm font-medium mb-2">Matches are generated automatically every 12 hours.</p>
            <p className="text-[#8b8d93] text-xs font-medium">Live matches and odds are refreshed automatically every 2 minutes.</p>
          </div>
          <div className="relative w-full md:w-64"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8b8d93]" /><input type="text" placeholder="Search teams or leagues..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-[#161618] border border-[#2c2e33] text-white text-sm rounded-xl pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#39FF14] focus:border-transparent transition-all placeholder-[#4a4d55]" /></div>
        </div>

        <section className="mb-8 rounded-2xl border border-[#2c2e33] bg-[#111113] overflow-hidden shadow-lg">
          <div className="px-5 py-4 border-b border-[#2c2e33] flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-[#39FF14]/10 border border-[#39FF14]/20 flex items-center justify-center"><Target className="w-5 h-5 text-[#39FF14]" /></div><div><h2 className="text-lg font-bold">Match Predictions</h2><p className="text-xs text-[#8b8d93]">Pre-match forecasts from the football prediction engine.</p></div></div><div className="text-xs text-[#8b8d93]">{predictionsUpdatedAt ? `Updated ${new Date(predictionsUpdatedAt).toLocaleTimeString()}` : 'Waiting for predictions...'}</div></div>
          {predictionsLoading ? <div className="p-6 flex items-center gap-3 text-sm text-[#8b8d93]"><Loader2 className="w-4 h-4 animate-spin" /> Loading match predictions...</div> : predictions.length === 0 ? <div className="p-8 text-center text-sm text-[#8b8d93]">No upcoming match predictions are available right now.</div> : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-px bg-[#2c2e33]">{predictions.map(prediction => <div key={prediction.id} className="bg-[#111113] p-5 hover:bg-[#171719] transition-colors"><div className="flex items-center justify-between gap-2 mb-3"><span className="text-[11px] uppercase tracking-wide text-[#8b8d93] truncate">{prediction.league}</span><span className="text-[10px] text-[#8b8d93] whitespace-nowrap">{new Date(prediction.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><div className="space-y-2 mb-4"><div className="flex items-center justify-between gap-3"><span className="font-semibold text-sm truncate">{prediction.homeTeam}</span><span className="text-sm font-bold">{formatProbability(prediction.homeWin)}</span></div><div className="flex items-center justify-between gap-3"><span className="font-semibold text-sm truncate">{prediction.awayTeam}</span><span className="text-sm font-bold">{formatProbability(prediction.awayWin)}</span></div><div className="flex items-center justify-between gap-3"><span className="text-xs text-[#8b8d93]">Draw</span><span className="text-xs font-bold text-[#8b8d93]">{formatProbability(prediction.draw)}</span></div></div><div className="border-t border-[#2c2e33] pt-3 space-y-1"><p className="text-xs"><span className="text-[#8b8d93]">Prediction:</span> <span className="font-bold text-[#39FF14]">{prediction.winner || 'No winner forecast'}</span></p>{prediction.advice && <p className="text-[11px] text-[#8b8d93] line-clamp-2">{prediction.advice}</p>}{prediction.underOver && <p className="text-[11px] text-[#8b8d93]">Goals: <span className="text-white font-semibold">{prediction.underOver}</span></p>}{prediction.predictedHomeGoals !== null && prediction.predictedAwayGoals !== null && <p className="text-[11px] text-[#8b8d93]">Expected score: <span className="text-white font-semibold">{prediction.predictedHomeGoals} - {prediction.predictedAwayGoals}</span></p>}</div></div>)}</div>}
        </section>

        <section className="mb-8 rounded-2xl border border-[#2c2e33] bg-[#111113] overflow-hidden shadow-lg">
          <div className="px-5 py-4 border-b border-[#2c2e33] flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-[#39FF14]/10 border border-[#39FF14]/20 flex items-center justify-center"><Radio className="w-5 h-5 text-[#39FF14]" /></div><div><h2 className="text-lg font-bold">Live Football</h2><p className="text-xs text-[#8b8d93]">Real match status and scores from the configured football data feed.</p></div></div><div className="text-xs text-[#8b8d93]">{liveUpdatedAt ? `Updated ${new Date(liveUpdatedAt).toLocaleTimeString()}` : 'Waiting for live data...'}</div></div>
          {liveLoading ? <div className="p-6 flex items-center gap-3 text-sm text-[#8b8d93]"><Loader2 className="w-4 h-4 animate-spin" /> Loading live football...</div> : liveMatches.length === 0 ? <div className="p-8 text-center text-sm text-[#8b8d93]">No football matches are live right now.</div> : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-[#2c2e33]">{liveMatches.map(match => <div key={match.id} className="bg-[#111113] p-5 hover:bg-[#171719] transition-colors"><div className="flex items-center justify-between mb-3"><span className="text-[11px] uppercase tracking-wide text-[#8b8d93] truncate pr-3">{match.league}</span><span className="text-[11px] font-bold text-[#39FF14] flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#39FF14] animate-pulse" />{formatMatchStatus(match)}</span></div><div className="space-y-2"><div className="flex items-center justify-between gap-4"><span className="font-semibold truncate">{match.homeTeam}</span><span className="text-xl font-extrabold">{match.homeScore ?? '-'}</span></div><div className="flex items-center justify-between gap-4"><span className="font-semibold truncate">{match.awayTeam}</span><span className="text-xl font-extrabold">{match.awayScore ?? '-'}</span></div></div></div>)}</div>}
        </section>

        {loading ? <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">{[1, 2, 3, 4].map(i => <OpportunityCardSkeleton key={i} />)}</div> : filteredBets.length === 0 ? <div className="bg-[#161618] border border-[#2c2e33] rounded-2xl p-16 text-center shadow-lg"><div className="flex flex-col items-center justify-center text-[#8b8d93]"><div className="w-16 h-16 bg-[#252529] rounded-full flex items-center justify-center mb-4 border border-[#333]"><Radar className="w-8 h-8 text-[#555]" /></div><p className="text-xl font-bold text-white mb-2">No surebets found right now</p><p className="text-sm max-w-md text-center leading-relaxed">The scanner is running automatically. New matches are generated every 12 hours and live matches are refreshed continuously.</p></div></div> : <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">{filteredBets.map(bet => <OpportunityCard key={bet.id} id={bet.id} roi={bet.roi} sport={bet.events?.sport_key} date={bet.events?.commence_time} league={bet.events?.league_title} homeTeam={bet.events?.home_team} awayTeam={bet.events?.away_team} legs={bet.surebet_legs.map(leg => ({ id: leg.id, bookmaker: leg.bookmaker, outcome: leg.outcome_name, price: leg.price }))} onCalculate={handleOpenCalculator} fullData={bet} />)}</div>}
      </div>
      <CalculatorModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} opportunity={selectedOpportunity} />
    </div>
  );
}
