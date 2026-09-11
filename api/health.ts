import { neon } from '@neondatabase/serverless';

export default async function handler(_req: Request, res: { status: (code: number) => { json: (data: unknown) => void } }) {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is not configured');
    const sql = neon(databaseUrl);
    await sql`SELECT 1`;
    return res.status(200).json({ ok: true, service: 'SureBet Pro', version: '2.1.0', database: true, databaseProvider: 'Neon PostgreSQL' });
  } catch {
    return res.status(503).json({ ok: false, service: 'SureBet Pro', version: '2.1.0', database: false, databaseProvider: 'Neon PostgreSQL' });
  }
}
