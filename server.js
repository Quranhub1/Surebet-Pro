require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY);
const leadAnalyst = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
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
    } catch (e) { return "Data timeout."; }
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
    } catch (e) { return "News fail."; }
}

/**
 * MAIN BATCH ENDPOINT (Paced for Groq)
 */
app.post('/api/predict-batch', async (req, res) => {
    const { matches } = req.body;
    
    // Input validation
    if (!Array.isArray(matches) || matches.length === 0) {
        return res.status(400).json({ error: 'Invalid or empty matches array' });
    }
    
    const finalBatch = [];

    console.log(`🚀 Starting batch analysis for ${matches.length} games...`);

    for (const match of matches) {
        try {
            console.log(`🤖 Processing: ${match.homeTeam} vs ${match.awayTeam}`);

            // Parallel Data Fetch (Agents 1 & 2)
            const [h2h, news] = await Promise.all([
                getHistory(match.homeId, match.awayId),
                getLiveIntel(match.homeTeam, match.awayTeam)
            ]);

            // Groq Auditor Agent (Logical check)
            // Use llama-3.1-8b-instant because it has higher Rate Limits (RPM) than 70b
            let auditStr = "";
            try {
                const groqRes = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: "Expert bet auditor. Find the trap. Result must be 1 sentence max." },
                        { role: "user", content: `History: ${h2h}. News: ${news}. ${match.homeTeam} vs ${match.awayTeam}.` }
                    ],
                    model: "llama-3.1-8b-instant" 
                });
                auditStr = groqRes.choices[0].message.content;
            } catch (groqErr) {
                console.log("⚠️ Groq hit limit, skipping audit for this game.");
                auditStr = "Logic verification skipped to prevent overload.";
            }

            // Lead Analyst (Gemini synthesis)
            const prompt = `Match: ${match.homeTeam} vs ${match.awayTeam}. H2H: ${h2h}. Audit: ${auditStr}. News: ${news}.
            Decide Score/Outcome. Be decisive. JSON only: {"score":"X-Y","confidence":0-100,"verdict":"type","logic":"10 words max","isValueBet":bool}`;
            
            const gemRes = await leadAnalyst.generateContent(prompt);
            const rawJson = gemRes.response.text();
            
            // Safe JSON parsing
            let prediction;
            try {
                const jsonMatch = rawJson.match(/\{.*\}/s);
                prediction = jsonMatch ? JSON.parse(jsonMatch[0]) : { score: "1-1", confidence: 50, verdict: "Parse error", logic: "AI response invalid", isValueBet: false };
            } catch (parseErr) {
                console.error("JSON parse error:", parseErr.message);
                prediction = { score: "1-1", confidence: 50, verdict: "Parse error", logic: "Response parse failed", isValueBet: false };
            }

            finalBatch.push({ id: match.id, ...prediction, audit: auditStr });

            // CRITICAL: 3-second pause per match to stay well within Groq TPM limits
            console.log(`✅ Success. Sleeping 3s to stay safe...`);
            await new Promise(r => setTimeout(r, 3000)); 

        } catch (err) {
            console.error(`❌ Failed match: ${match.homeTeam}`, err.message);
            finalBatch.push({ id: match.id, score: "1-1", confidence: 50, logic: "Process error.", isValueBet: false });
        }
    }
    res.json(finalBatch);
});

// Football Proxy
app.get('/api/football-data/matches', async (req, res) => {
    try {
        const response = await axios.get('https://api-football-data.org/v4/matches', { 
            headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY } 
        });
        res.json(response.data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 JOESBET Hub live on ${PORT}`));