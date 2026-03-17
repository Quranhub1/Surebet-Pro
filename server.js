require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const app = express();

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
    googleAiApiKey: process.env.GOOGLE_AI_API_KEY || ''
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
app.get('/api/football-data/matches', async (req, res) => {
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
      DEFAULT_AI_PROVIDER: process.env.DEFAULT_AI_PROVIDER || 'groq',
      DAILY_TARGET: process.env.DAILY_TARGET || '100'
    };

    const envScript = `<script>window.ENV_VARS = ${JSON.stringify(envVars)};</script>`;
    const modifiedHtml = html.replace('<script>', envScript + '<script>');

    res.send(modifiedHtml);
  });
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 SureBet Pro running on port ${PORT}`);
});