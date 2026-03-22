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

/**
 * FETCH HISTORICAL H2H (Statistician Agent)
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
 * FETCH LIVE NEWS (Researcher Agent)
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
 * Try Google AI first, fallback to Groq
 */
async function getPrediction(homeTeam, awayTeam, h2h, news, auditStr) {
    // Try Google AI first
    if (process.env.GOOGLE_AI_API_KEY) {
        try {
            const prompt = `Match: ${homeTeam} vs ${awayTeam}. H2H: ${h2h}. Audit: ${auditStr}. News: ${news}.
            Decide Score/Outcome. Be decisive. JSON only: {"score":"X-Y","confidence":0-100,"verdict":"type","logic":"10 words max","isValueBet":bool}`;
            
            const gemRes = await leadAnalyst.generateContent(prompt);
            const rawJson = gemRes.response.text();
            const jsonMatch = rawJson.match(/\{.*\}/s);
            
            if (jsonMatch) {
                const prediction = JSON.parse(jsonMatch[0]);
                console.log(`   ✅ Google AI: ${prediction.score}`);
                return prediction;
            }
        } catch (googleErr) {
            console.log(`   ⚠️ Google AI failed: ${googleErr.message.substring(0, 50)}`);
            
            // Check if it's a quota error
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
                    { role: "system", content: "Football expert predictor. Return JSON with score, confidence (0-100), verdict, logic (10 words), isValueBet (bool)." },
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
    
    // Both failed
    return { score: "1-1", confidence: 50, verdict: "API Error", logic: "Both AI services failed", isValueBet: false };
}

/**
 * MAIN BATCH ENDPOINT (Paced for rate limits)
 */
app.post('/api/predict-batch', async (req, res) => {
    const { matches } = req.body;
    
    // Input validation
    if (!matches || !Array.isArray(matches)) {
        return res.status(400).json({ error: 'Invalid matches data' });
    }
    
    if (matches.length === 0) {
        return res.json([]);
    }
    
    const finalBatch = [];

    console.log(`🚀 Starting batch analysis for ${matches.length} games...`);

    for (const match of matches) {
        try {
            console.log(`\n🤖 Processing: ${match.homeTeam} vs ${match.awayTeam}`);

            // Parallel Data Fetch
            const [h2h, news] = await Promise.all([
                getHistory(match.homeId, match.awayId),
                getLiveIntel(match.homeTeam, match.awayTeam)
            ]);

            console.log(`   H2H: ${h2h}`);

            // Groq Auditor Agent (for risk checking)
            let auditStr = "No audit available.";
            if (process.env.GROQ_API_KEY) {
                try {
                    const groqRes = await groq.chat.completions.create({
                        messages: [
                            { role: "system", content: "Expert bet auditor. Find the trap. Result must be 1 sentence max." },
                            { role: "user", content: `History: ${h2h}. News: ${news}. ${match.homeTeam} vs ${match.awayTeam}.` }
                        ],
                        model: "llama-3.1-8b-instant"
                    });
                    auditStr = groqRes.choices[0].message.content;
                    console.log(`   Audit: ${auditStr}`);
                } catch (groqErr) {
                    console.log(`   ⚠️ Audit skipped: ${groqErr.message.substring(0, 30)}`);
                }
            }

            // Get prediction (tries Google first, then Groq)
            const prediction = await getPrediction(match.homeTeam, match.awayTeam, h2h, news, auditStr);

            finalBatch.push({ id: match.id, ...prediction, audit: auditStr });

            // 3-second pause for rate limits
            console.log(`   💤 Sleeping 3s...`);
            await new Promise(r => setTimeout(r, 3000)); 

        } catch (err) {
            console.error(`   ❌ Failed: ${err.message}`);
            finalBatch.push({ id: match.id, score: "1-1", confidence: 50, verdict: "Error", logic: err.message, isValueBet: false });
        }
    }
    
    console.log(`\n✅ Batch complete! ${finalBatch.length} predictions.\n`);
    res.json(finalBatch);
});

// Football Proxy
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