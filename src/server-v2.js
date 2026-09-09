const express = require('express');
const axios = require('axios');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const { validateModelPrediction, weightedEnsemble, valueFromOdds, noVig, poissonBaseline } = require('./prediction-engine');
const store = require('./storage');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..')));
const PORT = Number(process.env.PORT || 8080);
const BATCH_SIZE = Number(process.env.PREDICTION_BATCH_SIZE || 8);
const BATCH_DELAY_MS = Number(process.env.PREDICTION_BATCH_DELAY_MS || 1500);
const FIXTURE_CACHE_TTL_MS = Number(process.env.FIXTURE_CACHE_TTL_MS || 10 * 60 * 1000);
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 100);
const CRON_SECRET = process.env.INTERNAL_CRON_SECRET;
let fixtures = { data: [], fetchedAt: 0 };
let status = { total: 0, processed: 0, isProcessing: false, startedAt: null };
const requests = new Map();

const googleKey = process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY;
const google = googleKey ? new GoogleGenerativeAI(googleKey) : null;
const gemini = google ? google.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' }) : null;
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dateOnly = d => d.toISOString().slice(0, 10);

function jsonOnly(text) {
  const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON returned');
  return JSON.parse(match[0]);
}
function promptFor(home, away, h2h, news, baseline) {
  return `Act as an independent football forecasting model. Never invent odds or certainty. Match: ${home} vs ${away}. Recent H2H: ${h2h}. News: ${news}. Statistical baseline: ${JSON.stringify(baseline)}. Return JSON only: {"score":"2-1","probabilities":{"home":0.45,"draw":0.28,"away":0.27},"markets":{"over25":0.55,"btts":0.54},"logic":"brief evidence-based reason"}. Probabilities must sum to 1.`;
}
async function history(homeId, awayId) {
  if (!process.env.RAPIDAPI_KEY || !homeId || !awayId) return 'unavailable';
  try { const r = await axios.get('https://api-football-v1.p.rapidapi.com/v3/fixtures/headtohead', { params: { h2h: `${homeId}-${awayId}`, last: 5 }, headers: { 'x-rapidapi-key': process.env.RAPIDAPI_KEY, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }, timeout: 7000 }); return (r.data?.response || []).map(g => `${g.goals?.home ?? 0}-${g.goals?.away ?? 0}`).join(' | ') || 'unavailable'; } catch (_) { return 'unavailable'; }
}
async function news(home, away) {
  if (!process.env.TAVILY_API_KEY) return 'unavailable';
  try { const r = await axios.post('https://api.tavily.com/search', { api_key: process.env.TAVILY_API_KEY, query: `${home} vs ${away} football injuries suspensions lineups team news`, max_results: 3 }, { timeout: 7000 }); return (r.data?.results || []).map(x => x.content).filter(Boolean).join(' ').slice(0, 1800) || 'unavailable'; } catch (_) { return 'unavailable'; }
}
async function geminiCall(prompt) { if (!gemini) throw new Error('Gemini unavailable'); const r = await gemini.generateContent(prompt); return jsonOnly(r.response.text()); }
async function groqCall(prompt) { if (!groq) throw new Error('Groq unavailable'); const r = await groq.chat.completions.create({ model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant', temperature: 0.1, messages: [{ role: 'system', content: 'Calibrated football forecasting model. JSON only.' }, { role: 'user', content: prompt }] }); return jsonOnly(r.choices?.[0]?.message?.content); }
async function compatibleCall(url, key, model, prompt) { if (!key) throw new Error('Provider unavailable'); const r = await axios.post(url, { model, temperature: 0.1, messages: [{ role: 'system', content: 'Calibrated football forecasting model. JSON only.' }, { role: 'user', content: prompt }] }, { timeout: 15000, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }); return jsonOnly(r.data?.choices?.[0]?.message?.content); }
async function modelEnsemble(prompt) {
  const jobs = [];
  if (gemini) jobs.push(geminiCall(prompt).then(x => validateModelPrediction(x, 'gemini')).catch(e => { console.log(`Gemini: ${e.message}`); return null; }));
  if (groq) jobs.push(groqCall(prompt).then(x => validateModelPrediction(x, 'groq')).catch(e => { console.log(`Groq: ${e.message}`); return null; }));
  if (process.env.DEEPSEEK_API_KEY) jobs.push(compatibleCall('https://api.deepseek.com/v1/chat/completions', process.env.DEEPSEEK_API_KEY, process.env.DEEPSEEK_MODEL || 'deepseek-chat', prompt).then(x => validateModelPrediction(x, 'deepseek')).catch(e => { console.log(`DeepSeek: ${e.message}`); return null; }));
  if (process.env.Z_AI_API_KEY) jobs.push(compatibleCall(process.env.Z_AI_BASE_URL || 'https://api.z.ai/v1/chat/completions', process.env.Z_AI_API_KEY, process.env.Z_AI_MODEL || 'default', prompt).then(x => validateModelPrediction(x, 'zai')).catch(e => { console.log(`Z.ai: ${e.message}`); return null; }));
  return (await Promise.all(jobs)).filter(Boolean).map(p => ({ ...p, weight: Number(process.env[`AI_WEIGHT_${p.provider.toUpperCase()}`] || 1) }));
}
async function predict(match) {
  const [h2h, liveNews] = await Promise.all([history(match.homeId, match.awayId), news(match.homeTeam, match.awayTeam)]);
  const baseline = poissonBaseline(1.45, 1.10);
  const models = await modelEnsemble(promptFor(match.homeTeam, match.awayTeam, h2h, liveNews, baseline));
  const ensemble = weightedEnsemble(models);
  if (!ensemble) { const p = baseline.probabilities; const verdict = p.home >= p.draw && p.home >= p.away ? 'HOME' : p.draw >= p.away ? 'DRAW' : 'AWAY'; return { score: baseline.score, confidence: Math.round(Math.max(p.home, p.draw, p.away) * 100), verdict, logic: 'Transparent statistical baseline; no AI provider responded.', doubleChance: p.home + p.draw >= 0.5 ? '1X' : 'X2', overUnder: baseline.over25 >= 0.5 ? 'Over 2.5' : 'Under 2.5', btts: baseline.btts >= 0.5 ? 'Yes' : 'No', handicap: '0', probabilities: p, modelCount: 0, agreement: 0, isValueBet: false, valueBets: [] }; }
  return { score: ensemble.score, confidence: ensemble.confidence, verdict: ensemble.verdict, logic: `Ensemble of ${ensemble.modelCount} independent models; agreement ${ensemble.agreement}%.`, doubleChance: ensemble.probabilities.home + ensemble.probabilities.draw >= 0.5 ? '1X' : 'X2', overUnder: ensemble.over25 >= 0.5 ? 'Over 2.5' : 'Under 2.5', btts: ensemble.btts >= 0.5 ? 'Yes' : 'No', handicap: '0', probabilities: ensemble.probabilities, modelCount: ensemble.modelCount, agreement: ensemble.agreement, isValueBet: false, valueBets: [], providers: ensemble.providers };
}
function normalize(m, source) {
  const home = m.homeTeam?.name || m.home_name || m.home || m.teams?.home?.name; const away = m.awayTeam?.name || m.away_name || m.away || m.teams?.away?.name;
  if (!home || !away) return null;
  return { id: String(m.id || m.fixture?.id || `${source}:${home}:${away}:${m.utcDate || m.date || ''}`), homeTeam: String(home), awayTeam: String(away), homeId: m.homeTeam?.id || m.teams?.home?.id || 0, awayId: m.awayTeam?.id || m.teams?.away?.id || 0, league: String(m.competition?.name || m.league?.name || m.league_name || 'Soccer'), status: String(m.status?.short || m.status || 'SCHEDULED'), utcDate: m.utcDate || m.fixture?.date || m.date || new Date().toISOString(), source };
}
function usable(m) { const s = m.status.toUpperCase(); if (/FINISHED|COMPLETED|FINAL|CANCELLED|ABANDONED/.test(s)) return false; const t = Date.parse(m.utcDate); return Number.isFinite(t) && t >= Date.now() - 30 * 60000; }
async function fetchFixtures() {
  if (fixtures.data.length && Date.now() - fixtures.fetchedAt < FIXTURE_CACHE_TTL_MS) return fixtures.data;
  const out = []; const now = new Date();
  if (process.env.FOOTBALL_DATA_API_KEY) try { const r = await axios.get('https://api.football-data.org/v4/matches', { params: { dateFrom: dateOnly(now), dateTo: dateOnly(new Date(now.getTime() + 7 * 86400000)) }, headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY }, timeout: 10000 }); for (const m of r.data?.matches || []) { const x = normalize(m, 'football-data'); if (x) out.push(x); } } catch (e) { console.log(`Football Data: ${e.message}`); }
  await Promise.all(['ENG.1','ESP.1','ITA.1','GER.1','FRA.1'].map(async league => { try { const r = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard`, { timeout: 8000 }); for (const e of r.data?.events || []) { const c = e.competitions?.[0]; const x = normalize({ id: e.id, homeTeam: c?.competitors?.find(v => v.homeAway === 'home')?.team, awayTeam: c?.competitors?.find(v => v.homeAway === 'away')?.team, competition: { name: league }, status: c?.status?.type?.name, utcDate: e.date }, 'espn'); if (x) out.push(x); } } catch (e) { console.log(`ESPN ${league}: ${e.message}`); } }));
  fixtures = { data: [...new Map(out.filter(usable).map(m => [`${m.homeTeam}|${m.awayTeam}|${m.utcDate.slice(0,10)}`, m])).values()], fetchedAt: Date.now() }; return fixtures.data;
}
async function processAll(list) {
  for (let i = 0; i < list.length; i += BATCH_SIZE) { const batch = list.slice(i, i + BATCH_SIZE); const saved = []; await Promise.all(batch.map(async m => { try { saved.push({ ...m, ai: await predict(m), processed: true, generatedAt: new Date().toISOString() }); } catch (e) { saved.push({ ...m, ai: { failed: true, score: 'N/A', confidence: 0, verdict: 'ERROR', logic: e.message }, processed: true, generatedAt: new Date().toISOString() }); } finally { status.processed++; } })); await store.savePredictions(saved); if (i + BATCH_SIZE < list.length) await sleep(BATCH_DELAY_MS); }
}
async function startPredictionRun() {
  if (status.isProcessing) return { status: 'already_processing', ...status };
  const list = (await fetchFixtures()).slice(0, MAX_MATCHES); if (!list.length) throw new Error('No upcoming matches available from configured data sources.');
  status = { total: list.length, processed: 0, isProcessing: true, startedAt: new Date().toISOString() };
  processAll(list).finally(() => { status.isProcessing = false; });
  return { status: 'started', total: list.length };
}
function authorizedCron(req) { return !CRON_SECRET || req.get('x-cron-secret') === CRON_SECRET; }
async function settleFinishedMatches() {
  const pending = await store.listPredictions({ history: false, limit: 1000 });
  const byId = new Map(pending.map(x => [String(x.id), x]));
  for (const league of ['ENG.1','ESP.1','ITA.1','GER.1','FRA.1']) {
    try { const r = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard`, { timeout: 8000 }); for (const e of r.data?.events || []) { const c = e.competitions?.[0]; const id = String(e.id); const row = byId.get(id); const score = c?.competitors?.find(v => v.homeAway === 'home')?.score; const awayScore = c?.competitors?.find(v => v.homeAway === 'away')?.score; const finished = /FINAL|POST/.test(String(c?.status?.type?.name || '').toUpperCase()); if (row && finished && Number.isFinite(Number(score)) && Number.isFinite(Number(awayScore))) await store.settlePrediction(id, Number(score), Number(awayScore), 'FINISHED'); } } catch (e) { console.log(`Settlement ${league}: ${e.message}`); }
  }
}
async function runAutomation() {
  const settings = await store.getAutomation(); if (!settings.enabled) return { status: 'disabled', settings };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone }).format(new Date());
  const nowParts = new Intl.DateTimeFormat('en-GB', { timeZone: settings.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const hour = Number(nowParts.find(x => x.type === 'hour')?.value); const minute = Number(nowParts.find(x => x.type === 'minute')?.value);
  if (settings.lastRunDate && String(settings.lastRunDate).slice(0,10) === today) return { status: 'already_run_today', settings };
  if (hour < settings.runHour || (hour === settings.runHour && minute < settings.runMinute)) return { status: 'waiting_for_run_time', settings };
  await store.markRun(today, 'RUNNING');
  try { const result = await startPredictionRun(); await store.markRun(today, 'STARTED'); return { ...result, date: today }; } catch (e) { await store.markRun(today, 'FAILED'); throw e; }
}

function rateLimit(req, res, next) { const key = req.ip || 'unknown'; const now = Date.now(); const x = requests.get(key) || { count: 0, reset: now + 60000 }; if (now > x.reset) { x.count = 0; x.reset = now + 60000; } if (++x.count > 30) return res.status(429).json({ error: 'Rate limit exceeded.' }); requests.set(key, x); next(); }
app.use('/api/', rateLimit);
app.get('/api/health', async (req,res) => res.json({ ok:true, service:'SureBet Pro', version:'2.1.0', database:!!store.pool, providers:{ footballData:!!process.env.FOOTBALL_DATA_API_KEY, gemini:!!googleKey, groq:!!process.env.GROQ_API_KEY, deepseek:!!process.env.DEEPSEEK_API_KEY, zai:!!process.env.Z_AI_API_KEY }, processing:status }));
app.get('/api/automation', async (req,res) => { try { res.json(await store.getAutomation()); } catch(e) { res.status(500).json({error:e.message}); } });
app.post('/api/automation', async (req,res) => { try { const b=req.body||{}; const hour=Number(b.runHour ?? 6), minute=Number(b.runMinute ?? 0); if(hour<0||hour>23||minute<0||minute>59) return res.status(400).json({error:'Invalid run time.'}); res.json(await store.setAutomation({ enabled:b.enabled, runHour:hour, runMinute:minute, timezone:b.timezone||'Africa/Kampala' })); } catch(e) { res.status(500).json({error:e.message}); } });
app.post('/api/automation/run', async (req,res) => { if(!authorizedCron(req)) return res.status(401).json({error:'Unauthorized'}); try { const result=await runAutomation(); await settleFinishedMatches(); res.json(result); } catch(e) { res.status(500).json({error:e.message}); } });
app.post('/api/start-predictions', async (req,res) => { try { res.json(await startPredictionRun()); } catch(e) { res.status(503).json({error:e.message}); } });
app.get('/api/predictions', async (req,res) => { try { const rows=await store.listPredictions({history:true,limit:1000}); res.json({ predictions:rows.map(x=>({...x,date:new Date(x.utcDate).toLocaleString()})), ...status }); } catch(e) { res.status(500).json({error:e.message}); } });
app.get('/api/performance', async (req,res) => { try { res.json(await store.getPerformance()); } catch(e) { res.status(500).json({error:e.message}); } });
app.post('/api/value', (req,res) => { const {probabilities,odds}=req.body||{}; if(!probabilities||!odds) return res.status(400).json({error:'probabilities and decimal odds are required.'}); res.json({valueBets:valueFromOdds(probabilities,odds)||[],noVigMarket:noVig(probabilities,odds)}); });
app.post('/api/predict-batch', async (req,res) => { const input=Array.isArray(req.body?.matches)?req.body.matches.slice(0,20):[]; if(!input.length)return res.status(400).json({error:'matches must be a non-empty array.'}); const out=[]; for(const raw of input){const m=normalize(raw,'request');if(!m)continue;const existing=(await store.listPredictions({history:true,limit:1000})).find(x=>x.id===m.id);if(existing)out.push(existing);else{const x={...m,ai:await predict(m),processed:true,generatedAt:new Date().toISOString()};await store.savePredictions([x]);out.push(x);}}res.json(out);});
app.get('/api/football-data/matches', async (req,res) => { if(!process.env.FOOTBALL_DATA_API_KEY)return res.status(503).json({error:'FOOTBALL_DATA_API_KEY not configured.'}); try{const r=await axios.get('https://api.football-data.org/v4/matches',{params:{dateFrom:dateOnly(new Date()),dateTo:dateOnly(new Date(Date.now()+7*86400000))},headers:{'X-Auth-Token':process.env.FOOTBALL_DATA_API_KEY},timeout:10000});res.json(r.data);}catch(_){res.status(502).json({error:'Failed to fetch football matches.'});}});

(async()=>{ try { await store.init(); } catch(e) { console.error('Database initialization failed:',e.message); } app.listen(PORT,()=>console.log(`🚀 SureBet Pro engine listening on ${PORT}`)); })();
module.exports={app,predict,fetchFixtures,startPredictionRun,runAutomation,settleFinishedMatches};