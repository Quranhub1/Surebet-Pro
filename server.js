require('dotenv').config();
// Load Express
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Optional: Google Generative AI SDK (for standalone prediction service)
let GoogleGenerativeAI;
try {
    GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
    console.log('✅ Google Generative AI SDK loaded');
} catch (e) {
    console.log('ℹ️ Google Generative AI SDK not installed (optional for standalone service)');
}

// Optional: Tavily AI for match news search
let tavily;
try {
    const { tavily: tavilyClient } = require('@tavily/core');
    tavily = tavilyClient(process.env.TAVILY_API_KEY);
    console.log('✅ Tavily AI SDK loaded');
} catch (e) {
    console.log('ℹ️ Tavily AI SDK not installed (optional for news)');
}

// Function to get market sentiment (odds from bookmakers)
async function getMarketSentiment(leagueKey, homeTeam, awayTeam) {
    const oddsApiKey = process.env.ODDS_API_KEY;
    if (!oddsApiKey) {
        console.log('⚠️ ODDS_API_KEY not configured');
        return null;
    }
    try {
        // Fetch odds from major bookmakers
        const response = await axios.get(`https://api.the-odds-api.com/v4/sports/${leagueKey}/odds`, {
            params: {
                apiKey: oddsApiKey,
                regions: 'uk,eu',
                markets: 'h2h'
            }
        });

        // Find the specific match in the odds list
        const matchOdds = response.data.find(m => 
            m.home_team.toLowerCase().includes(homeTeam.toLowerCase()) || 
            m.away_team.toLowerCase().includes(awayTeam.toLowerCase())
        );

        if (!matchOdds || !matchOdds.bookmakers || !matchOdds.bookmakers[0]) {
            return null;
        }

        // Use the first bookmaker's odds (e.g., Bet365 or Pinnacle)
        const odds = matchOdds.bookmakers[0].markets[0].outcomes;
        const homeOdds = odds.find(o => o.name.toLowerCase().includes(homeTeam.toLowerCase().split(' ')[0]));
        const awayOdds = odds.find(o => o.name.toLowerCase().includes(awayTeam.toLowerCase().split(' ')[0]));

        if (!homeOdds || !awayOdds) return null;

        // Calculate "Implied Probability" (1 / odds)
        const impliedHomeProb = Math.round((1 / homeOdds.price) * 100);
        const impliedAwayProb = Math.round((1 / awayOdds.price) * 100);

        return {
            homeOdds: homeOdds.price,
            awayOdds: awayOdds.price,
            impliedHomeProb,
            impliedAwayProb,
            marketFavorite: impliedHomeProb > impliedAwayProb ? 'Home' : 'Away',
            bookmaker: matchOdds.bookmakers[0].title
        };
    } catch (e) {
        console.error("Market Sentiment Error:", e.message);
        return null;
    }
}

// Function to get match news
async function getMatchNews(homeTeam, awayTeam) {
    if (!tavily) {
        return { answer: "Tavily API not configured on server" };
    }
    try {
        const query = `${homeTeam} vs ${awayTeam} team news injuries lineups today`;
        const searchResult = await tavily.search(query, {
            searchDepth: "basic",
            maxResults: 3,
            includeAnswer: true
        });
        return searchResult;
    } catch (e) {
        console.error("Tavily Search Error:", e);
        return { answer: "News search unavailable." };
    }
}

// API client for football data (RapidAPI)
const apiClient = axios.create({
    baseURL: 'https://api-football-v1.p.rapidapi.com/v3',
    headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY || '',
        'x-rapidapi-host': 'api-football-v1.p.rapidapi.com'
    }
});

// Fetch deep context for a specific match
async function getMatchContext(matchId, homeId, awayId) {
    try {
        // 1. Get Head-to-Head (Last 5 meetings)
        const h2hReq = await apiClient.get(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=5`);
        
        // 2. Get Team Stats for the current season
        // (Simplified for this example)
        const homeStats = `Home Team last 5 goals avg: 1.8, Clean sheets: 30%`;
        const awayStats = `Away Team last 5 goals avg: 1.2, Clean sheets: 15%`;

        return {
            h2h: h2hReq.data.response.map(r => `${r.teams.home.name} ${r.goals.home}-${r.goals.away} ${r.teams.away.name}`),
            homeStats,
            awayStats
        };
    } catch (e) {
        return { h2h: [], homeStats: "N/A", awayStats: "N/A" };
    }
}

const app = express();

// Performance: Add response caching
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache
const apiCache = new Map();

const getCachedData = (key) => {
    const cached = apiCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log('📦 Cache hit for:', key);
        return cached.data;
    }
    return null;
};

const setCachedData = (key, data) => {
    apiCache.set(key, { data, timestamp: Date.now() });
    // Limit cache size
    if (apiCache.size > 100) {
        const oldest = apiCache.keys().next().value;
        apiCache.delete(oldest);
    }
};

// Enable CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, '.')));

// API endpoint to get configuration (API keys from environment)
app.get('/api/config', (req, res) => {
  const config = {
    footballDataApiKey: process.env.FOOTBALL_DATA_API_KEY || '',
    groqApiKey: process.env.GROQ_API_KEY || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    huggingfaceApiKey: process.env.HUGGINGFACE_API_KEY || '',
    cohereApiKey: process.env.COHERE_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    googleAiApiKey: process.env.GOOGLE_AI_API_KEY || '',
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    githubModelsApiKey: process.env.GITHUB_MODELS_API_KEY || '',
    zAiApiKey: process.env.Z_AI_API_KEY || ''
  };
  res.json(config);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'SureBet Pro',
    apiKeySet: !!process.env.FOOTBALL_DATA_API_KEY
  });
});

// Proxy endpoint for Football-Data.org (avoids CORS issues and keeps API key secret)
// Now with caching for better performance!
app.get('/api/football-data/matches', async (req, res) => {
  const cacheKey = `matches_${req.query.dateFrom || 'today'}_${req.query.dateTo || 'today'}`;
  
  // Check cache first
  const cachedData = getCachedData(cacheKey);
  if (cachedData) {
    return res.json(cachedData);
  }
  
  console.log('Proxy request received:', req.query);
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  console.log('API Key available:', apiKey ? 'YES (length: ' + apiKey.length + ')' : 'NO');
  
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing FOOTBALL_DATA_API_KEY' });
  }

  const baseUrl = 'https://api.football-data.org/v4/matches';
  const { dateFrom, dateTo } = req.query;
  const url = new URL(baseUrl);

  if (dateFrom) url.searchParams.set('dateFrom', dateFrom);
  if (dateTo) url.searchParams.set('dateTo', dateTo);
  url.searchParams.set('status', 'SCHEDULED,TIMED,IN_PLAY');

  try {
    console.log('Fetching from Football API:', url.toString());
    
    // Use https module instead of fetch for better compatibility
    const data = await new Promise((resolve, reject) => {
      const req = https.get(url.toString(), {
        headers: {
          'X-Auth-Token': apiKey,
          'Content-Type': 'application/json'
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          console.log('Football API response status:', res.statusCode);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(body);
              console.log('Football API success, matches count:', json.matches?.length || 0);
              resolve(json);
            } catch (e) {
              reject(new Error('Invalid JSON response: ' + body));
            }
          } else {
            reject(new Error(`Football-Data API responded with ${res.statusCode}: ${body}`));
          }
        });
      });
      
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
    
    return res.json(data);
  } catch (error) {
    console.error('Failed to proxy Football-Data request:', error.message, error.stack);
    return res.status(502).json({ 
      error: 'Failed to fetch Football-Data.org',
      details: error.message 
    });
  }
});

// Serve index.html with environment variables injected
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'index.html');
  fs.readFile(htmlPath, 'utf8', (err, html) => {
    if (err) {
      return res.status(500).send('Error loading page');
    }

    // Inject environment variables as a script tag
    const envVars = {
      FOOTBALL_DATA_API_KEY: process.env.FOOTBALL_DATA_API_KEY || '',
      GROQ_API_KEY: process.env.GROQ_API_KEY || '',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      GOOGLE_API_KEY: process.env.GOOGLE_AI_API_KEY || '',
      HUGGINGFACE_API_KEY: process.env.HUGGINGFACE_API_KEY || '',
      COHERE_API_KEY: process.env.COHERE_API_KEY || '',
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
      GITHUB_MODELS_API_KEY: process.env.GITHUB_MODELS_API_KEY || '',
      Z_AI_API_KEY: process.env.Z_AI_API_KEY || '',
      DEFAULT_AI_PROVIDER: process.env.DEFAULT_AI_PROVIDER || 'groq',
      DAILY_TARGET: process.env.DAILY_TARGET || '100'
    };

    const envScript = `<script>window.ENV_VARS = ${JSON.stringify(envVars)};</script>`;
    const modifiedHtml = html.replace('<script>', envScript + '<script>');

    res.send(modifiedHtml);
  });
});

// Endpoint to get match news using Tavily AI
app.post('/api/match-news', express.json(), async (req, res) => {
    const { homeTeam, awayTeam } = req.body;
    
    if (!homeTeam || !awayTeam) {
        return res.status(400).json({ error: "Missing homeTeam or awayTeam" });
    }
    
    try {
        const news = await getMatchNews(homeTeam, awayTeam);
        res.json(news);
    } catch (error) {
        console.error("Match News Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Add new endpoint to handle the heavy AI work with live news
app.post('/api/predict-batch', express.json(), async (req, res) => {
    const { matches } = req.body;
    
    // Check for multiple possible env var names
    const googleKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;

    console.log('🔑 Server has Google Key:', !!googleKey);
    console.log('🔑 Server has Groq Key:', !!groqKey);

    if (!matches || !Array.isArray(matches)) {
        return res.status(400).json({ error: "Invalid matches data" });
    }

    console.log(`🤖 Processing batch of ${matches.length} matches via Server Orchestrator with live news`);

    const processedPredictions = [];

    // Process each match individually with news, context, and market sentiment
    for (const match of matches) {
        try {
            // 1. FETCH DEEP DATA (The "Data Scientist" Agent)
            console.log(`📊 Getting context for: ${match.homeTeam} vs ${match.awayTeam}`);
            let matchContext = { h2h: [], homeStats: "N/A", awayStats: "N/A" };
            let liveNews = "No recent news available";
            let marketSentiment = null;
            
            // Try to get head-to-head data if we have homeId/awayId
            if (match.homeId && match.awayId) {
                try {
                    matchContext = await getMatchContext(match.id, match.homeId, match.awayId);
                } catch (ctxErr) {
                    console.log(`⚠️ Could not get H2H data:`, ctxErr.message);
                }
            }
            
            // 2. CALL THE SEARCH AGENT (The "Researcher")
            console.log(`📰 Getting news for: ${match.homeTeam} vs ${match.awayTeam}`);
            try {
                const newsResult = await getMatchNews(match.homeTeam, match.awayTeam);
                liveNews = newsResult.answer || "No recent news available";
            } catch (newsErr) {
                console.log(`⚠️ Could not get news for ${match.homeTeam} vs ${match.awayTeam}:`, newsErr.message);
            }

            // 3. GET MARKET SENTIMENT (Bookmaker odds)
            console.log(`📈 Getting market sentiment for: ${match.homeTeam} vs ${match.awayTeam}`);
            try {
                // Map league names to odds-api keys
                const leagueKeyMap = {
                    'Premier League': 'epl',
                    'La Liga': 'la_liga',
                    'Bundesliga': 'bundesliga',
                    'Serie A': 'serie_a',
                    'Ligue 1': 'ligue_1',
                    'Championship': 'efl_championship'
                };
                const leagueKey = leagueKeyMap[match.competition?.name || match.league] || 'soccer';
                marketSentiment = await getMarketSentiment(leagueKey, match.homeTeam, match.awayTeam);
            } catch (marketErr) {
                console.log(`⚠️ Could not get market sentiment:`, marketErr.message);
            }

            // 4. CONSTRUCT DATA-RICH PROMPT
            const prompt = `
            MATCH: ${match.homeTeam} vs ${match.awayTeam}
            LEAGUE: ${match.competition?.name || match.league || 'Unknown League'}
            
            HISTORICAL H2H (Last 5): ${matchContext.h2h.length > 0 ? matchContext.h2h.join(', ') : 'No H2H data available'}
            SEASON STATS: 
            - Home: ${matchContext.homeStats}
            - Away: ${matchContext.awayStats}
            
            LATEST NEWS: ${liveNews}
            
            BOOKMAKER ODDS:
            ${marketSentiment ? `- Home Win: ${marketSentiment.homeOdds} (Implied: ${marketSentiment.impliedHomeProb}%)
            - Away Win: ${marketSentiment.awayOdds} (Implied: ${marketSentiment.impliedAwayProb}%)
            - Market Favorite: ${marketSentiment.marketFavorite} (via ${marketSentiment.bookmaker})` : '- No odds data available'}
            
            INSTRUCTIONS:
            1. Analyze the H2H trends. If a team consistently dominates the other, weigh that heavily.
            2. If the news mentions a star player is injured (e.g., "De Bruyne out"), adjust your prediction score accordingly.
            3. Compare your Math Model with the Bookmaker Implied Probability.
            4. If (Math Model % > Bookmaker %), flag this as a "VALUE BET".
            5. If the Bookmaker odds are very high for the home team but your math says they win, look for a reason why.
            
            Return ONLY valid JSON: {"id": "${match.id}", "winner": "...", "score": "X-Y", "isValueBet": true/false, "reason": "..."}`;

            // 3. CALL GEMINI/GROQ
            let prediction = null;
            
            // Try Google Gemini first
            if (googleKey && GoogleGenerativeAI) {
                try {
                    const genAI = new GoogleGenerativeAI(googleKey);
                    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-8b" });
                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    const text = response.text();
                    
                    // Try to extract JSON from response
                    const jsonMatch = text.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        prediction = JSON.parse(jsonMatch[0]);
                        prediction.id = match.id; // Ensure ID is set
                    }
                } catch (geminiErr) {
                    console.log(`⚠️ Gemini failed: ${geminiErr.message}. Falling back to Groq...`);
                }
            }
            
            // Fallback to Groq if Gemini failed or not available
            if (!prediction && groqKey) {
                const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${groqKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'llama-3.1-8b-instant',
                        messages: [
                            { role: 'system', content: 'You are a football prediction expert. Always respond with valid JSON only.' },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.3,
                        max_tokens: 500
                    })
                });
                
                if (groqResponse.ok) {
                    const groqData = await groqResponse.json();
                    const groqText = groqData.choices[0].message.content;
                    const jsonMatch = groqText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        prediction = JSON.parse(jsonMatch[0]);
                        prediction.id = match.id;
                    }
                }
            }

            if (prediction) {
                processedPredictions.push(prediction);
                console.log(`✅ Predicted: ${match.homeTeam} vs ${match.awayTeam} → ${prediction.score}`);
            } else {
                // Fallback to local prediction
                processedPredictions.push({
                    id: match.id,
                    winner: 'Draw',
                    score: '1-1',
                    reason: 'AI prediction failed, using default'
                });
            }

            // Small delay between matches to avoid rate limits
            await new Promise(r => setTimeout(r, 1000));
            
        } catch (matchErr) {
            console.error(`❌ Error processing ${match.homeTeam} vs ${match.awayTeam}:`, matchErr.message);
            processedPredictions.push({
                id: match.id,
                winner: 'Draw',
                score: '1-1',
                reason: 'Error: ' + matchErr.message
            });
        }
    }

    res.json(processedPredictions);
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 SureBet Pro running on port ${PORT}`);
});
