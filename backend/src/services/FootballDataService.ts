import axios from 'axios';

export interface FootballLiveEvent {
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

export interface FootballDataMatch {
  id: string;
  league: string;
  leagueCode: string;
  country: string;
  season: number | null;
  homeId: number | null;
  homeTeam: string;
  homeCrest: string | null;
  awayId: number | null;
  awayTeam: string;
  awayCrest: string | null;
  kickoff: string;
  status: string;
  minute: number | null;
  injuryTime: number | null;
  duration: string | null;
  lastUpdated: string | null;
  homeScore: number | null;
  awayScore: number | null;
  liveEvents: FootballLiveEvent[];
  raw: any;
}

const BASE_URL = 'https://api.football-data.org/v4';
export const FREE_COMPETITION_CODES = ['WC', 'CL', 'BL1', 'DED', 'BSA', 'PD', 'FL1', 'ELC', 'PPL', 'EC', 'SA', 'PL'];

export class FootballDataService {
  private token = process.env.FOOTBALL_DATA_API_TOKEN || process.env.FOOTBALL_DATA_TOKEN || '';
  private request(path: string, params: Record<string, string | number> = {}) {
    if (!this.token) throw new Error('FOOTBALL_DATA_API_TOKEN is not configured.');
    return axios.get(`${BASE_URL}${path}`, {
      params,
      headers: {
        'X-Auth-Token': this.token,
        Accept: 'application/json',
        'X-Unfold-Goals': 'true',
        'X-Unfold-Bookings': 'true',
        'X-Unfold-Subs': 'true',
      },
      timeout: 20000,
    }).then(response => response.data);
  }
  public isConfigured(): boolean { return Boolean(this.token); }

  /**
   * Fetch the full match surface allowed by the configured football-data.org
   * account for the requested date range. Passing no competition filter is
   * intentional: hard-coding a small league list silently dropped valid daily
   * fixtures before the AI analysis stage ever saw them.
   */
  public async getMatches(from: string, to: string, competitions?: string[]): Promise<FootballDataMatch[]> {
    const params: Record<string, string> = { dateFrom: from, dateTo: to };
    if (competitions?.length) params.competitions = competitions.join(',');
    const data = await this.request('/matches', params);
    return (Array.isArray(data?.matches) ? data.matches : []).map((match: any) => this.normalize(match));
  }
  public async getUpcomingMatches(days = 7): Promise<FootballDataMatch[]> {
    const now = new Date();
    const matches = await this.getMatches(this.formatDate(now), this.formatDate(new Date(now.getTime() + days * 86400000)));
    return matches.filter(match => ['SCHEDULED', 'TIMED'].includes(match.status)).sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
  }
  public async getCompletedMatches(daysBack = 7): Promise<FootballDataMatch[]> {
    const now = new Date();
    const matches = await this.getMatches(this.formatDate(new Date(now.getTime() - daysBack * 86400000)), this.formatDate(now));
    return matches.filter(match => ['FINISHED', 'AWAITING_PENALTIES', 'FINISHED_AET', 'FINISHED_PEN'].includes(match.status) && match.homeScore != null && match.awayScore != null).sort((a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime());
  }
  public async getLiveMatches(): Promise<FootballDataMatch[]> {
    // LIVE is football-data.org's combined filter for IN_PLAY and PAUSED.
    const data = await this.request('/matches', { status: 'LIVE' });
    return (Array.isArray(data?.matches) ? data.matches : []).map((match: any) => this.normalize(match));
  }
  private normalize(match: any): FootballDataMatch {
    const homeCrest = match?.homeTeam?.crest || null;
    const awayCrest = match?.awayTeam?.crest || null;
    const liveEvents: FootballLiveEvent[] = [
      ...(Array.isArray(match?.goals) ? match.goals.map((event: any) => ({
        type: 'GOAL' as const,
        minute: this.numberOrNull(event?.minute),
        injuryTime: this.numberOrNull(event?.injuryTime),
        teamId: event?.team?.id == null ? null : Number(event.team.id),
        team: event?.team?.name || null,
        player: event?.scorer?.name || null,
        playerIn: null,
        playerOut: null,
        card: null,
        goalType: event?.type || null,
        assist: event?.assist?.name || null,
        homeScore: this.numberOrNull(event?.score?.home),
        awayScore: this.numberOrNull(event?.score?.away),
      })) : []),
      ...(Array.isArray(match?.bookings) ? match.bookings.map((event: any) => ({
        type: 'CARD' as const,
        minute: this.numberOrNull(event?.minute),
        injuryTime: this.numberOrNull(event?.injuryTime),
        teamId: event?.team?.id == null ? null : Number(event.team.id),
        team: event?.team?.name || null,
        player: event?.player?.name || null,
        playerIn: null,
        playerOut: null,
        card: event?.card || null,
        goalType: null,
        assist: null,
        homeScore: null,
        awayScore: null,
      })) : []),
      ...(Array.isArray(match?.substitutions) ? match.substitutions.map((event: any) => ({
        type: 'SUBSTITUTION' as const,
        minute: this.numberOrNull(event?.minute),
        injuryTime: this.numberOrNull(event?.injuryTime),
        teamId: event?.team?.id == null ? null : Number(event.team.id),
        team: event?.team?.name || null,
        player: null,
        playerIn: event?.playerIn?.name || null,
        playerOut: event?.playerOut?.name || null,
        card: null,
        goalType: null,
        assist: null,
        homeScore: null,
        awayScore: null,
      })) : []),
    ].sort((a, b) => (b.minute ?? -1) - (a.minute ?? -1));

    const normalized = {
      id: String(match?.id ?? ''), league: match?.competition?.name || 'Football', leagueCode: match?.competition?.code || '', country: match?.area?.name || '',
      season: match?.season?.startDate ? Number(String(match.season.startDate).slice(0, 4)) : null,
      homeId: match?.homeTeam?.id == null ? null : Number(match.homeTeam.id), homeTeam: match?.homeTeam?.name || match?.homeTeam?.shortName || 'Home', homeCrest,
      awayId: match?.awayTeam?.id == null ? null : Number(match.awayTeam.id), awayTeam: match?.awayTeam?.name || match?.awayTeam?.shortName || 'Away', awayCrest,
      kickoff: match?.utcDate || new Date().toISOString(), status: String(match?.status || 'SCHEDULED'),
      minute: this.numberOrNull(match?.minute), injuryTime: this.numberOrNull(match?.injuryTime), duration: match?.score?.duration || null,
      lastUpdated: match?.lastUpdated || null,
      homeScore: this.numberOrNull(match?.score?.fullTime?.home ?? match?.score?.halfTime?.home), awayScore: this.numberOrNull(match?.score?.fullTime?.away ?? match?.score?.halfTime?.away),
      liveEvents, raw: match,
    } as FootballDataMatch;

    if (['IN_PLAY', 'PAUSED', 'EXTRA_TIME', 'PENALTY_SHOOTOUT'].includes(normalized.status) && (homeCrest || awayCrest)) {
      const payload = Buffer.from(JSON.stringify({
        minute: normalized.minute,
        injuryTime: normalized.injuryTime,
        duration: normalized.duration,
        lastUpdated: normalized.lastUpdated,
        events: normalized.liveEvents,
      }), 'utf8').toString('base64url');
      if (homeCrest) normalized.homeCrest = `${homeCrest}#sb-live=${payload}`;
      else if (awayCrest) normalized.awayCrest = `${awayCrest}#sb-live=${payload}`;
    }

    return normalized;
  }
  private numberOrNull(value: unknown): number | null { if (value === null || value === undefined || value === '') return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
  private formatDate(date: Date): string { return date.toISOString().slice(0, 10); }
}
export const footballDataService = new FootballDataService();
