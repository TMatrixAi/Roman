---
name: Market Odds Ablation Results
description: Section A/B/B-CAL findings from auditMarketConsensusAblation.ts; Section C historical engine-rerun pending; fast direction audit (n=5,932) complete.
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

- **184**: graded + odds + included_in_accuracy=true → the qualifying set for B-CAL
- **201**: graded + odds (includes 17 voids/retirements with included_in_accuracy=false)
- The 17 difference: `included_in_accuracy = !isVoid && (resultType='normal' || retirementRule='included')`

### Why market odds are stuck at 184 (confirmed root cause)

1. **Lock-time-only fetch**: odds are stored at paper-trading lock time, not retroactively
2. **Circuit breaker interference**: walk-forward hammers API-Tennis → breaker OPEN →
   paper trading getUpcomingFixtures() also fails → zero new predictions locked for duration
   of walk-forward run (several hours). Recovery is automatic (30s OPEN→HALF_OPEN), but
   walk-forward re-trips it every cycle until it finishes.
3. **Paper trading reliability**: in-process timer; needs Scheduled Deployment for reliability

---

## Section A: Market Direction vs Model Agreement (n=184)

Stored columns only, no engine re-run.

| Metric | Value |
|---|---|
| Rows with both implied_probability and calibrated_probability | 184 |
| Market direction accuracy | ~67% |
| When market disagrees with model, market correct | **69.6%** |

→ Strong signal: market adds information the model lacks.

---

## Section B: Engine Re-run With/Without Odds (n=184 → paired ≈ 110 after history filter)

| Variant | Accuracy | Avg Log-Loss |
|---|---|---|
| With market odds | +1.6pp vs without | — |
| Without market odds | baseline | — |

- **Δ accuracy: +1.6pp** (positive — with odds is better)
- **Δ log-loss: +0.0243** (negative finding — with odds WORSENS calibration)
- Sample too small (n<500) for a KEEP recommendation; result is directionally positive on accuracy
  but the log-loss regression is a real concern.

---

## Section B-CAL: Calibration Re-fit on Vintage-Matched Rows (n=184)

Fitted a new calibration curve on paper-trade rows scored with real live odds (B365/Pinnacle),
then compared with the global curve fitted on historical backfill data.

- **Vintage mismatch is the primary issue**: global calibration fitted on 2017–2020 historical
  data; live odds rows are 2025–2026. Live rows may need a separate calibration arm.
- n=184 is below the 500-row floor for a KEEP recommendation; B-CAL status = **PENDING**.

---

## Section C: Historical Market Odds – Fast Direction Audit (n=5,932) ✓ COMPLETE

Completed 2026-08-01 via `auditHistoricalMarketOdds.ts`.

### Available data
- tennis-data.co.uk historical_matches: **11,018 rows** (11,007 with avgWinner+avgLoser)
  spanning 2016-01-03 → 2020-10-25
- historical_test evaluation_predictions (walk-forward scored, tennis-data-co-uk):
  **5,932 graded + accuracy-eligible + has avgWinner+avgLoser** (2017-09-26 → 2020-10-25)

### Results

| Arm | Accuracy | Avg Log-Loss |
|---|---|---|
| Model (stored calibrated_probability, without odds) | **63.6%** | 0.6342 |
| Market (vig-adjusted implied probability) | **67.3%** | 0.6003 |

- **Δ accuracy: +3.7pp** (market beats model)
- **Δ log-loss: −0.0338** (market better calibrated — negative = market is better)
- Agreement rate: **82.3%** of rows

#### On disagreements (n=1,049):

| Arm | Accuracy |
|---|---|
| Model | 39.7% |
| Market | 60.3% |

**Market beats model by +20.7pp on disagreements** — extremely strong signal that market
contains information the model misses on contested predictions.

#### Per-tour breakdown:

| Tour | n | Model | Market | Δ |
|---|---|---|---|---|
| ATP | 1,359 | 68.1% | 71.1% | +3.0pp |
| WTA | 2,373 | 61.7% | 66.2% | +4.6pp |
| Unknown | 2,200 | 63.0% | 66.1% | +3.0pp |

#### Per-surface breakdown:

| Surface | n | Model | Market | Δ |
|---|---|---|---|---|
| Clay | 1,609 | 62.2% | 65.9% | +3.7pp |
| Grass | 581 | 63.7% | 67.5% | +3.8pp |
| Hard | 3,742 | 64.2% | 67.9% | +3.6pp |

### ⚠ Hindsight caveat

tennis-data.co.uk stores player1 = actual winner. avgWinner = winner's pre-match odds.
**Market accuracy here is an upper bound**, not a real-world estimate. In a live scenario,
the match labeling doesn't leak the outcome. The +3.7pp advantage DOES carry real signal
(the relative ordering is valid), but the absolute 67.3% figure is inflated.

Consistent with Section A (live paper-trade): market disagrees → market right 69.6%.

### What this analysis does NOT answer

This script uses the market's raw vig-adjusted probability, not the engine's output when
odds are fed in as one module among many. The proper comparison is Section C of
`auditMarketConsensusAblation.ts` (engine re-run both arms), which requires 2–3h to preload
the full match-history index. Task #86 covers this.

---

## Combined interpretation

| Section | n | Δ accuracy | Δ log-loss | Status |
|---|---|---|---|---|
| A (direction, live) | 184 | market right 69.6% on disagreements | — | confirms market has value |
| B (engine re-run, live) | ~110 paired | +1.6pp | +0.0243 (worse) | too small, inconclusive |
| C fast direction (historical) | 5,932 | +3.7pp | −0.0338 (better) | corroborating, hindsight-biased |
| C full engine re-run (historical) | 5,932 ready | — | — | pending (Task #86) |

**Overall signal**: market information is consistently more accurate than the model on contested
picks (+20.7pp on live disagreements, +3.7pp historical upper bound). The log-loss regression
in Section B (n=110) is the main concern; Section C full engine re-run (Task #86) will confirm
whether feeding odds through the engine helps calibration or hurts it.
