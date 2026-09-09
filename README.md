# SureBet Pro — Football Forecasting Engine

SureBet Pro is a server-backed football forecasting application. It combines real fixture data, a transparent Poisson baseline, and independent AI forecasts into a validated ensemble. It also exposes market-value calculations when real decimal odds are supplied.

> **Important:** a prediction is not a guaranteed bet. A positive-EV selection is different from a bookmaker arbitrage (surebet), which requires simultaneous prices from multiple bookmakers.

## What changed in v2

- **True multi-model ensemble:** configured Gemini, Groq, DeepSeek and Z.ai models are queried independently and their probability distributions are weighted and averaged. One successful provider no longer hides the others.
- **Probability-first output:** models return Home/Draw/Away probabilities instead of an invented confidence score. UI/API confidence is derived from model probability and inter-model agreement.
- **Transparent statistical baseline:** a deterministic Poisson model remains available when AI providers fail. It is a baseline, not a claim of machine-learning accuracy.
- **Real value calculation:** `/api/value` calculates implied probability, edge, expected value and no-vig market probability from actual decimal odds. The engine never fabricates bookmaker odds.
- **Removed unreliable web scraping:** the old HTML-regex prediction scraping and random site confidence have been removed.
- **Better data ingestion:** duplicate fixture requests were consolidated, fixture caching has a real TTL, and upcoming/finished filtering is explicit.
- **Parallel inference:** independent model calls run concurrently, reducing the latency of the ensemble.
- **Basic API protection:** API rate limiting is included to reduce accidental or abusive request floods.
- **Regression tests:** core probability, ensemble, Poisson, market-value and Brier-score calculations have automated tests.
- **Secrets stay server-side:** API credentials are read from environment variables; the committed `.env.example` contains placeholders only.

## Architecture

```text
Football data + H2H + optional news
              |
              v
      Transparent baseline
         (Poisson)
              |
      +-------+-------+-------+
      |       |       |       |
    Gemini   Groq  DeepSeek   Z.ai
      |       |       |       |
      +-------+-------+-------+
              |
              v
     Probability ensemble
              |
      +-------+---------+
      |                 |
   Forecast         Market layer
                     (real odds only)
```

## Supported model providers

The current server implementation supports:

- Google Gemini
- Groq
- DeepSeek (OpenAI-compatible endpoint)
- Z.ai (OpenAI-compatible endpoint)

Providers are optional. The system uses every configured provider that responds successfully, rather than treating providers as a simple fallback chain.

## API

### `GET /api/health`

Returns service status and which providers are configured.

### `POST /api/start-predictions`

Fetches upcoming fixtures and starts asynchronous batch forecasting.

### `GET /api/predictions`

Returns completed predictions and processing progress.

### `POST /api/predict-batch`

Accepts a small batch of match objects for on-demand forecasting.

### `POST /api/value`

Input:

```json
{
  "probabilities": { "home": 0.52, "draw": 0.27, "away": 0.21 },
  "odds": { "home": 2.10, "draw": 3.60, "away": 4.50 }
}
```

Returns implied probabilities, expected value, edge and no-vig market probabilities.

## Setup

Requires **Node.js 18+**.

```bash
npm install
cp .env.example .env
npm run check
npm test
npm start
```

Configure at least one football data source and one AI provider for the full engine. All credentials must be stored in the hosting platform's environment-variable settings or an untracked local `.env` file.

## Configuration

Important variables:

```env
FOOTBALL_DATA_API_KEY=...
GOOGLE_AI_API_KEY=...
GROQ_API_KEY=...
DEEPSEEK_API_KEY=...
Z_AI_API_KEY=...
TAVILY_API_KEY=...

MAX_MATCHES=100
PREDICTION_BATCH_SIZE=8
PREDICTION_BATCH_DELAY_MS=1500
FIXTURE_CACHE_TTL_MS=600000
```

Optional `AI_WEIGHT_GEMINI`, `AI_WEIGHT_GROQ`, `AI_WEIGHT_DEEPSEEK` and `AI_WEIGHT_ZAI` values control ensemble weighting.

## Validation roadmap

The code now exposes the primitives needed for empirical validation, including Brier score calculation. However, **historical accuracy, calibration and ROI cannot honestly be claimed until predictions are persisted alongside final match outcomes**.

The next production step is a durable prediction/outcome database and an automated evaluation pipeline tracking:

- 1X2 accuracy and log loss
- Brier score
- calibration/reliability curves
- market-specific hit rate
- closing-line value (CLV)
- ROI/yield
- maximum drawdown
- performance by league, odds band and model provider

Until that dataset exists, the engine should be treated as a forecasting tool, not a proven profitable system.

## Security

Never commit `.env`, API keys, bookmaker credentials or database credentials. If a credential has previously been committed to a public repository, **revoke and rotate it immediately**; deleting it from the latest file does not invalidate the leaked credential.

## License

MIT License — see `LICENSE` if present.
