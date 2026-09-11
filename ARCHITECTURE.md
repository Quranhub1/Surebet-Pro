# System Architecture: Surebet Scanner Platform

## 1. Overview
A B2B/B2C SaaS platform for detecting sports betting arbitrage (surebets). The system continuously scans the Odds API, focused on **Superbet** and **Novibet**, processes odds through a mathematical calculation engine, and displays guaranteed-profit opportunities in real time.

## 2. API Usage Strategy (100 requests/hour)
Due to the strict limit of the Odds API free plan, the architecture uses a **Smart Scanner Scheduler**:
- **Consumption Rate:** 1 request every 36 seconds (1.6 requests/minute).
- **Prioritization (Triage):**
  1. The system makes one daily request to map all active sports and leagues.
  2. The system filters events starting within the next 24 hours.
  3. The request queue consumes the `/odds` endpoint filtered by `regions=eu` and `bookmakers=superbet,novibet`.
- **Deduplication and Cache:** Results are cached in Redis/PostgreSQL. If an event was scanned within the last 15 minutes and is not about to start, it is skipped in the next scan cycle.

## 3. Technology Stack
- **Frontend:** React, Vite, TypeScript, TailwindCSS, Recharts (charts).
- **Backend:** Node.js, TypeScript, Express/Fastify.
- **Database:** PostgreSQL (via Prisma ORM).
- **Queues/Workers:** BullMQ + Redis (for scan scheduling).

## 4. Data Normalization
The normalization engine (`NormalizerEngine`) is critical. It translates team and market names that may differ between Superbet and Novibet.
- Example: "Manchester Utd" (Superbet) vs "Man United" (Novibet).
- Markets: `h2h` (Moneyline), `totals` (Over/Under), `spreads` (Handicap).

## 5. MVP Roadmap
- **Phase 1 (Month 1):** Odds API integration, Base Arbitrage Engine (1x2 and O/U), Real-time Dashboard.
- **Phase 2 (Month 2):** User Authentication, Stake Calculator, Advanced Filters.
- **Phase 3 (Month 3):** Alert System (Email/Telegram), Admin Panel, Subscription Plans (Stripe).

## 6. Scalability Plan
When the platform moves to a paid Odds API plan (for example, 10,000 requests/month):
- Run multiple workers in parallel.
- Implement WebSockets (Socket.io) to push real-time surebets to the frontend, eliminating the need for client-side polling.
- Expand to more than 50 bookmakers.
