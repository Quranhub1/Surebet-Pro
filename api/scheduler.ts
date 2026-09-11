import { neon } from '@neondatabase/serverless';

export default async function handler(_req: Request, res: { status: (code: number) => { json: (data: unknown) => void } }) {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is not configured');
    const sql = neon(databaseUrl);
    const rows = await sql`SELECT last_run_date, last_run_at, last_run_status FROM system_settings WHERE id = 1`;
    const data = rows[0];
    return res.status(200).json({ enabled: true, intervalHours: 12, liveRefreshMinutes: 2, timezone: 'Africa/Kampala', lastRunDate: data?.last_run_date ?? null, lastRunAt: data?.last_run_at ?? null, lastRunStatus: data?.last_run_status ?? null });
  } catch {
    return res.status(503).json({ enabled: true, intervalHours: 12, liveRefreshMinutes: 2, timezone: 'Africa/Kampala', lastRunDate: null, lastRunAt: null, lastRunStatus: null });
  }
}
