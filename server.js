require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

// Log environment variables
console.log('=== Environment Check ===');
console.log('FOOTBALL_DATA_API_KEY:', process.env.FOOTBALL_DATA_API_KEY ? '✓ Set' : '✗ Missing');
console.log('GOOGLE_AI_API_KEY:', process.env.GOOGLE_AI_API_KEY ? '✓ Set' : '✗ Missing');
console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY ? '✓ Set' : '✗ Missing');
console.log('DEEPSEEK_API_KEY:', process.env.DEEPSEEK_API_KEY ? '✓ Set' : '✗ Missing');
console.log('Z_AI_API_KEY:', process.env.Z_AI_API_KEY ? '✓ Set' : '✗ Missing');
console.log('RAPIDAPI_KEY:', process.env.RAPIDAPI_KEY ? '✓ Set' : '✗ Missing');
console.log('LIVESCORE_API_KEY:', process.env.LIVESCORE_API_KEY ? '✓ Set' : '✗ Missing');
console.log('==========================');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY);
const leadAnalyst = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Store predictions in memory
let predictionsCache = {};
let processingStatus = { total: 0, processed: 0, isProcessing: false };

// Cached fixtures - fetched once per day
let fixturesCache = { data: [], lastFetch: null };
const CACHE_FILE = 'fixtures-cache.json';
const fs = require('fs');

// Load cached fixtures from file
function loadCachedFixtures() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf8');
            fixturesCache = JSON.parse(data);
            console.log(`📁 Loaded ${fixturesCache.data.length} cached fixtures from file`);
        }
    } catch (e) {
        console.log('📁 No cached fixtures found');
    }
}

// Save fixtures to cache file
function saveCachedFixtures(matches) {
    try {
        fixturesCache = {
            data: matches,
            lastFetch: new Date().toISOString()
        };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(fixturesCache));
        console.log(`💾 Saved ${matches.length} fixtures to cache`);
    } catch (e) {
        console.log(`💾 Failed to save cache: ${e.message}`);
    }
}

// Check if cache is still valid (less than 1 hour old)
function isCacheValid() {
    if (!fixturesCache.lastFetch) return false;
    const hoursDiff = (Date.now() - new Date(fixturesCache.lastFetch).getTime()) / (1000 * 60 * 60);
    return hoursDiff < 1;  // Cache valid for 1 hour (matches auto-generation interval)
}

// Load cached fixtures on startup
loadCachedFixtures();

/**
 * FETCH HISTORICAL H2H
 */
async function getHistory(h, a) {
    if (!process.env.RAPIDAPI_KEY) return "No history.";
    try {
        const res = await axios.get(`https://api-football-v1.p.rapidapi.com/v3/fixtures/headtohead`, {
            params: { h2h: `${h}-${a}`, last: 3 },
            headers: { 'x-rapidapi-key': process.env.RAPIDAPI_KEY, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
        });
        const games = res.data.response || [];
        return games.length ? games.map(g => `${g.goals.home}-${g.goals.away}`).join(' | ') : "No recent data.";
    } catch (e) { 
        return "Data timeout."; 
    }
}

/**
 * FETCH LIVE NEWS
 */
async function getLiveIntel(home, away) {
    if (!process.env.TAVILY_API_KEY) return "No news.";
    try {
        const res = await axios.post('https://api.tavily.com/search', {
            api_key: process.env.TAVILY_API_KEY,
            query: `${home} vs ${away} lineups injury updates football today`,
            max_results: 1
        });
        return res.data.results[0]?.content.substring(0, 500) || "Stable status.";
    } catch (e) { 
        return "News fail."; 
    }
}

/**
 * Get prediction with more betting markets - 4-tier fallback
 */
async function getPrediction(homeTeam, awayTeam, h2h, news, auditStr) {
    const prompt = `Match: ${homeTeam} vs ${awayTeam}. H2H: ${h2h}. Audit: ${auditStr}. News: ${news}.
    Provide prediction JSON:
    {"score":"X-Y","confidence":0-100,"verdict":"Pick","logic":"10 words",
    "doubleChance":"1X/X2/12","overUnder":"Over 2.5/Under 2.5","btts":"Yes/No","handicap":"0/+1/-1","isValueBet":bool}`;
    
    // 1. Try Google Gemini AI
    if (process.env.GOOGLE_AI_API_KEY) {
        try {
            const gemRes = await leadAnalyst.generateContent(prompt);
            let rawJson = gemRes.response.text();
            
            // Clean response
            rawJson = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
            const jsonMatch = rawJson.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                const prediction = JSON.parse(jsonMatch[0]);
                const result = {
                    score: prediction.score || '0-0',
                    confidence: Math.min(100, Math.max(0, parseInt(prediction.confidence) || 50)),
                    verdict: prediction.verdict || 'HOME',
                    logic: prediction.logic || 'Auto prediction',
                    doubleChance: prediction.doubleChance || '1X',
                    overUnder: prediction.overUnder || 'Over 2.5',
                    btts: prediction.btts || 'Yes',
                    handicap: prediction.handicap || '0',
                    isValueBet: Boolean(prediction.isValueBet)
                };
                console.log(`   ✅ Google Gemini: ${result.score}`);
                return result;
            }
        } catch (e) {
            console.log(`   ⚠️ Gemini failed: ${e.response?.status || e.message.substring(0,40)}`);
        }
    }
    
    // 2. Try DeepSeek
    if (process.env.DEEPSEEK_API_KEY) {
        try {
            console.log(`   🔄 Trying DeepSeek...`);
            const deepseekRes = await axios.post(
                'https://api.deepseek.com/v1/chat/completions',
                {
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: 'Football expert. Always respond with valid JSON only.' },
                        { role: 'user', content: `Match: ${homeTeam} vs ${awayTeam}. H2H: ${h2h}. Predict score, confidence, verdict (HOME/DRAW/AWAY), logic, doubleChance, overUnder, btts, handicap, isValueBet. JSON only.` }
                    ],
                    temperature: 0.3
                },
                {
                    headers: { 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` }
                }
            );
            
            let content = deepseekRes.data.choices[0].message.content;
            content = content.replace(/```json/g, '').replace(/```/g, '').trim();
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                const prediction = JSON.parse(jsonMatch[0]);
                const result = {
                    score: prediction.score || '0-0',
                    confidence: Math.min(100, Math.max(0, parseInt(prediction.confidence) || 50)),
                    verdict: prediction.verdict || 'HOME',
                    logic: prediction.logic || 'Auto prediction',
                    doubleChance: prediction.doubleChance || '1X',
                    overUnder: prediction.overUnder || 'Over 2.5',
                    btts: prediction.btts || 'Yes',
                    handicap: prediction.handicap || '0',
                    isValueBet: Boolean(prediction.isValueBet)
                };
                console.log(`   ✅ DeepSeek: ${result.score}`);
                return result;
            }
        } catch (e) {
            console.log(`   ⚠️ DeepSeek failed: ${e.response?.status || e.message.substring(0,40)}`);
        }
    }
    
    // 3. Try Z.ai
    if (process.env.Z_AI_API_KEY) {
        try {
            console.log(`   🔄 Trying Z.ai...`);
            const zRes = await axios.post(
                'https://api.z.ai/v1/chat/completions',
                {
                    model: 'default',
                    messages: [
                        { role: 'system', content: 'Football expert. Always respond with valid JSON only.' },
                        { role: 'user', content: `Match: ${homeTeam} vs ${awayTeam}. H2H: ${h2h}. Predict score, confidence, verdict (HOME/DRAW/AWAY), logic, doubleChance, overUnder, btts, handicap, isValueBet. JSON only.` }
                    ],
                    temperature: 0.3
                },
                {
                    headers: { 'Authorization': `Bearer ${process.env.Z_AI_API_KEY}` }
                }
            );
            
            let content = zRes.data.choices[0].message.content;
            content = content.replace(/```json/g, '').replace(/```/g, '').trim();
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                const prediction = JSON.parse(jsonMatch[0]);
                const result = {
                    score: prediction.score || '0-0',
                    confidence: Math.min(100, Math.max(0, parseInt(prediction.confidence) || 50)),
                    verdict: prediction.verdict || 'HOME',
                    logic: prediction.logic || 'Auto prediction',
                    doubleChance: prediction.doubleChance || '1X',
                    overUnder: prediction.overUnder || 'Over 2.5',
                    btts: prediction.btts || 'Yes',
                    handicap: prediction.handicap || '0',
                    isValueBet: Boolean(prediction.isValueBet)
                };
                console.log(`   ✅ Z.ai: ${result.score}`);
                return result;
            }
        } catch (e) {
            console.log(`   ⚠️ Z.ai failed: ${e.response?.status || e.message.substring(0,40)}`);
        }
    }
    
    // 3. Fallback to Groq
    if (process.env.GROQ_API_KEY) {
        try {
            console.log(`   🔄 Trying Groq (final fallback)...`);
            const groqRes = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "You are a football prediction expert. ALWAYS respond with valid JSON only. No markdown, no explanation." },
                    { role: "user", content: `Match: ${homeTeam} vs ${awayTeam}. H2H: ${h2h}. News: ${news}. Predict: score (like 2-1), confidence (0-100), verdict (HOME/DRAW/AWAY), logic (short reason), doubleChance (1X/X2/12), overUnder (Over 2.5/Under 2.5), btts (Yes/No), handicap (0/+1/-1), isValueBet (true/false). Return JSON only.` }
                ],
                model: "llama-3.1-8b-instant",
                temperature: 0.3
            });
            
            let content = groqRes.choices[0].message.content;
            
            // Clean the response - remove markdown code blocks
            content = content.replace(/```json/g, '').replace(/```/g, '').trim();
            
            // Find JSON in response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                const prediction = JSON.parse(jsonMatch[0]);
                // Ensure all required fields
                const result = {
                    score: prediction.score || '0-0',
                    confidence: Math.min(100, Math.max(0, parseInt(prediction.confidence) || 50)),
                    verdict: prediction.verdict || 'HOME',
                    logic: prediction.logic || 'Auto prediction',
                    doubleChance: prediction.doubleChance || '1X',
                    overUnder: prediction.overUnder || 'Over 2.5',
                    btts: prediction.btts || 'Yes',
                    handicap: prediction.handicap || '0',
                    isValueBet: Boolean(prediction.isValueBet)
                };
                console.log(`   ✅ Groq: ${result.score}`);
                return result;
            } else {
                console.log(`   ⚠️ Groq: No JSON found in response`);
            }
        } catch (e) {
            console.log(`   ❌ Groq failed: ${e.message}`);
        }
    }
    
    return null;
}

/**
 * Process a batch of matches
 */
async function processBatch(matches, startIndex) {
    const batchSize = 15;
    const endIndex = Math.min(startIndex + batchSize, matches.length);
    
    for (let i = startIndex; i < endIndex; i++) {
        const match = matches[i];
        
        try {
            console.log(`\n🤖 [${i+1}/${matches.length}] ${match.homeTeam} vs ${match.awayTeam}`);

            const [h2h, news] = await Promise.all([
                getHistory(match.homeId, match.awayId),
                getLiveIntel(match.homeTeam, match.awayTeam)
            ]);

            let auditStr = "No audit.";
            if (process.env.GROQ_API_KEY) {
                try {
                    const groqRes = await groq.chat.completions.create({
                        messages: [{ role: "system", content: "Expert bet auditor. Find trap. 1 sentence." }, 
                                   { role: "user", content: `H2H: ${h2h}. News: ${news}.` }],
                        model: "llama-3.1-8b-instant"
                    });
                    auditStr = groqRes.choices[0].message.content;
                } catch (e) {}
            }

            const prediction = await getPrediction(match.homeTeam, match.awayTeam, h2h, news, auditStr);
            
            if (prediction) {
                predictionsCache[match.id] = { 
                    id: match.id,
                    homeTeam: match.homeTeam,
                    awayTeam: match.awayTeam,
                    homeId: match.homeId,
                    awayId: match.awayId,
                    league: match.league,
                    status: match.status,
                    utcDate: match.utcDate,
                    date: match.date,
                    ai: { ...prediction, audit: auditStr },
                    processed: true
                };
            } else {
                predictionsCache[match.id] = { 
                    id: match.id,
                    homeTeam: match.homeTeam,
                    awayTeam: match.awayTeam,
                    homeId: match.homeId,
                    awayId: match.awayId,
                    league: match.league,
                    status: match.status,
                    utcDate: match.utcDate,
                    date: match.date,
                    ai: { score: "N/A", confidence: 0, verdict: "Failed", logic: "API error", failed: true },
                    processed: true
                };
            }
            
            processingStatus.processed = Object.keys(predictionsCache).length;
            
            // 10 second delay between batches
            if (i < endIndex - 1) {
                await new Promise(r => setTimeout(r, 1000));
            }
            
        } catch (err) {
            console.error(`   ❌ Failed: ${err.message}`);
            predictionsCache[match.id] = { 
                id: match.id,
                homeTeam: match.homeTeam,
                awayTeam: match.awayTeam,
                homeId: match.homeId,
                awayId: match.awayId,
                league: match.league,
                status: match.status,
                utcDate: match.utcDate,
                date: match.date,
                ai: { score: "N/A", confidence: 0, verdict: "Error", logic: err.message, failed: true },
                processed: true
            };
        }
    }
    
    // If more matches to process, schedule next batch
    if (endIndex < matches.length) {
        console.log(`\n📊 Processed ${endIndex}/${matches.length}. Waiting 10s for next batch...`);
        setTimeout(() => processBatch(matches, endIndex), 10000);
    } else {
        console.log(`\n✅ All ${matches.length} predictions complete!`);
        processingStatus.isProcessing = false;
    }
}

// Helper: format date for API (YYYY-MM-DD)
const formatDate = (d) => d.toISOString().split('T')[0];

// Start processing endpoint
app.post('/api/start-predictions', async (req, res) => {
    if (processingStatus.isProcessing) {
        return res.json({ status: 'already_processing', ...processingStatus });
    }
    
    try {
        const allMatches = [];
        const today = new Date();
        
        console.log('=== Fetching matches ===');
        console.log('RAPIDAPI_KEY:', !!process.env.RAPIDAPI_KEY);
        console.log('FOOTBALL_DATA_API_KEY:', !!process.env.FOOTBALL_DATA_API_KEY);
        
        // Check cache first
        if (isCacheValid() && fixturesCache.data.length > 0) {
            console.log(`📦 Using cached fixtures (${fixturesCache.data.length} matches)`);
            allMatches.push(...fixturesCache.data);
        } else {
            // Fetch fresh data from APIs
            console.log('🔄 Cache invalid or empty, fetching fresh data...');
            
            // PRIMARY: Free Livescore API (RapidAPI) - more matches worldwide
            if (process.env.RAPIDAPI_KEY) {
                console.log('Using Free Livescore API (PRIMARY)...');
                
                try {
                    const response = await axios.get(
                        'https://free-livescore-api.p.rapidapi.com/livescore-get-search',
                        {
                            params: { keyword: 'football' },
                            headers: { 
                                'x-rapidapi-key': process.env.RAPIDAPI_KEY, 
                                'x-rapidapi-host': 'free-livescore-api.p.rapidapi.com',
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    
                    const data = response.data.response || [];
                    console.log(`Livescore API returned: ${data.length} items`);
                    
                    for (const item of data) {
                        if (item.homeTeam && item.awayTeam) {
                            allMatches.push({
                                id: item.id || Math.random(),
                                homeTeam: item.homeTeam.name || item.homeTeam || 'Unknown',
                                awayTeam: item.awayTeam.name || item.awayTeam || 'Unknown',
                                homeId: item.homeTeam.id || 0,
                                awayId: item.awayTeam.id || 0,
                                league: item.league?.name || item.league || 'Unknown',
                                status: item.status?.short || item.status || 'SCHEDULED',
                                utcDate: item.date || today.toISOString(),
                                date: new Date().toLocaleString()
                            });
                        }
                    }
                    console.log(`Parsed ${allMatches.length} matches from Livescore`);
                } catch (e) {
                    console.log(`Livescore API Error: ${e.response?.status || e.message}`);
                }
            }
            
            // SECONDARY: Add matches from Livescore API
            if (process.env.LIVESCORE_API_KEY && process.env.LIVESCORE_API_SECRET && allMatches.length < 100) {
                console.log('Adding matches from Livescore API...');
                
                try {
                    const response = await axios.get(
                        'https://livescore-api.com/api-client/users/pair.json',
                        {
                            params: {
                                key: process.env.LIVESCORE_API_KEY,
                                secret: process.env.LIVESCORE_API_SECRET
                            }
                        }
                    );
                    
                    const data = response.data;
                    
                    if (data.matches) {
                        const matches = data.matches.map(m => ({
                            id: m.id || Math.random(),
                            homeTeam: m.home || m.home_team || 'Unknown',
                            awayTeam: m.away || m.away_team || 'Unknown',
                            homeId: 0,
                            awayId: 0,
                            league: m.league || m.competition || 'Unknown',
                            status: m.status || 'SCHEDULED',
                            utcDate: m.time || m.date || today.toISOString(),
                            date: new Date().toLocaleString()
                        }));
                        
                        allMatches.push(...matches);
                        console.log(`Livescore API: ${matches.length} matches`);
                    }
                } catch (e) {
                    console.log(`Livescore API Error: ${e.response?.status || e.message}`);
                }
            }
            
            // TERTIARY: Add matches from Football Data API (fallback)
            if (process.env.FOOTBALL_DATA_API_KEY && allMatches.length < 50) {
                console.log('Adding matches from Football Data API (fallback)...');
                
                for (let i = 0; i < 7; i++) {
                    const dateStr = formatDate(new Date(today.getTime() + i*24*60*60*1000));
                    try {
                        const response = await axios.get(
                            `https://api.football-data.org/v4/matches?date=${dateStr}`,
                            { headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY } }
                        );
                        
                        const newMatches = (response.data.matches || []).map(m => ({
                            id: m.id,
                            homeTeam: m.homeTeam.name,
                            awayTeam: m.awayTeam.name,
                            homeId: m.homeTeam.id,
                            awayId: m.awayTeam.id,
                            league: m.competition.name,
                            status: m.status,
                            utcDate: m.utcDate,
                            date: new Date(m.utcDate).toLocaleString()
                        }));
                        
                        allMatches.push(...newMatches);
                        console.log(`Football Data ${dateStr}: ${newMatches.length} matches`);
                    } catch (e) {
                        console.log(`Football Data ${dateStr}: Error`);
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            
            // Save to cache for future use
            if (allMatches.length > 0) {
                saveCachedFixtures(allMatches);
            }
        }
        
        // Remove duplicates
        const unique = [];
        const seen = new Set();
        for (const m of allMatches) {
            if (!seen.has(m.id)) {
                seen.add(m.id);
                unique.push(m);
            }
        }
        
        const matches = unique.slice(0, 200);
        console.log(`Total unique: ${matches.length} matches`);
        
        if (matches.length === 0) {
            return res.json({ error: 'No matches found. Check API keys.' });
        }
        
        predictionsCache = {};
        processingStatus = { total: matches.length, processed: 0, isProcessing: true };
        
        processBatch(matches, 0);
        res.json({ status: 'started', total: matches.length });
        
    } catch (e) {
        console.error('Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Get current predictions
app.get('/api/predictions', (req, res) => {
    const predictions = Object.values(predictionsCache).filter(p => p.processed);
    const failed = predictions.filter(p => p.ai?.failed);
    const successful = predictions.filter(p => !p.ai?.failed);
    
    // Sanitize: ensure only string properties are returned
    const sanitizePrediction = (p) => ({
        id: p.id,
        homeTeam: String(p.homeTeam || 'Unknown'),
        awayTeam: String(p.awayTeam || 'Unknown'),
        league: String(p.league || 'Unknown'),
        status: String(p.status || 'SCHEDULED'),
        date: String(p.date || ''),
        ai: p.ai ? {
            score: String(p.ai.score || 'N/A'),
            confidence: Number(p.ai.confidence) || 0,
            verdict: String(p.ai.verdict || '-'),
            logic: String(p.ai.logic || ''),
            audit: String(p.ai.audit || ''),
            doubleChance: String(p.ai.doubleChance || '-'),
            overUnder: String(p.ai.overUnder || '-'),
            btts: String(p.ai.btts || '-'),
            handicap: String(p.ai.handicap || '-'),
            isValueBet: Boolean(p.ai.isValueBet)
        } : null
    });
    
    res.json({ 
        predictions: successful.map(sanitizePrediction),
        failedCount: failed.length,
        total: processingStatus.total,
        processed: processingStatus.processed,
        isProcessing: processingStatus.isProcessing
    });
});

// Legacy endpoint
app.post('/api/predict-batch', async (req, res) => {
    const { matches } = req.body;
    if (!matches || !Array.isArray(matches)) {
        return res.status(400).json({ error: 'Invalid matches data' });
    }
    
    const results = [];
    for (const match of matches) {
        if (predictionsCache[match.id]) {
            results.push(predictionsCache[match.id]);
        } else {
            // Only use explicitly extracted string properties, not the full object
            results.push({ 
                id: match.id,
                homeTeam: typeof match.homeTeam === 'string' ? match.homeTeam : (match.homeTeam?.name || 'Unknown'),
                awayTeam: typeof match.awayTeam === 'string' ? match.awayTeam : (match.awayTeam?.name || 'Unknown'),
                league: match.competition?.name || match.league || 'Unknown',
                status: match.status || 'SCHEDULED',
                date: match.date || new Date(match.utcDate).toLocaleString(),
                ai: { score: "Pending", confidence: 0, verdict: "Processing" }
            });
        }
    }
    res.json(results);
});

// Football API proxy
app.get('/api/football-data/matches', async (req, res) => {
    if (!process.env.FOOTBALL_DATA_API_KEY) {
        return res.status(500).json({ error: 'FOOTBALL_DATA_API_KEY not configured.' });
    }
    try {
        const response = await axios.get('https://api.football-data.org/v4/matches', { 
            headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY } 
        });
        res.json(response.data);
    } catch (e) { 
        res.status(500).json({ error: 'Failed to fetch matches.' }); 
    }
});

// Auto-generate predictions every 1 hour
const AUTO_GENERATE_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds

// Flag to prevent overlapping auto-generations
let autoGenerateInProgress = false;

async function autoGeneratePredictions() {
    if (autoGenerateInProgress) {
        console.log('⏳ Auto-generation skipped - previous generation still in progress');
        return;
    }
    
    if (processingStatus.isProcessing) {
        console.log('⏳ Auto-generation skipped - manual generation in progress');
        return;
    }
    
    console.log(`\n⏰ Auto-generation triggered (every ${AUTO_GENERATE_INTERVAL/1000/60} hour)`);
    autoGenerateInProgress = true;
    
    try {
        const allMatches = [];
        const today = new Date();
        
        // Always fetch fresh data for auto-generation (skip cache to ensure fresh matches)
        console.log('🔄 Fetching fresh match data for auto-generation...');
        
        if (process.env.RAPIDAPI_KEY) {
            try {
                const response = await axios.get(
                    'https://free-livescore-api.p.rapidapi.com/livescore-get-search',
                    { params: { keyword: 'football' }, headers: { 'x-rapidapi-key': process.env.RAPIDAPI_KEY, 'x-rapidapi-host': 'free-livescore-api.p.rapidapi.com', 'Content-Type': 'application/json' } }
                );
                const data = response.data.response || [];
                console.log(`📊 Livescore API returned ${data.length} items`);
                for (const item of data) {
                    if (item.homeTeam && item.awayTeam) {
                        allMatches.push({ id: item.id || Math.random(), homeTeam: item.homeTeam.name || item.homeTeam, awayTeam: item.awayTeam.name || item.awayTeam, homeId: item.homeTeam.id || 0, awayId: item.homeTeam.id || 0, league: item.league?.name || item.league || 'Unknown', status: item.status?.short || item.status || 'SCHEDULED', utcDate: item.date || today.toISOString(), date: new Date().toLocaleString() });
                    }
                }
            } catch (e) { console.log(`Livescore API Error: ${e.message}`); }
        }
        
        // Also fetch from Football Data API to ensure we have enough matches
        if (process.env.FOOTBALL_DATA_API_KEY) {
            for (let i = 0; i < 7; i++) {
                const dateStr = formatDate(new Date(today.getTime() + i*24*60*60*1000));
                try {
                    const response = await axios.get(`https://api.football-data.org/v4/matches?date=${dateStr}`, { headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY } });
                    const newMatches = (response.data.matches || []).map(m => ({ id: m.id, homeTeam: m.homeTeam.name, awayTeam: m.awayTeam.name, homeId: m.homeTeam.id, awayId: m.awayTeam.id, league: m.competition.name, status: m.status, utcDate: m.utcDate, date: new Date(m.utcDate).toLocaleString() }));
                    allMatches.push(...newMatches);
                    console.log(`📊 Football Data ${dateStr}: ${newMatches.length} matches`);
                } catch (e) { console.log(`Football Data ${dateStr}: Error`); }
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        
        console.log(`📊 Total matches before dedup: ${allMatches.length}`);
        
        if (allMatches.length > 0) saveCachedFixtures(allMatches);
        
        // Remove duplicates
        const unique = [];
        const seen = new Set();
        for (const m of allMatches) {
            if (!seen.has(m.id)) { seen.add(m.id); unique.push(m); }
        }
        const matches = unique.slice(0, 200);
        
        if (matches.length > 0) {
            predictionsCache = {};
            processingStatus = { total: matches.length, processed: 0, isProcessing: true };
            processBatch(matches, 0);
            console.log('✅ Auto-generation started');
        } else {
            console.log('⚠️ No matches found for auto-generation');
        }
    } catch (e) {
        console.error('❌ Auto-generation error:', e.message);
    } finally {
        autoGenerateInProgress = false;
    }
}

// Start auto-generation after 1 hour, then repeat every hour
setTimeout(() => {
    autoGeneratePredictions();
    setInterval(autoGeneratePredictions, AUTO_GENERATE_INTERVAL);
}, AUTO_GENERATE_INTERVAL);

console.log(`⏰ Auto-generation scheduled: First run in ${AUTO_GENERATE_INTERVAL/1000/60} hour, then every hour`);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 JOESBET Hub live on ${PORT}`));