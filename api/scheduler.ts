import { supabase } from '../backend/src/lib/supabase';

export default async function handler(req: Request, res: { status: (code: number) => { json: (data: unknown) => void } }) {
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('scheduler_enabled, run_hour, run_minute, timezone, last_run_date, last_run_at, last_run_status')
        .eq('id', 1)
        .single();

      if (error || !data) {
        return res.status(200).json({
          enabled: false,
          runHour: 6,
          runMinute: 0,
          timezone: 'Africa/Kampala',
          lastRunDate: null,
          lastRunAt: null,
          lastRunStatus: null,
        });
      }

      return res.status(200).json({
        enabled: data.scheduler_enabled ?? false,
        runHour: data.run_hour ?? 6,
        runMinute: data.run_minute ?? 0,
        timezone: data.timezone ?? 'Africa/Kampala',
        lastRunDate: data.last_run_date ?? null,
        lastRunAt: data.last_run_at ?? null,
        lastRunStatus: data.last_run_status ?? null,
      });
    } catch {
      return res.status(200).json({
        enabled: false,
        runHour: 6,
        runMinute: 0,
        timezone: 'Africa/Kampala',
        lastRunDate: null,
        lastRunAt: null,
        lastRunStatus: null,
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const updateData: Record<string, unknown> = {};
      
      if (typeof body.enabled === 'boolean') updateData.scheduler_enabled = body.enabled;
      if (typeof body.runHour === 'number') updateData.run_hour = body.runHour;
      if (typeof body.runMinute === 'number') updateData.run_minute = body.runMinute;
      if (typeof body.timezone === 'string') updateData.timezone = body.timezone;

      const { data, error } = await supabase
        .from('system_settings')
        .update(updateData)
        .eq('id', 1)
        .select('scheduler_enabled, run_hour, run_minute, timezone, last_run_date, last_run_at, last_run_status')
        .single();

      if (error || !data) {
        return res.status(500).json({ error: 'Failed to update scheduler settings' });
      }

      return res.status(200).json({
        enabled: data.scheduler_enabled ?? false,
        runHour: data.run_hour ?? 6,
        runMinute: data.run_minute ?? 0,
        timezone: data.timezone ?? 'Africa/Kampala',
        lastRunDate: data.last_run_date ?? null,
        lastRunAt: data.last_run_at ?? null,
        lastRunStatus: data.last_run_status ?? null,
      });
    } catch {
      return res.status(500).json({ error: 'Failed to update scheduler settings' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
