require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

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
    service: 'SureBet Pro'
  });
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