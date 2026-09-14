import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface LiveEvent {
  type: 'GOAL' | 'CARD' | 'SUBSTITUTION';
  minute: number | null;
  injuryTime: number | null;
  teamId: number | null;
  team: string | null;
  player: string | null;
  playerIn: string | null;
  playerOut: string | null;
  card: string | null;
  goalType: string | null;
  assist: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

interface LiveMatch {
  id: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeCrest: string | null;
  awayCrest: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  startTime: string;
  updatedAt: string;
  minute: number | null;
  injuryTime: number | null;
  duration: string | null;
  lastUpdated: string | null;
  events: LiveEvent[];
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const LIVE_MARKER = '#sb-live=';

function decodeLiveData(crest: string | null): Partial<LiveMatch> | null {
  if (!crest) return null;
  const marker = crest.indexOf(LIVE_MARKER);
  if (marker < 0) return null;
  try {
    const encoded = crest.slice(marker + LIVE_MARKER.length);
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const json = decodeURIComponent(Array.from(binary).map(char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    return JSON.parse(json) as Partial<LiveMatch>;
  } catch {
    return null;
  }
}

function cleanCrest(crest: string | null): string | null {
  if (!crest) return null;
  const marker = crest.indexOf(LIVE_MARKER);
  return marker >= 0 ? crest.slice(0, marker) : crest;
}

function eventMinute(event: LiveEvent) {
  if (event.minute == null) return '';
  return `${event.minute}${event.injuryTime ? `+${event.injuryTime}` : ''}'`;
}

function eventLabel(event: LiveEvent) {
  if (event.type === 'GOAL') return `${event.player || 'Goal'}${event.goalType && event.goalType !== 'REGULAR' ? ` (${event.goalType.toLowerCase()})` : ''}`;
  if (event.type === 'CARD') return `${event.card || 'CARD'} · ${event.player || 'Player'}`;
  return `${event.playerOut || 'Player'} → ${event.playerIn || 'Player'}`;
}

function statusLabel(match: LiveMatch) {
  if (match.status === 'PAUSED') return 'HALF-TIME';
  if (match.status === 'EXTRA_TIME') return 'EXTRA TIME';
  if (match.status === 'PENALTY_SHOOTOUT') return 'PENALTIES';
  if (match.status === 'FINISHED') return 'FULL-TIME';
  if (match.minute != null) return `${match.minute}${match.injuryTime ? `+${match.injuryTime}` : ''}'`;
  return 'LIVE';
}

export function LiveMatchCentre() {
  const [matches, setMatches] = useState<LiveMatch[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const fetchLive = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/football/live`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Live feed ${response.status}`);
      const payload = await response.json();
      const next = (Array.isArray(payload.matches) ? payload.matches : []).map((match: any): LiveMatch => {
        const liveData = decodeLiveData(match.homeCrest) || decodeLiveData(match.awayCrest) || {};
        return {
          id: String(match.id), league: String(match.league || 'Football'), homeTeam: String(match.homeTeam || 'Home'), awayTeam: String(match.awayTeam || 'Away'),
          homeCrest: cleanCrest(match.homeCrest || null), awayCrest: cleanCrest(match.awayCrest || null),
          homeScore: match.homeScore == null ? null : Number(match.homeScore), awayScore: match.awayScore == null ? null : Number(match.awayScore),
          status: String(match.status || 'IN_PLAY'), startTime: String(match.startTime || ''), updatedAt: String(payload.updatedAt || new Date().toISOString()),
          minute: liveData.minute == null ? null : Number(liveData.minute), injuryTime: liveData.injuryTime == null ? null : Number(liveData.injuryTime), duration: liveData.duration || null,
          lastUpdated: liveData.lastUpdated || null, events: Array.isArray(liveData.events) ? liveData.events : [],
        };
      });
      setMatches(next);
      setUpdatedAt(payload.updatedAt || new Date().toISOString());
      setError(false);
    } catch (err) {
      console.error('[LiveMatchCentre] refresh failed', err);
      setError(true);
    }
  }, []);

  useEffect(() => {
    void fetchLive();
    const timer = window.setInterval(() => void fetchLive(), 15000);
    return () => window.clearInterval(timer);
  }, [fetchLive]);

  const visibleMatches = useMemo(() => matches.filter(match => ['IN_PLAY', 'PAUSED', 'EXTRA_TIME', 'PENALTY_SHOOTOUT'].includes(match.status)), [matches]);
  if (visibleMatches.length === 0) return null;

  return <section className="mx-5 md:mx-10 mt-4 mb-2 rounded-2xl border border-[#39FF14]/20 bg-[#0e110e] overflow-hidden">
    <div className="px-4 py-3 border-b border-[#263026] flex items-center justify-between gap-3">
      <div className="flex items-center gap-2"><span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#39FF14] opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#39FF14]" /></span><h2 className="text-sm font-black">LIVE MATCH CENTRE</h2><span className="text-[10px] text-[#7f8b7f]">scores, clock and events refresh every 15 seconds</span></div>
      {updatedAt && <span className="hidden sm:block text-[10px] text-[#7f8b7f]">Checked {new Date(updatedAt).toLocaleTimeString()}</span>}
    </div>
    {error && <div className="px-4 py-2 text-[11px] text-amber-300 border-b border-[#263026]">Live feed temporarily unavailable. The last successful state remains visible until the next refresh.</div>}
    <div className="grid lg:grid-cols-2 gap-px bg-[#263026]">
      {visibleMatches.map(match => {
        const events = [...match.events].sort((a, b) => (b.minute ?? -1) - (a.minute ?? -1));
        return <article key={match.id} className="bg-[#101310] p-4">
          <div className="flex items-center justify-between gap-3 mb-3"><div><p className="text-[10px] uppercase text-[#7f8b7f]">{match.league}</p><p className="text-xs font-black text-[#39FF14] mt-0.5">{statusLabel(match)}</p></div><span className="text-[10px] text-[#7f8b7f]">{match.duration === 'EXTRA_TIME' ? '120 min phase' : 'Live data'}</span></div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="text-center"><img src={cleanCrest(match.homeCrest) || ''} alt="" className="mx-auto h-10 w-10 object-contain" onError={event => { event.currentTarget.style.display = 'none'; }} /><p className="mt-1 text-xs font-bold leading-tight">{match.homeTeam}</p></div>
            <div className="text-center"><p className="text-3xl font-black tracking-tight">{match.homeScore ?? 0} - {match.awayScore ?? 0}</p><p className="text-[10px] font-black text-[#39FF14] mt-1">{match.status === 'PAUSED' ? 'HT' : match.minute != null ? `${match.minute}${match.injuryTime ? `+${match.injuryTime}` : ''}' PLAYING` : 'LIVE'}</p></div>
            <div className="text-center"><img src={cleanCrest(match.awayCrest) || ''} alt="" className="mx-auto h-10 w-10 object-contain" onError={event => { event.currentTarget.style.display = 'none'; }} /><p className="mt-1 text-xs font-bold leading-tight">{match.awayTeam}</p></div>
          </div>
          {events.length > 0 && <div className="mt-4 border-t border-[#252b25] pt-3 space-y-1.5 max-h-40 overflow-y-auto">
            {events.map((event, index) => <div key={`${match.id}-${event.type}-${event.minute}-${event.player}-${index}`} className="flex items-center gap-2 text-[11px] text-[#c7cec7]"><span className="w-9 shrink-0 text-right text-[#7f8b7f] font-mono">{eventMinute(event)}</span><span className="w-5 text-center">{event.type === 'GOAL' ? '⚽' : event.type === 'CARD' ? (event.card === 'RED' || event.card === 'YELLOW_RED' ? '🟥' : '🟨') : '↕'}</span><span className="truncate"><b className="text-white">{eventLabel(event)}</b><span className="text-[#737d73]"> · {event.team || ''}</span></span></div>)}
          </div>}
        </article>;
      })}
    </div>
  </section>;
}
