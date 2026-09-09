const base = process.env.SUREBET_PRO_URL;
const secret = process.env.INTERNAL_CRON_SECRET;
if (!base) throw new Error('SUREBET_PRO_URL is required');
fetch(`${base.replace(/\/$/, '')}/api/automation/run`, { method: 'POST', headers: { 'x-cron-secret': secret || '' } })
  .then(async r => { const text = await r.text(); console.log(text); if (!r.ok) process.exitCode = 1; })
  .catch(e => { console.error(e.message); process.exitCode = 1; });
