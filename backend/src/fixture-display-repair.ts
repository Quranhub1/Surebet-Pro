import { sql } from './lib/db';

const PLACEHOLDERS = new Set(['', 'home', 'away', 'home team', 'away team', 'unknown', 'unknown league', 'tbd', 'n/a', 'na', 'null']);
const TEAM_KEYS = new Set(['home_team_name', 'homeTeamName', 'home_team', 'homeTeam', 'home']);
const AWAY_KEYS = new Set(['away_team_name', 'awayTeamName', 'away_team', 'awayTeam', 'away']);
const LEAGUE_KEYS = new Set(['league_name', 'leagueName', 'competition_name', 'competitionName', 'tournament_name', 'tournamentName', 'league', 'competition', 'tournament']);

function validText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && !PLACEHOLDERS.has(text.toLowerCase()) ? text : null;
}

function extractName(value: unknown, depth = 0, seen = new Set<object>()): string | null {
  if (depth > 8 || value == null) return null;
  const direct = validText(value);
  if (direct) return direct;
  if (typeof value !== 'object') return null;
  if (seen.has(value as object)) return null;
  seen.add(value as object);
  const objectValue = value as Record<string, unknown>;
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
  if (depth > 8 || value == null || typeof value !== 'object') return null;
  if (seen.has(value as object)) return null;
  seen.add(value as object);
  const objectValue = value as Record<string, unknown>;
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

async function repairFixtureDisplayMetadata(): Promise<number> {
  const rows = await sql`
    SELECT id, home_team, away_team, league_name, raw_data
    FROM football_fixtures
    WHERE LOWER(BTRIM(COALESCE(home_team, ''))) IN ('', 'home', 'home team', 'unknown', 'tbd', 'n/a', 'na', 'null')
       OR LOWER(BTRIM(COALESCE(away_team, ''))) IN ('', 'away', 'away team', 'unknown', 'tbd', 'n/a', 'na', 'null')
       OR LOWER(BTRIM(COALESCE(league_name, ''))) IN ('', 'unknown', 'unknown league', 'tbd', 'n/a', 'na', 'null')
    LIMIT 1000
  `;

  let repaired = 0;
  for (const row of rows as any[]) {
    const raw = row.raw_data;
    if (!raw) continue;
    const home = PLACEHOLDERS.has(String(row.home_team ?? '').trim().toLowerCase())
      ? findByKeys(raw, TEAM_KEYS)
      : String(row.home_team).trim();
    const away = PLACEHOLDERS.has(String(row.away_team ?? '').trim().toLowerCase())
      ? findByKeys(raw, AWAY_KEYS)
      : String(row.away_team).trim();
    const league = PLACEHOLDERS.has(String(row.league_name ?? '').trim().toLowerCase())
      ? findByKeys(raw, LEAGUE_KEYS)
      : String(row.league_name).trim();

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

async function repairLoop(): Promise<void> {
  // Database initialization happens in index.ts. Retry briefly so this module
  // is safe when imported by bootstrap before the tables are ready.
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const repaired = await repairFixtureDisplayMetadata();
      if (repaired > 0) console.log(`[DB] Repaired display metadata for ${repaired} football fixtures.`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[DB] Fixture display repair attempt ${attempt}/12 deferred: ${message}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

void repairLoop();
