---
name: Parlay Builder calibration findings
description: Key results from the first historical backfill + calibration run (1,500 legs)
---

## Rule
Always use the model-predicted winner (calibrated_probability > 50 → player1, else player2) as the
`selectedPlayerId` in the parlay backfill — not always player1. Using player1 arbitrarily gives a
~49% win rate baseline (noise), masking the validation engine's signal.

**Why:** `calibrated_probability` in `evaluation_predictions` is stored as a 0–100 **percentage**
(not 0–1 decimal). The threshold is `> 50`, not `> 0.5`. Model directional accuracy is ~62% on
historical matches, not coin-flip.

**How to apply:** In the backfill endpoint (`POST /admin/parlay/backfill`) and in
`backfillParlayLegOutcomes.ts`, check `calibrated_probability > 50` to decide which player to
pass as `selectedPlayerId`.

## Calibration Results (July 2026, n=1,500 backfill legs)

| Metric | Value |
|---|---|
| Overall win rate (model picks) | 53.3% |
| KEEP win rate | 63.3% (n=30) |
| BORDERLINE win rate | 53.0% (n=1,469) |
| REMOVE win rate | 100% (n=1 — too thin) |
| Strong grade win rate | 60.7% (n=89) |

## Distribution Issues
- 98% of legs land in BORDERLINE — KEEP threshold (validationScore ≥ 58 + riskScore ≤ 44) is
  extremely conservative. Only 30/1500 reach KEEP.
- Score distribution heavily compressed: 939 rows in 40–50, 452 in 50–60. Almost nothing scores >70.
- Many factor signals (Strength of Schedule, Market Consensus, Current Ranking, Rest & Fatigue,
  Injury & Fitness Risk, Historical Consistency/Volatility) return neutral (50) for ALL backfill
  rows — these require live API data not available in `asOfDate` temporal isolation mode.

## Factor Correlation Findings
- H2H is the only factor showing strong positive signal: 78.3% win rate when favorable (n=23).
- Recent Form and Surface Record show **negative** directional edge (-8.8pp and -6.8pp resp.) —
  likely because these advantages are already priced into the model's pick, not because the
  signal is wrong.
- Hard Advantage, Tournament Experience, Overall Win Rate, Source Agreement: <5pp edge, <0.05 r.
  May be dead-weight factors or captured elsewhere.

## Infrastructure Added
- `GET /api/admin/parlay/calibration` — calibration bucket report (deciles, tiers, grades, before/after REMOVE)
- `POST /api/admin/parlay/backfill` — async trigger (background job, immediate response)
- `GET /api/admin/parlay/backfill/status` — poll for completion
- CALIBRATION tab in AdminParlayBuilder.tsx — recharts bar chart + tier table + summary cards
