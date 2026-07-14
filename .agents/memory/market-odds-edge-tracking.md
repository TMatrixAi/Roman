---
name: Market odds & edge tracking design
description: Real odds provider integration design decisions and the real-world quirks/bugs that made capture silently return zero rows.
---

## Design
Orient averaged cross-side edge metrics to the model's pick, not a fixed player slot. Real Odds-API.io/The Odds API response shapes diverge from their own docs -- verify against live calls, don't trust documented examples.

## A fully-correct capture design can still silently produce zero real rows
A correctly-implemented odds-capture pipeline (fetch -> match -> compute implied probability/edge -> write at lock time, never fabricate/backfill) produced zero real rows for days. Root causes were never in that logic:
1. **Invalid provider API keys** (401s) with no alerting -- the pipeline just kept locking predictions with null odds forever, which looked identical to "no coverage for this match" from the outside.
2. **No recurring scheduler.** A paper-trading/lock job designed to run via a Replit Scheduled Deployment had none configured -- it only ran when manually triggered, so most fixtures' lock windows (cutoff to cutoff+grace) elapsed unseen. There is no programmatic callback to create a Scheduled Deployment; it requires the user to configure one via the Publishing UI.
3. **Odds-API.io's `/odds` endpoint requires an explicit `bookmakers` query param on every call**, capped at however many bookmakers the account plan allows (e.g. 2) -- selecting bookmakers once via `PUT /bookmakers/selected/select` only authorizes those names for the account, it does NOT make the per-call param optional. Omitting it is an HTTP 400 that gets swallowed into a generic per-event "failed to load odds, skipping" warning.
4. **Odds-API.io's `/events` endpoint has no default status filter** -- its rolling `limit=N` window can fill up with already-settled matches from the last ~24h and silently exclude genuinely pending/upcoming ones, even for a real ATP main-draw match. Fix: always pass `status=pending,live`.

**Why:** each of these fails silently (null odds look the same as "no coverage"), so diagnosing "zero real odds ever" required directly curling the real provider endpoints rather than trusting the app-level code review.

**How to apply:** when odds/market-data capture looks broken, verify with direct HTTP calls against the real provider (not just code review) at every stage: key validity, required params matching current docs (docs can be stale/wrong -- check actual error bodies), and whether the specific match you expect is actually inside whatever window/pagination the query returns *right now*. Also check whether the job that's supposed to call this even has a schedule.
