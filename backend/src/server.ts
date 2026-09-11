import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

app.get('/api/health', async (_req, res) => {
  try {
    const { supabase } = await import('../lib/supabase');
    const { error } = await supabase.from('system_settings').select('id').limit(1);
    const databaseOk = !error;
    
    res.json({
      ok: true,
      service: 'SureBet Pro',
      version: '2.1.0',
      database: databaseOk,
    });
  } catch {
    res.json({
      ok: true,
      service: 'SureBet Pro',
      version: '2.1.0',
      database: false,
    });
  }
});

app.get('/api/scheduler', async (_req, res) => {
  try {
    const { supabase } = await import('../lib/supabase');
    const { data, error } = await supabase
      .from('system_settings')
      .select('scheduler_enabled, run_hour, run_minute, timezone, last_run_date, last_run_at, last_run_status')
      .eq('id', 1)
      .single();

    if (error || !data) {
      return res.json({
        enabled: false,
        runHour: 6,
        runMinute: 0,
        timezone: 'Africa/Kampala',
        lastRunDate: null,
        lastRunAt: null,
        lastRunStatus: null,
      });
    }

    res.json({
      enabled: data.scheduler_enabled ?? false,
      runHour: data.run_hour ?? 6,
      runMinute: data.run_minute ?? 0,
      timezone: data.timezone ?? 'Africa/Kampala',
      lastRunDate: data.last_run_date ?? null,
      lastRunAt: data.last_run_at ?? null,
      lastRunStatus: data.last_run_status ?? null,
    });
  } catch {
    res.json({
      enabled: false,
      runHour: 6,
      runMinute: 0,
      timezone: 'Africa/Kampala',
      lastRunDate: null,
      lastRunAt: null,
      lastRunStatus: null,
    });
  }
});

app.post('/api/scheduler', async (req, res) => {
  try {
    const { supabase } = await import('../lib/supabase');
    const body = req.body as {
      enabled?: boolean;
      runHour?: number;
      runMinute?: number;
      timezone?: string;
    };

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

    res.json({
      enabled: data.scheduler_enabled ?? false,
      runHour: data.run_hour ?? 6,
      runMinute: data.run_minute ?? 0,
      timezone: data.timezone ?? 'Africa/Kampala',
      lastRunDate: data.last_run_date ?? null,
      lastRunAt: data.last_run_at ?? null,
      lastRunStatus: data.last_run_status ?? null,
    });
  } catch {
    res.status(500).json({ error: 'Failed to update scheduler settings' });
  }
});

app.listen(PORT, () => {
  console.log(`[API] Server running on http://localhost:${PORT}`);
});
