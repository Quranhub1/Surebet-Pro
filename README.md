# SureBet Pro

SureBet Pro is a football analysis and prediction platform. The prediction engine is based solely on football analysis and historical match evidence. It does **not** use bookmaker odds, implied probabilities, value calculations, arbitrage, stakes, ROI, or betting-market signals to determine predictions.

## Prerequisites

1. Node.js 22 or higher.
2. A Neon PostgreSQL database and its `DATABASE_URL`.
3. An `AUTH_SECRET` for application sessions.
4. Configured football-data.org and AI provider credentials for automated football analysis.

## Environment

Set the required variables on the server:

```bash
DATABASE_URL=your-neon-connection-string
AUTH_SECRET=your-long-random-session-secret
FOOTBALL_DATA_API_TOKEN=your-football-data-token
GEMINI_API_KEY=your-gemini-key
GROQ_API_KEY=your-groq-key
```

Do not commit real credentials to Git.

## Install and run

```bash
npm install
npm run dev:all
```

The frontend runs on `http://localhost:5173` and the backend runs on port `3001` unless `PORT` is configured.

## Database

The backend initializes the required Neon tables on startup. Database health is exposed at `/api/health`.

The backend stores football fixtures, AI analyses, prediction quality data, users, subscriptions, alerts, and application settings in Neon PostgreSQL. The browser never connects directly to PostgreSQL.

## Football analysis

- Upcoming football fixtures are loaded from football-data.org.
- AI analysis uses completed-match history as factual evidence.
- Recent results are weighted more heavily than older results.
- Home and away performance, goals scored/conceded, results and available head-to-head context are considered.
- The system records the AI provider and model used for each prediction.
- Prediction quality is measured and exposed so stronger analysis can be surfaced to higher-access tiers.
- Analysis is automatically refreshed on a 12-hour cycle.
- Completed results are retained for evaluating prediction accuracy.
- Missing evidence is not invented.

## Access tiers

Prediction access is quality-ranked rather than randomly assigned. Pro users receive the strongest available analysis, trial users receive a useful middle quality band, and premium users receive the remaining analysis. No tier deliberately receives fabricated or false predictions.

## Live football

The dashboard includes a live match centre that refreshes live fixtures and displays available scores, match time, goals, cards, substitutions and match-state information.

## Architecture

**React/Vite website → Express backend → Neon PostgreSQL + football-data.org + AI providers → football analysis and prediction engine → dashboard**

Supabase is not used anywhere in the application.
