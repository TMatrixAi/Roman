# Model Ablation Analysis for the Prediction Engine

Generated 2026-07-13T00:25:05.038Z against 18,242 real, graded historical matches.

## Caveats
- This report replays the historical backtest corpus (frozen pre-match snapshots, no hindsight leakage) through the exact live ensemble engine, using the CURRENTLY ACTIVE calibration and segment-specialist models. Those were themselves fit on walk-forward folds of this same corpus, so this is a diagnostic on the current production configuration, not a fresh out-of-sample benchmark.
- "Active Segment Specialist" ablation only changes matches whose tour/surface is an actual candidate segment (ATP/WTA on Hard/Clay/Grass/IndoorHard) with an active specialist that has cleared its data threshold -- it is a true no-op on every other match, which is expected, not a bug.
- "Favorite vs. underdog" segments compare each variant's own pick against the BASELINE (full-engine) run's pick for the same match -- there is no independent market-odds favorite in this historical corpus, so the full engine's own pick is used as the reference favorite.
- No engine code, weights, or active models were changed by generating this report -- it is evidence and recommendations only.

## Baseline (everything active)
Overall accuracy: **54.9%** (n=13032)

## Leave-one-out ranking (Most Valuable → Harmful)

| Model | Baseline acc. | With model removed | Δ (removed − baseline) | Rank | Recommendation |
|---|---|---|---|---|---|
| Serve & Return | 54.9% | 53.5% | -1.4pt | Valuable | Keep |
| Surface Elo | 54.9% | 54.5% | -0.4pt | Neutral | Review |
| Recent Form | 54.9% | 54.9% | 0.0pt | Neutral | Review |
| Fatigue | 54.9% | 55.0% | +0.1pt | Neutral | Review |
| Head-to-Head | 54.9% | 54.9% | 0.0pt | Neutral | Review |
| General Ensemble | 54.9% | 54.9% | 0.0pt | Neutral | Review |
| Active Segment Specialist | 54.9% | 54.8% | -0.1pt | Neutral | Review |
| Availability (rest/travel/injury) | 54.9% | 56.6% | +1.7pt | Weak | Candidate for lower weight |

_Reading this table: a **negative** delta means removing the model made accuracy WORSE -- the model is earning its place. A **positive** delta means removing it made accuracy BETTER -- the model may be actively hurting predictions._

## Leave-one-out detail by segment

### Serve & Return (Valuable, Keep)
Overall: 54.9% → 53.5% (-1.4pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 53.4% (n=2675) | 51.5% (n=2675) | -1.9pt |
| Tour: WTA | 56.2% (n=1155) | 54.2% (n=1155) | -2.0pt |
| Tour: ITF | 55.1% (n=7866) | 54.1% (n=7866) | -1.0pt |
| Tour: ATP | 55.8% (n=1208) | 54.2% (n=1208) | -1.6pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 53.2% (n=109) | 45.9% (n=109) | -7.3pt |
| Tour: Mixed Doubles | 46.2% (n=13) | 46.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 0.0% (n=2) | -50.0pt |
| Surface: Hard | 55.3% (n=8074) | 54.0% (n=8074) | -1.3pt |
| Surface: Clay | 54.3% (n=3761) | 52.8% (n=3761) | -1.5pt |
| Surface: IndoorHard | 53.8% (n=1035) | 51.8% (n=1035) | -2.0pt |
| Surface: Grass | 55.6% (n=162) | 56.2% (n=162) | +0.6pt |
| High Data Quality (≥65) | 57.1% (n=2320) | 55.9% (n=2246) | -1.2pt |
| Low Data Quality (<65) | 54.4% (n=10712) | 53.0% (n=10786) | -1.4pt |
| Picks that flipped away from the full-engine favorite | n/a | 44.2% (n=1544) | -- |

### Surface Elo (Neutral, Review)
Overall: 54.9% → 54.5% (-0.4pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 53.4% (n=2675) | 53.3% (n=2675) | -0.1pt |
| Tour: WTA | 56.2% (n=1155) | 55.6% (n=1155) | -0.6pt |
| Tour: ITF | 55.1% (n=7866) | 54.6% (n=7866) | -0.5pt |
| Tour: ATP | 55.8% (n=1208) | 55.7% (n=1208) | -0.1pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 53.2% (n=109) | 54.1% (n=109) | +0.9pt |
| Tour: Mixed Doubles | 46.2% (n=13) | 46.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 55.3% (n=8074) | 54.9% (n=8074) | -0.4pt |
| Surface: Clay | 54.3% (n=3761) | 53.5% (n=3761) | -0.8pt |
| Surface: IndoorHard | 53.8% (n=1035) | 54.6% (n=1035) | +0.8pt |
| Surface: Grass | 55.6% (n=162) | 56.8% (n=162) | +1.2pt |
| High Data Quality (≥65) | 57.1% (n=2320) | 57.6% (n=2201) | +0.5pt |
| Low Data Quality (<65) | 54.4% (n=10712) | 53.9% (n=10831) | -0.5pt |
| Picks that flipped away from the full-engine favorite | n/a | 45.5% (n=583) | -- |

### Recent Form (Neutral, Review)
Overall: 54.9% → 54.9% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 53.4% (n=2675) | 52.3% (n=2675) | -1.1pt |
| Tour: WTA | 56.2% (n=1155) | 57.0% (n=1155) | +0.8pt |
| Tour: ITF | 55.1% (n=7866) | 55.3% (n=7866) | +0.2pt |
| Tour: ATP | 55.8% (n=1208) | 55.9% (n=1208) | +0.1pt |
| Tour: Teams Mix | 75.0% (n=4) | 50.0% (n=4) | -25.0pt |
| Tour: Junior | 53.2% (n=109) | 50.5% (n=109) | -2.7pt |
| Tour: Mixed Doubles | 46.2% (n=13) | 46.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 55.3% (n=8074) | 55.5% (n=8074) | +0.2pt |
| Surface: Clay | 54.3% (n=3761) | 53.8% (n=3761) | -0.5pt |
| Surface: IndoorHard | 53.8% (n=1035) | 53.4% (n=1035) | -0.4pt |
| Surface: Grass | 55.6% (n=162) | 54.9% (n=162) | -0.7pt |
| High Data Quality (≥65) | 57.1% (n=2320) | 56.4% (n=1604) | -0.7pt |
| Low Data Quality (<65) | 54.4% (n=10712) | 54.6% (n=11428) | +0.2pt |
| Picks that flipped away from the full-engine favorite | n/a | 49.9% (n=1613) | -- |

### Fatigue (Neutral, Review)
Overall: 54.9% → 55.0% (+0.1pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 53.4% (n=2675) | 53.6% (n=2675) | +0.2pt |
| Tour: WTA | 56.2% (n=1155) | 55.7% (n=1155) | -0.5pt |
| Tour: ITF | 55.1% (n=7866) | 55.3% (n=7866) | +0.2pt |
| Tour: ATP | 55.8% (n=1208) | 55.4% (n=1208) | -0.4pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 53.2% (n=109) | 54.1% (n=109) | +0.9pt |
| Tour: Mixed Doubles | 46.2% (n=13) | 46.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 55.3% (n=8074) | 55.3% (n=8074) | 0.0pt |
| Surface: Clay | 54.3% (n=3761) | 54.4% (n=3761) | +0.1pt |
| Surface: IndoorHard | 53.8% (n=1035) | 54.2% (n=1035) | +0.4pt |
| Surface: Grass | 55.6% (n=162) | 56.2% (n=162) | +0.6pt |
| High Data Quality (≥65) | 57.1% (n=2320) | 57.0% (n=2274) | -0.1pt |
| Low Data Quality (<65) | 54.4% (n=10712) | 54.5% (n=10758) | +0.1pt |
| Picks that flipped away from the full-engine favorite | n/a | 54.0% (n=137) | -- |

### Head-to-Head (Neutral, Review)
Overall: 54.9% → 54.9% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 53.4% (n=2675) | 53.5% (n=2675) | +0.1pt |
| Tour: WTA | 56.2% (n=1155) | 56.0% (n=1155) | -0.2pt |
| Tour: ITF | 55.1% (n=7866) | 55.2% (n=7866) | +0.1pt |
| Tour: ATP | 55.8% (n=1208) | 55.4% (n=1208) | -0.4pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 53.2% (n=109) | 53.2% (n=109) | 0.0pt |
| Tour: Mixed Doubles | 46.2% (n=13) | 46.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 55.3% (n=8074) | 55.3% (n=8074) | 0.0pt |
| Surface: Clay | 54.3% (n=3761) | 54.5% (n=3761) | +0.2pt |
| Surface: IndoorHard | 53.8% (n=1035) | 54.1% (n=1035) | +0.3pt |
| Surface: Grass | 55.6% (n=162) | 54.3% (n=162) | -1.3pt |
| High Data Quality (≥65) | 57.1% (n=2320) | 57.2% (n=3013) | +0.1pt |
| Low Data Quality (<65) | 54.4% (n=10712) | 54.3% (n=10019) | -0.1pt |
| Picks that flipped away from the full-engine favorite | n/a | 51.7% (n=178) | -- |

### General Ensemble (Neutral, Review)
Overall: 54.9% → 54.9% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 53.4% (n=2675) | 53.5% (n=2675) | +0.1pt |
| Tour: WTA | 56.2% (n=1155) | 55.6% (n=1155) | -0.6pt |
| Tour: ITF | 55.1% (n=7866) | 55.3% (n=7866) | +0.2pt |
| Tour: ATP | 55.8% (n=1208) | 55.2% (n=1208) | -0.6pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 53.2% (n=109) | 55.0% (n=109) | +1.8pt |
| Tour: Mixed Doubles | 46.2% (n=13) | 46.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 55.3% (n=8074) | 55.3% (n=8074) | 0.0pt |
| Surface: Clay | 54.3% (n=3761) | 54.5% (n=3761) | +0.2pt |
| Surface: IndoorHard | 53.8% (n=1035) | 54.1% (n=1035) | +0.3pt |
| Surface: Grass | 55.6% (n=162) | 55.6% (n=162) | 0.0pt |
| High Data Quality (≥65) | 57.1% (n=2320) | 57.1% (n=2320) | 0.0pt |
| Low Data Quality (<65) | 54.4% (n=10712) | 54.5% (n=10712) | +0.1pt |
| Picks that flipped away from the full-engine favorite | n/a | 52.0% (n=175) | -- |

### Active Segment Specialist (Neutral, Review)
Overall: 54.9% → 54.8% (-0.1pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 53.4% (n=2675) | 53.3% (n=2675) | -0.1pt |
| Tour: WTA | 56.2% (n=1155) | 55.2% (n=1155) | -1.0pt |
| Tour: ITF | 55.1% (n=7866) | 55.2% (n=7866) | +0.1pt |
| Tour: ATP | 55.8% (n=1208) | 55.0% (n=1208) | -0.8pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 53.2% (n=109) | 53.2% (n=109) | 0.0pt |
| Tour: Mixed Doubles | 46.2% (n=13) | 46.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 55.3% (n=8074) | 55.2% (n=8074) | -0.1pt |
| Surface: Clay | 54.3% (n=3761) | 54.2% (n=3761) | -0.1pt |
| Surface: IndoorHard | 53.8% (n=1035) | 53.9% (n=1035) | +0.1pt |
| Surface: Grass | 55.6% (n=162) | 55.6% (n=162) | 0.0pt |
| High Data Quality (≥65) | 57.1% (n=2320) | 57.1% (n=2320) | 0.0pt |
| Low Data Quality (<65) | 54.4% (n=10712) | 54.3% (n=10712) | -0.1pt |
| Picks that flipped away from the full-engine favorite | n/a | 47.4% (n=194) | -- |

### Availability (rest/travel/injury) (Weak, Candidate for lower weight)
Overall: 54.9% → 56.6% (+1.7pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 53.4% (n=2675) | 55.0% (n=2675) | +1.6pt |
| Tour: WTA | 56.2% (n=1155) | 56.4% (n=1155) | +0.2pt |
| Tour: ITF | 55.1% (n=7866) | 57.3% (n=7866) | +2.2pt |
| Tour: ATP | 55.8% (n=1208) | 55.8% (n=1208) | 0.0pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 53.2% (n=109) | 56.0% (n=109) | +2.8pt |
| Tour: Mixed Doubles | 46.2% (n=13) | 61.5% (n=13) | +15.3pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 55.3% (n=8074) | 56.6% (n=8074) | +1.3pt |
| Surface: Clay | 54.3% (n=3761) | 56.8% (n=3761) | +2.5pt |
| Surface: IndoorHard | 53.8% (n=1035) | 56.4% (n=1035) | +2.6pt |
| Surface: Grass | 55.6% (n=162) | 58.0% (n=162) | +2.4pt |
| High Data Quality (≥65) | 57.1% (n=2320) | 56.3% (n=2474) | -0.8pt |
| Low Data Quality (<65) | 54.4% (n=10712) | 56.7% (n=10558) | +2.3pt |
| Picks that flipped away from the full-engine favorite | n/a | 60.0% (n=1132) | -- |

## Multi-model combinations

| Combination | Overall accuracy | n |
|---|---|---|
| Core signals only (Surface Elo, Serve & Return, Recent Form) | 56.5% | 13032 |
| Everything active | 54.9% | 13032 |
| General calibration + specialists off (raw ensemble only) | 54.9% | 13032 |
| Segment specialists off | 54.8% | 13032 |

**Best overall win rate:** Core signals only (Surface Elo, Serve & Return, Recent Form) (56.5%)
**Worst overall win rate:** Segment specialists off (54.8%)

## Diagnostic questions

### Which model's vote most often coincides with a losing final prediction?
| Model | n (losses where this model voted) | Coincided with the losing pick |
|---|---|---|
| General Ensemble | 5879 | 99.4% |
| Active Segment Specialist | 969 | 85.0% |
| Recent Form | 5879 | 77.9% |
| Serve & Return | 5879 | 76.4% |
| Surface Elo | 5879 | 66.8% |
| Availability (rest/travel/injury) | 5879 | 56.1% |
| Head-to-Head | 5879 | 52.0% |
| Fatigue | 5879 | 50.9% |

### Which model is most often wrong specifically when it strongly favors a player (≥65% confidence)?
| Model | n (strong votes) | Favored player actually lost |
|---|---|---|
| Availability (rest/travel/injury) | 2509 | 54.0% |
| Recent Form | 4808 | 42.0% |
| Serve & Return | 6523 | 39.4% |
| Head-to-Head | 595 | 36.3% |
| General Ensemble | 315 | 33.7% |
| Surface Elo | 2086 | 33.4% |
| Active Segment Specialist | 153 | 33.3% |
| Fatigue | 0 | n/a |

### Which model's confidence is systematically miscalibrated relative to its real hit rate?
| Model | n | Avg. stated confidence | Observed hit rate | Overconfidence |
|---|---|---|---|---|
| Serve & Return | 13032 | 66.8% | 57.3% | +9.5pt |
| Recent Form | 13032 | 63.2% | 54.4% | +8.8pt |
| Availability (rest/travel/injury) | 13032 | 55.5% | 48.5% | +7.0pt |
| Surface Elo | 13032 | 57.3% | 55.9% | +1.4pt |
| Head-to-Head | 13032 | 52.1% | 51.4% | +0.7pt |
| Fatigue | 13032 | 50.0% | 50.8% | -0.8pt |
| Active Segment Specialist | 2192 | 54.3% | 55.2% | -0.9pt |
| General Ensemble | 13032 | 53.5% | 54.8% | -1.3pt |

_Positive overconfidence means the model states more confidence than its real hit rate supports._

### Which model most often disagrees with the final blended prediction, and how often would that dissent have been correct?
| Model | Dissent rate (of all matches) | n dissents | Dissent would have been correct |
|---|---|---|---|
| Serve & Return | 13.4% | 2453 | 56.5% |
| Surface Elo | 20.7% | 3771 | 51.7% |
| Recent Form | 14.6% | 2665 | 48.7% |
| Active Segment Specialist | 1.7% | 305 | 47.5% |
| Head-to-Head | 33.4% | 6093 | 46.3% |
| Fatigue | 34.6% | 6312 | 45.8% |
| Availability (rest/travel/injury) | 32.9% | 5999 | 43.0% |
| General Ensemble | 0.5% | 92 | 41.3% |
