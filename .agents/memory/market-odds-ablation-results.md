---
name: Market Odds Ablation Results
description: Section A/B/B-CAL findings from auditMarketConsensusAblation.ts; B-CAL re-validation waiting on ≥500 qualifying rows.
---

## Authoritative Row Count (2026-08-01 15:26:22 UTC)

```sql
SELECT
  COUNT(*) FILTER (WHERE run_kind='paper_trade' AND status='graded'
                     AND odds_player1_decimal IS NOT NULL
                     AND included_in_accuracy = true)   -- 184  ← qualifying for B-CAL
  COUNT(*) FILTER (WHERE run_kind='paper_trade' AND status='graded'
                     AND odds_player1_decimal IS NOT NULL)  -- 201  ← graded+odds (17 not in accuracy)
  COUNT(*) FILTER (WHERE run_kind='paper_trade' AND status='graded')  -- 538
  COUNT(*) FILTER (WHERE run_kind='paper_trade')              -- 1486
FROM evaluation_predictions;
```

### Reconciling the 180 / 184 / 201 / 202 discrepancy

| Count | Definition | Explains |
|---|---|---|
| **184** | `graded + odds + included_in_accuracy=true` | Strictest B-CAL qualifying set; what Section A and B-CAL use |
| **201** | `graded + odds` | 17 rows have `included_in_accuracy=false` (data-quality flags or provider outage at lock time) |
| **202** | Same as 201 but queried 1 row later | One new graded row arrived between the two queries |
| **180** | Section B engine re-run successfully paired rows | 184 eligible − 4 skipped (no match history or bad input) = 180 |

---

## Status: WAITING — below 500-row floor

**Current qualifying count: 184** (as of 2026-08-01 15:26:22 UTC)
**Required floor: 500** (task specification: do not re-run B-CAL below 500)

Need 316 more qualifying rows before re-running Section B-CAL.
Paper-trading loop is running. Re-check count and re-run when qualifying ≥500.

---

## Results (2026-08-01, n=184 Section A/B-CAL, n=180 Section B)

### Section A — Market Direction (no re-run needed)
- Market AGREES with model (n=138): model accuracy = 78.3%
- Market DISAGREES with model (n=46): model accuracy = **30.4%** (market correct 69.6%)
- Positive edge rows (model sees value vs market): n=69, 44.9%
- Negative edge rows (market MORE confident): n=115, 79.1%

### Section B — Engine Re-run (paper_trade, n=180)
- With market odds:    accuracy=67.2%, log-loss=0.6355 (stored old-vintage calibrated prob)
- Without market odds: accuracy=65.6%, log-loss=0.6112
- **Δacc = +1.6pp**, **Δlog-loss = +0.0243** (with-odds appears worse — see B-CAL below)
- VERDICT at n=180: EXCLUDE (below 200 required threshold)

### Section B-CAL — Calibration Vintage Diagnostic (2026-08-01)

| Variant | Log-Loss | Brier |
|---|---|---|
| (A) Stored calibrated prob (old curve) | 0.6361 | 0.2225 |
| (B) Current global curve re-applied to rawProb [cross-check] | **0.6149** | — |
| (C) New market-odds-aware refit curve | 0.6333 | 0.2215 |

**Cross-check gap A→B = +0.0212**: stored probs used an older calibration model vintage.
Section B's +0.0243 log-loss regression compared old-curve "with odds" vs current-curve
"without odds" re-run — ~0.0212 of structural vintage-mismatch bias.
Correcting: actual regression ≈ **+0.003** — essentially zero.

**Verdict:** Log-loss regression is largely a calibration vintage artifact. But (C) only
beats (A) by +0.0029 — the new market-odds-aware curve barely outperforms stored.

### Open question: Why does (C) underperform (B)?

At n=184 (fit split ≈ 84 points), the isotonic-binned curve is too thin to be trustworthy.
The 84-point fit gives a noisy curve that barely beats the stored (old) global curve (A) by
0.0029 but loses to the current global curve (B) re-applied to the same raw probs by 0.0184.

**This is not evidence about market odds — it's evidence the curve-fitting sample was too small.**

---

## B-CAL Re-validation Plan (once qualifying ≥ 500)

Run: `pnpm --filter @workspace/api-server exec tsx src/scripts/auditMarketConsensusAblation.ts`
- Sections A and B-CAL print fast (< 1 min, before the slow context build)
- Target: 500–700 qualifying rows to give the isotonic curve enough fit data

**Decision rule after re-validation:**
- If (C) beats (B): stale-curve artifact confirmed → Task #83 (weight-tuning) NOT needed
- If (C) still underperforms (B) at 500-700 rows: real module problem → Task #83 stays active

### Section B design limitation (known, structural)
Section B always uses stored `calibratedProbability` for the "with odds" arm and applies the
current model live for the "without odds" re-run arm. This vintage mismatch will show a LL
regression on every future run. **Do NOT interpret that gap as module signal** — it is structural.

### Section C — Historical Market Odds (tennis-data.co.uk)
- 5,932 rows eligible; walk-forward (evaluationOnly=true) running since 2026-08-01 14:27 UTC
- Re-run script after walk-forward completes for Section C results
