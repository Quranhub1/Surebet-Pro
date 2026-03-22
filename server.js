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
console.log('==========================');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY);
const leadAnalyst = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Store predictions in memory
let predictionsCache = {};
let processingStatus = { total: 0, processed: 0, isProcessing: false };

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
 * Get prediction with more betting markets
 */
async function getPrediction(homeTeam, awayTeam, h2h, news, auditStr) {
    // Try Google AI first
    if (process.env.GOOGLE_AI_API_KEY) {
        try {
            const prompt = `Match: ${homeTeam} vs ${awayTeam}. H2H: ${h2h}. Audit: ${auditStr}. News: ${news}.
            Provide comprehensive prediction JSON:
            {"score":"X-Y","confidence":0-100,"verdict":"Pick","logic":"10 words",
            "doubleChance":"1X, X2, or 12",
            "overUnder":"Over 2.5 or Under 2.5",
            "btts":"Yes or No",
            "handicap":"Home -1, Away +1, or 0",
            "isValueBet":bool}`;
            
            const gemRes = await leadAnalyst.generateContent(prompt);
            const rawJson = gemRes.response.text();
            const jsonMatch = rawJson.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                const prediction = JSON.parse(jsonMatch[0]);
                console.log(`   ✅ Google AI: ${prediction.score}`);
                return prediction;
            }
        } catch (googleErr) {
            console.log(`   ⚠️ Google AI failed: ${googleErr.message.substring(0, 50)}`);
            if (googleErr.message.includes('429') || googleErr.message.includes('quota')) {
                console.log(`   🔄 Quota exceeded, switching to Groq...`);
            }
        }
    }
    
    // Fallback to Groq
    if (process.env.GROQ_API_KEY) {
        try {
            console.log(`   🔄 Using Groq fallback...`);
            const groqRes = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Football expert predictor. Return JSON with score, confidence (0-100), verdict, logic (10 words), doubleChance (1X/X2/12), overUnder (Over 2.5/Under 2.5), btts (Yes/No), handicap, isValueBet (bool)." },
                    { role: "user", content: `Match: ${homeTeam} vs ${awayTeam}. H2H: ${h2h}. Audit: ${auditStr}. News: ${news}. Provide prediction in JSON format.` }
                ],
                model: "llama-3.1-8b-instant",
                temperature: 0.7
            });
            
            const content = groqRes.choices[0].message.content;
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                const prediction = JSON.parse(jsonMatch[0]);
                console.log(`   ✅ Groq: ${prediction.score}`);
                return prediction;
            }
        } catch (groqErr) {
            console.log(`   ❌ Groq also failed: ${groqErr.message}`);
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
        const dateStr = formatDate(today);
        
        console.log('=== Starting prediction fetch ===');
        console.log('RAPIDAPI_KEY set:', !!process.env.RAPIDAPI_KEY);
        console.log('FOOTBALL_DATA_API_KEY set:', !!process.env.FOOTBALL_DATA_API_KEY);
        
        // Use API-Football (RapidAPI) for worldwide coverage
        if (process.env.RAPIDAPI_KEY) {
            console.log('Fetching with API-Football (RapidAPI)...');
            
            // Top leagues IDs for worldwide coverage
            const leagueIds = [
                2,    // UEFA Champions League
                3,    // UEFA Europa League
                1,    // UEFA Super Cup
                31,   // Premier League (England)
                39,   // Premier League (Russia)
                140,  // La Liga (Spain)
                135,  // Serie A (Italy)
                78,   // Bundesliga (Germany)
                61,   // Ligue 1 (France)
                88,   // Eredivisie (Netherlands)
                23,   // UEFA Nations League
                45,   // FIFA World Cup
                36,   // Copa del Rey
                43,   // League Cup (England)
                48,   // Serie B (Italy)
                50,   // Ligue 2
                52,   // 2. Bundesliga
                32,   // Championship
                33,   // League One
                34,   // League Two
                41,   // Scottish Premiership
                40,   // Scottish Championship
                73,   // Portuguese Primeira Liga
                94,   // Belgian Pro League
                157,  // MLS (USA)
                131,  // Argentine Liga
                132,  // Brazilian Serie A
                103,  // Saudi Pro League
                99,   // Turkish Super Lig
                144,  // Austrian Bundesliga
                189,  // Swiss Super League
                222,  // Greek Super League
                218,  // Czech Liga
                207,  // Danish Super Liga
                179,  // Norwegian Eliteserien
                176,  // Swedish Allsvenskan
                55,   // Romanian Liga I
                263,  // Australian A-League
                98,   // Japanese J1 League
                292,  // Korean K League
                382,  // Indian Super League
                293,  // Chinese Super League
                254,  // MLS Next Pro
                285,  // CONCACAF Champions Cup
                15,   // FIFA Club World Cup
                16,   // UEFA Champions League Women
                4,    // FIFA U-20 World Cup
                5,    // FIFA U-17 World Cup
                27,   // Copa America
                6,    // UEFA Euro Qualifier
            ];
            
            // Fetch from multiple leagues for today + next 3 days
            for (let dayOffset = 0; dayOffset < 4; dayOffset++) {
                const targetDate = new Date(today.getTime() + dayOffset * 24 * 60 * 60 * 1000);
                const fromDate = formatDate(targetDate);
                const toDate = fromDate;
                
                for (const leagueId of leagueIds.slice(0, 30)) { // Limit to avoid rate limits
                    try {
                        const response = await axios.get(
                            `https://api-football-v1.p.rapidapi.com/v3/fixtures`,
                            {
                                params: {
                                    league: leagueId,
                                    season: 2024,
                                    from: fromDate,
                                    to: toDate
                                },
                                headers: {
                                    'x-rapidapi-key': process.env.RAPIDAPI_KEY,
                                    'x-rapidapi-host': 'api-football-v1.p.rapidapi.com'
                                }
                            }
                        );
                        
                        const fixtures = response.data.response || [];
                        const matches = fixtures.map(m => ({
                            id: m.fixture.id,
                            homeTeam: m.teams.home.name,
                            awayTeam: m.teams.away.name,
                            homeId: m.teams.home.id,
                            awayId: m.teams.away.id,
                            league: m.league.name,
                            status: m.fixture.status.short,
                            utcDate: m.fixture.date,
                            date: new Date(m.fixture.date).toLocaleString(),
                            score: m.goals.home !== null ? `${m.goals.home}-${m.goals.away}` : null
                        }));
                        
                        allMatches.push(...matches);
                        console.log(`   League ${leagueId} (${fromDate}): ${matches.length} matches`);
                    } catch (e) {
                        // Silently continue on rate limits
                    }
                    
                    await new Promise(r => setTimeout(r, 200));
                }
            }
        } else {
            // Fallback to Football Data API
            console.log('Fetching with Football Data API...');
            
            for (let i = 0; i < 14; i++) {
                const targetDate = new Date(today.getTime() + i*24*60*60*1000);
                const dateStr = formatDate(targetDate);
                
                try {
                    const response = await axios.get(
                        `https://api.football-data.org/v4/matches?date=${dateStr}`,
                        { headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY } }
                    );
                    
                    const matches = (response.data.matches || []).map(m => ({
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
                    
                    allMatches.push(...matches);
                    console.log(`   Day ${i+1} (${dateStr}): ${matches.length} matches`);
                } catch (e) {
                    console.log(`   Day ${i+1}: API error`);
                }
                
                await new Promise(r => setTimeout(r, 500));
            }
        }
        
        // Remove duplicates by ID
        const uniqueMatches = [];
        const seen = new Set();
        for (const m of allMatches) {
            if (!seen.has(m.id)) {
                seen.add(m.id);
                uniqueMatches.push(m);
            }
        }
        
        const matches = uniqueMatches.slice(0, 200);
        console.log(`\nTotal unique matches: ${matches.length}`);
        
        if (matches.length === 0) {
            return res.json({ error: 'No matches found. Add RAPIDAPI_KEY for more matches.' });
        }
        
        predictionsCache = {};
        processingStatus = { total: matches.length, processed: 0, isProcessing: true };
        
        // Start processing in background
        processBatch(matches, 0);
        
        res.json({ status: 'started', total: matches.length });
        
    } catch (e) {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 JOESBET Hub live on ${PORT}`));