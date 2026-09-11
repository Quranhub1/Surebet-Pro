import { supabase } from '../backend/src/lib/supabase';

export default async function handler(_req: Request, res: { status: (code: number) => { json: (data: unknown) => void } }) {
  try {
    const { error } = await supabase.from('system_settings').select('id').limit(1);
    const databaseOk = !error;
    
    return res.status(200).json({
      ok: true,
      service: 'SureBet Pro',
      version: '2.1.0',
      database: databaseOk,
    });
  } catch {
    return res.status(200).json({
      ok: true,
      service: 'SureBet Pro',
      version: '2.1.0',
      database: false,
    });
  }
}
