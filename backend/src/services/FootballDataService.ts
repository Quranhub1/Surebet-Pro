import axios from 'axios';

export interface FootballDataMatch {
  id: string;
  league: string;
  leagueCode: string;
  country: string;
  season: number | null;
  homeId: number | null;
  homeTeam: string;
  awayId: number | null;
  awayTeam: string;
  kickoff: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  raw: any;
}

const BASE_URL = 'https://api.football-data.org/v4';

// These are the competitions exposed on the football-data.org free plan.
export const FREE_COMPETITION_CODES = ['WC', 'CL', 'BL1', 'DED', 'BSA', 'PD', 'FL1', 'ELC', 'PPL', 'EC', 'SA', 'PL'];

export class FootballDataService {
  private token = process.env.FOOTBALL_DATA_API_TOKEN || process.env.FOOTBALL_DATA_TOKEN || '';

  private request(path: string, params: Record<string, string | number> = {}) {
    if (!this.token) throw new Error('FOOTBALL_DATA_API_TOKEN is not configured.');
    return axios.get(`${BASE_URL}${path}`, {
      params,
      headers: { 'X-Auth-Token': this.token, Accept: 'application/json' },
      timeout: 20000,
    }).then(response => response.data);
  }

  public isConfigured(): boolean { return Boolean(this.token); }

  public async getMatches(from: string, to: string, competitions = FREE_COMPETITION_CODES): Promise<FootballDataMatch[]> {
    const data = await this.request('/matches', {
      dateFrom: from,
      dateTo: to,
      competitions: competitions.join(','),
    });
    return (Array.isArray(data?.matches) ? data.matches : []).map((match: any) => this.normalize(match));
  }

  public async getUpcomingMatches(days = 7): Promise<FootballDataMatch[]> {
    const now = new Date();
    const from = this.formatDate(now);
    const to = this.formatDate(new Date(now.getTime() + days * 86400000));
    const matches = await this.getMatches(from, to);
    return matches
      .filter(match => ['SCHEDULED', 'TIMED'].includes(match.status))
      .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
  }

  public async getLiveMatches(): Promise<FootballDataMatch[]> {
    const data = await this.request('/matches', { status: 'IN_PLAY' });
    return (Array.isArray(data?.matches) ? data.matches : []).map((match: any) => this.normalize(match));
  }

  private normalize(match: any): FootballDataMatch {
    return {
      id: String(match?.id ?? ''),
      league: match?.competition?.name || 'Football',
      leagueCode: match?.competition?.code || '',
      country: match?.area?.name || '',
      season: match?.season?.startDate ? Number(String(match.season.startDate).slice(0, 4)) : null,
      homeId: match?.homeTeam?.id == null ? null : Number(match.homeTeam.id),
      homeTeam: match?.homeTeam?.name || match?.homeTeam?.shortName || 'Home',
      awayId: match?.awayTeam?.id == null ? null : Number(match.awayTeam.id),
      awayTeam: match?.awayTeam?.name || match?.awayTeam?.shortName || 'Away',
      kickoff: match?.utcDate || new Date().toISOString(),
      status: String(match?.status || 'SCHEDULED'),
      homeScore: this.numberOrNull(match?.score?.fullTime?.home ?? match?.score?.halfTime?.home),
      awayScore: this.numberOrNull(match?.score?.fullTime?.away ?? match?.score?.halfTime?.away),
      raw: match,
    };
  }

  private numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  private formatDate(date: Date): string { return date.toISOString().slice(0, 10); }
}

export const footballDataService = new FootballDataService();
