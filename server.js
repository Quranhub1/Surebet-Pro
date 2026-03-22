require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

// Log environment variables (without revealing secrets)
console.log('=== Environment Check ===');
console.log('FOOTBALL_DATA_API_KEY:', process.env.FOOTBALL_DATA_API_KEY ? '✓ Set' : '✗ Missing');
console.log('GOOGLE_AI_API_KEY:', process.env.GOOGLE_AI_API_KEY ? '✓ Set' : '✗ Missing');
console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY ? '✓ Set' : '✗ Missing');
console.log('TAVILY_API_KEY:', process.env.TAVILY_API_KEY ? '✓ Set' : '✗ Missing');
console.log('RAPIDAPI_KEY:', process.env.RAPIDAPI_KEY ? '✓ Set' : '✗ Missing');
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
        console.log('getHistory error:', e.message);
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
        console.log('getLiveIntel error:', e.message);
        return "News fail."; 
    }
}

/**
 * MAIN BATCH ENDPOINT (Paced for Groq)
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
            console.log(`   News: ${news.substring(0, 50)}...`);

            // Groq Auditor Agent
            let auditStr = "Logic verification skipped.";
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
                    console.log('   ⚠️ Groq error:', groqErr.message);
                }
            } else {
                console.log('   ⚠️ GROQ_API_KEY not set');
            }

            // Lead Analyst (Gemini)
            if (!process.env.GOOGLE_AI_API_KEY) {
                console.log('   ❌ GOOGLE_AI_API_KEY not set');
                finalBatch.push({ id: match.id, score: "1-1", confidence: 50, verdict: "API Missing", logic: "Set GOOGLE_AI_API_KEY", isValueBet: false, audit: auditStr });
                continue;
            }

            const prompt = `Match: ${match.homeTeam} vs ${match.awayTeam}. H2H: ${h2h}. Audit: ${auditStr}. News: ${news}.
            Decide Score/Outcome. Be decisive. JSON only: {"score":"X-Y","confidence":0-100,"verdict":"type","logic":"10 words max","isValueBet":bool}`;
            
            const gemRes = await leadAnalyst.generateContent(prompt);
            const rawJson = gemRes.response.text();
            
            // Safe JSON parsing
            let prediction;
            try {
                const jsonMatch = rawJson.match(/\{.*\}/s);
                if (jsonMatch) {
                    prediction = JSON.parse(jsonMatch[0]);
                    console.log(`   ✅ Prediction: ${prediction.score} (${prediction.confidence}%)`);
                } else {
                    console.log('   ❌ No JSON found in response');
                    prediction = { score: "1-1", confidence: 50, verdict: "Parse error", logic: "AI response invalid", isValueBet: false };
                }
            } catch (parseErr) {
                console.log('   ❌ JSON parse error:', parseErr.message);
                prediction = { score: "1-1", confidence: 50, verdict: "Parse error", logic: "Response parse failed", isValueBet: false };
            }

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
        return res.status(500).json({ error: 'FOOTBALL_DATA_API_KEY not configured. Add it in Railway/Render dashboard.' });
    }
    try {
        const response = await axios.get('https://api.football-data.org/v4/matches', { 
            headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY } 
        });
        res.json(response.data);
    } catch (e) { 
        console.error('Football API Error:', e.message);
        res.status(500).json({ error: 'Failed to fetch matches. Check API key.' }); 
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 JOESBET Hub live on ${PORT}`));