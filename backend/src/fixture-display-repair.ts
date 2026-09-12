import { sql } from './lib/db';

const PLACEHOLDERS = new Set(['', 'home', 'away', 'home team', 'away team', 'unknown', 'unknown league', 'football', 'tbd', 'n/a', 'na', 'null']);
const TEAM_KEYS = new Set(['home_team_name', 'homeTeamName', 'home_team', 'homeTeam', 'home']);
const AWAY_KEYS = new Set(['away_team_name', 'awayTeamName', 'away_team', 'awayTeam', 'away']);
const LEAGUE_KEYS = new Set(['league_name', 'leagueName', 'competition_name', 'competitionName', 'tournament_name', 'tournamentName', 'league', 'competition', 'tournament']);

function validText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && !PLACEHOLDERS.has(text.toLowerCase()) ? text : null;
}

function parseRaw(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function extractName(value: unknown, depth = 0, seen = new Set<object>()): string | null {
  if (depth > 10 || value == null) return null;
  const parsed = parseRaw(value);
  const direct = validText(parsed);
  if (direct) return direct;
  if (parsed !== value) return extractName(parsed, depth + 1, seen);
  if (typeof parsed !== 'object') return null;
  if (seen.has(parsed as object)) return null;
  seen.add(parsed as object);
  const objectValue = parsed as Record<string, unknown>;
  for (const key of ['name', 'team_name', 'teamName', 'displayName', 'title', 'shortName']) {
    const found = validText(objectValue[key]);
    if (found) return found;
  }
  for (const child of Object.values(objectValue)) {
    const found = extractName(child, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

function findByKeys(value: unknown, keys: Set<string>, depth = 0, seen = new Set<object>()): string | null {
  if (depth > 10 || value == null) return null;
  const parsed = parseRaw(value);
  if (parsed !== value) return findByKeys(parsed, keys, depth + 1, seen);
  if (typeof parsed !== 'object') return null;
  if (seen.has(parsed as object)) return null;
  seen.add(parsed as object);
  const objectValue = parsed as Record<string, unknown>;
  for (const [key, child] of Object.entries(objectValue)) {
    if (keys.has(key)) {
      const found = extractName(child);
      if (found) return found;
    }
  }
  for (const child of Object.values(objectValue)) {
    const found = findByKeys(child, keys, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

export async function repairFixtureDisplayMetadata(): Promise<number> {
  const rows = await sql`
    SELECT id, home_team, away_team, league_name, raw_data
    FROM football_fixtures
    WHERE LOWER(BTRIM(COALESCE(home_team, ''))) IN ('', 'home', 'home team', 'unknown', 'tbd', 'n/a', 'na', 'null')
       OR LOWER(BTRIM(COALESCE(away_team, ''))) IN ('', 'away', 'away team', 'unknown', 'tbd', 'n/a', 'na', 'null')
       OR LOWER(BTRIM(COALESCE(league_name, ''))) IN ('', 'unknown', 'unknown league', 'football', 'tbd', 'n/a', 'na', 'null')
    LIMIT 2000
  `;

  let repaired = 0;
  for (const row of rows as any[]) {
    const raw = parseRaw(row.raw_data);
    if (!raw) continue;
    const home = PLACEHOLDERS.has(String(row.home_team ?? '').trim().toLowerCase()) ? findByKeys(raw, TEAM_KEYS) : String(row.home_team).trim();
    const away = PLACEHOLDERS.has(String(row.away_team ?? '').trim().toLowerCase()) ? findByKeys(raw, AWAY_KEYS) : String(row.away_team).trim();
    const league = PLACEHOLDERS.has(String(row.league_name ?? '').trim().toLowerCase()) ? findByKeys(raw, LEAGUE_KEYS) : String(row.league_name).trim();
    if (!home && !away && !league) continue;
    await sql`
      UPDATE football_fixtures
      SET home_team = CASE WHEN ${home != null} THEN ${home ?? ''} ELSE home_team END,
          away_team = CASE WHEN ${away != null} THEN ${away ?? ''} ELSE away_team END,
          league_name = CASE WHEN ${league != null} THEN ${league ?? ''} ELSE league_name END,
          updated_at = NOW()
      WHERE id = ${String(row.id)}
    `;
    repaired += 1;
  }
  return repaired;
}

export async function repairFixtureDisplayMetadataWithRetry(): Promise<void> {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const repaired = await repairFixtureDisplayMetadata();
      console.log(`[DB] Fixture display metadata repair completed. ${repaired} fixture(s) repaired.`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[DB] Fixture display repair attempt ${attempt}/12 deferred: ${message}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}
