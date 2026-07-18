# Engine Contradiction Scan — Task #32
**Generated:** 2026-07-18T15:20:16.864Z
**Graded predictions:** 2422
**Overall accuracy:** 76.9% (1862/2422)
**With decisionTrace:** 0

---

## Per-Tier Accuracy

| Tier | n | Accuracy | Avg Prob | Avg DQ | Model Conflicts | Elite |
|---|---|---|---|---|---|---|
| NO_STRONG_SIGNAL ⚠️ | 917 | 53.4% | 50.4% | 75 | 5 | 1 |
| HIGH_RISK | 615 | 84.2% | 50.9% | 78 | 0 | 3 |
| DO_NOT_RECOMMEND | 485 | 97.1% | 50.2% | 15 | 0 | 0 |
| MODERATE_LEAN | 404 | 94.6% | 50.9% | 82 | 0 | 7 |
| STRONG_RECOMMENDATION | 1 | 100.0% | 20.0% | 94 | 0 | 1 |
| **OVERALL** | **2422** | **76.9%** | — | — | 5 | 12 |

## Elite Tier

- n = 12
- Accuracy: 41.7% (5/12)
- vs. baseline: -35.2pt

## Model Conflict

- n = 5 (0.2% of graded)
- Accuracy: 40.0%
- vs. baseline: -36.9pt

## Tie-Breaker Applied

- n = 468 (19.3% of graded)
- Accuracy: 30.8%
- vs. baseline: -46.1pt

## Data Quality Band Calibration

| DQ Band | n | Accuracy | Avg Winner Prob | Calibration Gap |
|---|---|---|---|---|
| 0-24 (Poor) ⚠️ | 485 | 97.1% | 55.0% | +42.1pt |
| 25-44 (Marginal) ⚠️ | 184 | 87.5% | 53.7% | +33.8pt |
| 45-54 (Acceptable-low) ⚠️ | 91 | 75.8% | 54.6% | +21.2pt |
| 55-64 (Acceptable-high) ⚠️ | 153 | 73.2% | 56.3% | +16.9pt |
| 65-84 (Good/Strong) ⚠️ | 583 | 76.2% | 56.5% | +19.6pt |
| 85-100 (Excellent) ⚠️ | 926 | 65.3% | 55.9% | +9.5pt |

## Structural Contradictions Found

- ⚠️ DQ 85-100 band: calibration gap = 9.5pt (accuracy 65.3% vs stated 55.9%) on n=926 — overconfidence or underconfidence confirmed
- ⚠️ ELITE tier accuracy (41.7%) is BELOW overall baseline (76.9%) on n=12 — elite gates may not be selecting the right subset
- ⚠️ MODEL CONFLICT predictions have very low accuracy (40.0%) on n=5 — calibration override is consistently wrong

---

*Report written by `contradictionScan.ts` (Task #32). Baseline = overall accuracy on graded predictions. Calibration gap = (accuracy% − avg predicted winner probability). Negative gap = model overconfident; positive = underconfident.*