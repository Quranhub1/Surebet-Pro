# System Architecture: Surebet Pro

## Overview
Surebet Pro is an automated sports-betting arbitrage platform. Neon PostgreSQL is the single source of truth for application data. The browser communicates with the Express backend and never connects directly to the database.

## Runtime flow

1. The backend starts and initializes the Neon PostgreSQL schema.
2. The scheduler generates upcoming matches every 12 hours.
3. The Odds API supplies event and bookmaker prices.
4. The deterministic arbitrage engine identifies surebets and calculates stake percentages.
5. Opportunities and event data are persisted in Neon.
6. Live football and live arbitrage data are refreshed every 2 minutes.
7. The React dashboard reads data through backend API endpoints.

## Technology Stack

- **Frontend:** React, Vite, TypeScript, TailwindCSS, Recharts.
- **Backend:** Node.js 22, TypeScript, Express.
- **Database:** Neon PostgreSQL through `@neondatabase/serverless`.
- **Authentication:** Neon-backed users with server-side password hashing and signed sessions.
- **Sports data:** Odds API.
- **Automation:** Long-running backend scheduler.

## Database

The Neon database stores scanner configuration, users, alerts, events, surebet opportunities, and opportunity legs. Startup initialization creates missing tables and columns without requiring Supabase.

## Automation

The system intentionally has no user-controlled scheduler toggle or manual scanner button. The backend runs continuously, generating new match opportunities every 12 hours and refreshing live matches every 2 minutes.

## Security

Secrets such as `DATABASE_URL`, `AUTH_SECRET`, and `ODDS_API_KEY` remain server-side. They must be configured as deployment environment variables and must never be committed to the repository.

## Scalability

As traffic and provider limits grow, the scheduler can be moved to dedicated workers and the backend can expose server-sent events or WebSockets for lower-latency dashboard updates. Neon remains the database layer.

## Database boundary

**React/Vite → Express API → Neon PostgreSQL**

The application contains no Supabase client, Supabase authentication, Supabase Realtime subscription, or Supabase database dependency.
