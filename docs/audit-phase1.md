# Phase 1 Audit — Tennis Predictor

Date: 2026-07-11

## Scope
Full read-through of the api-server prediction engine, tennis data provider layer,
API routes, database schema, and every tennis-predictor frontend page/component,
plus static (`tsc --noEmit`) and live runtime verification of every user flow.

## Method
1. Read every module in `predictionEngine/` (surfaceElo, serveReturn, recentForm,
   fatigue, styleMatchup, headToHead, dataQuality, ensemble, calibration, upsetRisk,
   recommendation) and the orchestrator.
2. Read the provider layer (`apiTennisProvider`, provider factory, surface map, TTL
   cache, shared types) and all api-server routes.
3. Read the Postgres/Drizzle `predictions` schema.
4. Read every frontend page and component in `artifacts/tennis-predictor/src`.
5. Ran `tsc --noEmit` across every workspace package that touches this artifact
   (`tennis-predictor`, `api-server`, `db`, `api-zod`, `api-client-react`).
6. Restarted workflows, checked logs, and drove the app live: player search,
   fixtures list, matchup builder, prediction creation, prediction detail, ledger/
   history, and provider status — using real API-Tennis data (no mocks).

## Findings & fixes

1. **Type errors in three React Query call sites (real, not cosmetic).**
   `PlayerSearch.tsx`, `PredictBuilder.tsx`, and `PredictionResult.tsx` passed
   `{ query: { enabled: ... } }` to the generated `useSearchPlayers` /
   `useGetPlayer` / `useGetPrediction` hooks without a `queryKey`. The installed
   `@tanstack/react-query` version (5.101.2) requires `queryKey` on
   `QueryObserverOptions`, which the orval-generated hook option type inherits, so
   `tsc --noEmit` failed on all three call sites even though the generated wrapper
   fills in the key internally at runtime. Fixed by importing the generated
   `getXxxQueryKey` helper at each call site and passing it explicitly. Whole
   workspace now typechecks clean (`tennis-predictor`, `api-server`, `db`,
   `api-zod`, `api-client-react` all pass `tsc --noEmit`).
2. **Minor wording bug in risk text.** The orchestrator built the risk string
   `Engine models disagree (${modelAgreement.toLowerCase()})`, which rendered
   `HighDisagreement` as `highdisagreement` (no space). Fixed to insert a space
   between words before lowercasing, so it now reads "high disagreement".

No other bugs were found. Every prediction module already labels its own
reliability honestly and documents what real data is/isn't available (serve/return
is a proxy from set/game margins, not point-level stats; fatigue only sees the last
7 days of fixture history; calibration is a documented simplified stand-in pending
a historical backtest corpus). Nothing fabricates data — the provider layer throws
`ProviderUnavailableError` rather than falling back to mock values.

## Live verification (real data, API-Tennis)
- Player search ("Alcaraz", "Sinner") returns real ranked players.
- Upcoming fixtures list loads real tour fixtures (Wimbledon, Braunschweig, etc.).
- Built a fresh Alcaraz vs. Sinner (Clay, best-of-5, Grand Slam) matchup end-to-end:
  engine produced a full breakdown (Surface Elo, Serve & Return proxy, Recent Form,
  Fatigue, Style Matchup, Head-to-Head), ensemble probability, calibrated
  probability, data-quality score, upset-risk label, and recommendation — all from
  real provider data.
- Prediction detail page renders the full breakdown, reasons, risks, and honesty
  notes (availability/conditions) correctly.
- Ledger/history page lists past predictions with accuracy stats computed only
  from resolved outcomes.
- Provider status indicator correctly reflects live connectivity to API-Tennis.

## Confirmed not present (per consultant docs' assumptions, flagged to user)
- No OCR/screenshot import for historical stats — does not exist in the codebase.
- No manual historical-match-entry feature — does not exist.
- No developer source-export page — does not exist.
- RapidAPI / API-Sports / Open-Meteo are not wired into any code yet (their keys
  were added to secrets in this phase but are intentionally unused until a later
  phase — Phase 1 is audit-only and should not add new data sources).

## Status
Phase 1 is complete. The app is stable, honestly labeled, and free of known bugs
or type errors. Ready to proceed to Phase 2 (API validation, removing any
remaining fake-data risk, hardening identity matching).
