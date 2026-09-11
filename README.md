# SurebetPro - Local Setup Guide

SurebetPro is an automated sports-betting arbitrage platform. The application uses **Neon PostgreSQL as its only database**, with the backend acting as the secure gateway between the website, the database, the odds provider, and the arbitrage engine.

## Prerequisites

1. Node.js 22 or higher.
2. A Neon PostgreSQL database and its `DATABASE_URL`.
3. An `AUTH_SECRET` for application sessions.
4. An Odds API key stored as an environment variable or in the Neon `system_settings` record.

## Environment

Set these variables on the server:

```bash
DATABASE_URL=your-neon-connection-string
AUTH_SECRET=your-long-random-session-secret
ODDS_API_KEY=your-odds-api-key
```

Do not commit real credentials to Git.

## Install and run

```bash
npm install
npm run dev:all
```

The frontend runs on `http://localhost:5173` and the backend runs on port `3001` unless `PORT` is configured.

## Database

The backend initializes the required Neon tables on startup. Database health is exposed at `/api/health`, and the response identifies the provider as Neon PostgreSQL.

The backend stores scanner settings, users, alerts, events, and surebet opportunities in Neon. The browser never connects directly to PostgreSQL.

## Automation

- Upcoming matches and arbitrage opportunities are generated automatically every 12 hours.
- Live odds are refreshed every 2 minutes by the backend.
- The dashboard refreshes its Neon-backed data automatically.
- There is no manual scanner start/stop control.

## Architecture

**React/Vite website → Express backend → Neon PostgreSQL + Odds API → Arbitrage Engine → dashboard**

Supabase is not used anywhere in the application.
