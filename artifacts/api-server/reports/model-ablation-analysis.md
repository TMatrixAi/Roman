# Model Ablation Analysis for the Prediction Engine

Generated 2026-07-13T07:51:24.778Z against 18,281 real, graded historical matches.

## Caveats
- This report replays the historical backtest corpus (frozen pre-match snapshots, no hindsight leakage) through the exact live ensemble engine, using the CURRENTLY ACTIVE calibration and segment-specialist models. Those were themselves fit on walk-forward folds of this same corpus, so this is a diagnostic on the current production configuration, not a fresh out-of-sample benchmark.
- "Active Segment Specialist" ablation only changes matches whose tour/surface is an actual candidate segment (ATP/WTA on Hard/Clay/Grass/IndoorHard) with an active specialist that has cleared its data threshold -- it is a true no-op on every other match, which is expected, not a bug.
- "Favorite vs. underdog" segments compare each variant's own pick against the BASELINE (full-engine) run's pick for the same match -- there is no independent market-odds favorite in this historical corpus, so the full engine's own pick is used as the reference favorite.
- No engine code, weights, or active models were changed by generating this report -- it is evidence and recommendations only.

## Baseline (everything active)
Overall accuracy: **57.3%** (n=13066)

## Leave-one-out ranking (Most Valuable → Harmful)

| Model | Baseline acc. | With model removed | Δ (removed − baseline) | Rank | Recommendation |
|---|---|---|---|---|---|
| Surface Elo | 57.3% | 57.3% | 0.0pt | Neutral | Review |
| Serve & Return | 57.3% | 57.4% | +0.1pt | Neutral | Review |
| Recent Form | 57.3% | 57.6% | +0.3pt | Neutral | Review |
| Fatigue | 57.3% | 57.4% | +0.1pt | Neutral | Review |
| Availability (rest/travel/injury) | 57.3% | 57.4% | +0.1pt | Neutral | Review |
| Head-to-Head | 57.3% | 57.3% | 0.0pt | Neutral | Review |
| General Ensemble | 57.3% | 57.4% | +0.1pt | Neutral | Review |
| Active Segment Specialist | 57.3% | 57.3% | 0.0pt | Neutral | Review |

_Reading this table: a **negative** delta means removing the model made accuracy WORSE -- the model is earning its place. A **positive** delta means removing it made accuracy BETTER -- the model may be actively hurting predictions._

## Leave-one-out detail by segment

### Surface Elo (Neutral, Review)
Overall: 57.3% → 57.3% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: ATP | 54.6% (n=1242) | 56.2% (n=1242) | +1.6pt |
| Tour: Challenger | 55.0% (n=2675) | 54.8% (n=2675) | -0.2pt |
| Tour: WTA | 55.2% (n=1155) | 54.5% (n=1155) | -0.7pt |
| Tour: ITF | 58.9% (n=7866) | 58.7% (n=7866) | -0.2pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 54.1% (n=109) | 54.1% (n=109) | 0.0pt |
| Tour: Mixed Doubles | 69.2% (n=13) | 69.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 57.0% (n=8108) | 57.2% (n=8108) | +0.2pt |
| Surface: Clay | 57.8% (n=3761) | 57.6% (n=3761) | -0.2pt |
| Surface: IndoorHard | 57.3% (n=1035) | 57.0% (n=1035) | -0.3pt |
| Surface: Grass | 59.9% (n=162) | 58.6% (n=162) | -1.3pt |
| High Data Quality (≥65) | 56.0% (n=2398) | 56.4% (n=2317) | +0.4pt |
| Low Data Quality (<65) | 57.6% (n=10668) | 57.5% (n=10749) | -0.1pt |
| Picks that flipped away from the full-engine favorite | n/a | 49.3% (n=268) | -- |

### Serve & Return (Neutral, Review)
Overall: 57.3% → 57.4% (+0.1pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: ATP | 54.6% (n=1242) | 54.8% (n=1242) | +0.2pt |
| Tour: Challenger | 55.0% (n=2675) | 54.8% (n=2675) | -0.2pt |
| Tour: WTA | 55.2% (n=1155) | 55.8% (n=1155) | +0.6pt |
| Tour: ITF | 58.9% (n=7866) | 59.0% (n=7866) | +0.1pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 54.1% (n=109) | 54.1% (n=109) | 0.0pt |
| Tour: Mixed Doubles | 69.2% (n=13) | 69.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 57.0% (n=8108) | 57.3% (n=8108) | +0.3pt |
| Surface: Clay | 57.8% (n=3761) | 57.6% (n=3761) | -0.2pt |
| Surface: IndoorHard | 57.3% (n=1035) | 57.1% (n=1035) | -0.2pt |
| Surface: Grass | 59.9% (n=162) | 61.1% (n=162) | +1.2pt |
| High Data Quality (≥65) | 56.0% (n=2398) | 57.3% (n=2267) | +1.3pt |
| Low Data Quality (<65) | 57.6% (n=10668) | 57.4% (n=10799) | -0.2pt |
| Picks that flipped away from the full-engine favorite | n/a | 51.3% (n=398) | -- |

### Recent Form (Neutral, Review)
Overall: 57.3% → 57.6% (+0.3pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: ATP | 54.6% (n=1242) | 55.5% (n=1242) | +0.9pt |
| Tour: Challenger | 55.0% (n=2675) | 55.1% (n=2675) | +0.1pt |
| Tour: WTA | 55.2% (n=1155) | 55.3% (n=1155) | +0.1pt |
| Tour: ITF | 58.9% (n=7866) | 59.2% (n=7866) | +0.3pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 54.1% (n=109) | 54.1% (n=109) | 0.0pt |
| Tour: Mixed Doubles | 69.2% (n=13) | 69.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 57.0% (n=8108) | 57.5% (n=8108) | +0.5pt |
| Surface: Clay | 57.8% (n=3761) | 57.9% (n=3761) | +0.1pt |
| Surface: IndoorHard | 57.3% (n=1035) | 57.1% (n=1035) | -0.2pt |
| Surface: Grass | 59.9% (n=162) | 59.9% (n=162) | 0.0pt |
| High Data Quality (≥65) | 56.0% (n=2398) | 56.0% (n=1682) | 0.0pt |
| Low Data Quality (<65) | 57.6% (n=10668) | 57.9% (n=11384) | +0.3pt |
| Picks that flipped away from the full-engine favorite | n/a | 63.2% (n=144) | -- |

### Fatigue (Neutral, Review)
Overall: 57.3% → 57.4% (+0.1pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: ATP | 54.6% (n=1242) | 54.9% (n=1242) | +0.3pt |
| Tour: Challenger | 55.0% (n=2675) | 54.9% (n=2675) | -0.1pt |
| Tour: WTA | 55.2% (n=1155) | 55.2% (n=1155) | 0.0pt |
| Tour: ITF | 58.9% (n=7866) | 59.0% (n=7866) | +0.1pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 54.1% (n=109) | 54.1% (n=109) | 0.0pt |
| Tour: Mixed Doubles | 69.2% (n=13) | 69.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 57.0% (n=8108) | 57.2% (n=8108) | +0.2pt |
| Surface: Clay | 57.8% (n=3761) | 57.8% (n=3761) | 0.0pt |
| Surface: IndoorHard | 57.3% (n=1035) | 57.6% (n=1035) | +0.3pt |
| Surface: Grass | 59.9% (n=162) | 58.0% (n=162) | -1.9pt |
| High Data Quality (≥65) | 56.0% (n=2398) | 56.0% (n=2330) | 0.0pt |
| Low Data Quality (<65) | 57.6% (n=10668) | 57.8% (n=10736) | +0.2pt |
| Picks that flipped away from the full-engine favorite | n/a | 59.3% (n=81) | -- |

### Availability (rest/travel/injury) (Neutral, Review)
Overall: 57.3% → 57.4% (+0.1pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: ATP | 54.6% (n=1242) | 54.8% (n=1242) | +0.2pt |
| Tour: Challenger | 55.0% (n=2675) | 54.9% (n=2675) | -0.1pt |
| Tour: WTA | 55.2% (n=1155) | 55.2% (n=1155) | 0.0pt |
| Tour: ITF | 58.9% (n=7866) | 59.0% (n=7866) | +0.1pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 54.1% (n=109) | 54.1% (n=109) | 0.0pt |
| Tour: Mixed Doubles | 69.2% (n=13) | 69.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 57.0% (n=8108) | 57.2% (n=8108) | +0.2pt |
| Surface: Clay | 57.8% (n=3761) | 57.9% (n=3761) | +0.1pt |
| Surface: IndoorHard | 57.3% (n=1035) | 57.5% (n=1035) | +0.2pt |
| Surface: Grass | 59.9% (n=162) | 58.0% (n=162) | -1.9pt |
| High Data Quality (≥65) | 56.0% (n=2398) | 55.8% (n=2563) | -0.2pt |
| Low Data Quality (<65) | 57.6% (n=10668) | 57.8% (n=10503) | +0.2pt |
| Picks that flipped away from the full-engine favorite | n/a | 59.7% (n=62) | -- |

### Head-to-Head (Neutral, Review)
Overall: 57.3% → 57.3% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: ATP | 54.6% (n=1242) | 54.4% (n=1242) | -0.2pt |
| Tour: Challenger | 55.0% (n=2675) | 55.0% (n=2675) | 0.0pt |
| Tour: WTA | 55.2% (n=1155) | 55.2% (n=1155) | 0.0pt |
| Tour: ITF | 58.9% (n=7866) | 58.8% (n=7866) | -0.1pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 54.1% (n=109) | 54.1% (n=109) | 0.0pt |
| Tour: Mixed Doubles | 69.2% (n=13) | 69.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 57.0% (n=8108) | 57.0% (n=8108) | 0.0pt |
| Surface: Clay | 57.8% (n=3761) | 57.7% (n=3761) | -0.1pt |
| Surface: IndoorHard | 57.3% (n=1035) | 57.3% (n=1035) | 0.0pt |
| Surface: Grass | 59.9% (n=162) | 59.3% (n=162) | -0.6pt |
| High Data Quality (≥65) | 56.0% (n=2398) | 56.5% (n=3091) | +0.5pt |
| Low Data Quality (<65) | 57.6% (n=10668) | 57.5% (n=9975) | -0.1pt |
| Picks that flipped away from the full-engine favorite | n/a | 38.1% (n=21) | -- |

### General Ensemble (Neutral, Review)
Overall: 57.3% → 57.4% (+0.1pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: ATP | 54.6% (n=1242) | 55.3% (n=1242) | +0.7pt |
| Tour: Challenger | 55.0% (n=2675) | 55.0% (n=2675) | 0.0pt |
| Tour: WTA | 55.2% (n=1155) | 55.2% (n=1155) | 0.0pt |
| Tour: ITF | 58.9% (n=7866) | 58.9% (n=7866) | 0.0pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 54.1% (n=109) | 54.1% (n=109) | 0.0pt |
| Tour: Mixed Doubles | 69.2% (n=13) | 69.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 57.0% (n=8108) | 57.0% (n=8108) | 0.0pt |
| Surface: Clay | 57.8% (n=3761) | 58.1% (n=3761) | +0.3pt |
| Surface: IndoorHard | 57.3% (n=1035) | 57.3% (n=1035) | 0.0pt |
| Surface: Grass | 59.9% (n=162) | 59.9% (n=162) | 0.0pt |
| High Data Quality (≥65) | 56.0% (n=2398) | 56.0% (n=2398) | 0.0pt |
| Low Data Quality (<65) | 57.6% (n=10668) | 57.7% (n=10668) | +0.1pt |
| Picks that flipped away from the full-engine favorite | n/a | 62.9% (n=35) | -- |

### Active Segment Specialist (Neutral, Review)
Overall: 57.3% → 57.3% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: ATP | 54.6% (n=1242) | 54.6% (n=1242) | 0.0pt |
| Tour: Challenger | 55.0% (n=2675) | 55.0% (n=2675) | 0.0pt |
| Tour: WTA | 55.2% (n=1155) | 55.2% (n=1155) | 0.0pt |
| Tour: ITF | 58.9% (n=7866) | 58.9% (n=7866) | 0.0pt |
| Tour: Teams Mix | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Tour: Junior | 54.1% (n=109) | 54.1% (n=109) | 0.0pt |
| Tour: Mixed Doubles | 69.2% (n=13) | 69.2% (n=13) | 0.0pt |
| Tour: Exhibition | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Surface: Hard | 57.0% (n=8108) | 57.0% (n=8108) | 0.0pt |
| Surface: Clay | 57.8% (n=3761) | 57.8% (n=3761) | 0.0pt |
| Surface: IndoorHard | 57.3% (n=1035) | 57.3% (n=1035) | 0.0pt |
| Surface: Grass | 59.9% (n=162) | 59.9% (n=162) | 0.0pt |
| High Data Quality (≥65) | 56.0% (n=2398) | 56.0% (n=2398) | 0.0pt |
| Low Data Quality (<65) | 57.6% (n=10668) | 57.6% (n=10668) | 0.0pt |
| Picks that flipped away from the full-engine favorite | n/a | n/a (n=0) | -- |

## Multi-model combinations

| Combination | Overall accuracy | n |
|---|---|---|
| Core signals only (Surface Elo, Serve & Return, Recent Form) | 57.4% | 13066 |
| Everything active | 57.3% | 13066 |
| Segment specialists off | 57.3% | 13066 |
| General calibration + specialists off (raw ensemble only) | 57.3% | 13066 |

**Best overall win rate:** Core signals only (Surface Elo, Serve & Return, Recent Form) (57.4%)
**Worst overall win rate:** General calibration + specialists off (raw ensemble only) (57.3%)

## Diagnostic questions

### Which model's vote most often coincides with a losing final prediction?
| Model | n (losses where this model voted) | Coincided with the losing pick |
|---|---|---|
| General Ensemble | 5576 | 100.0% |
| Serve & Return | 5576 | 94.0% |
| Recent Form | 5576 | 76.6% |
| Active Segment Specialist | 934 | 74.7% |
| Surface Elo | 5576 | 69.0% |
| Head-to-Head | 5576 | 49.7% |
| Availability (rest/travel/injury) | 5576 | 49.2% |
| Fatigue | 5576 | 49.1% |

### Which model is most often wrong specifically when it strongly favors a player (≥65% confidence)?
| Model | n (strong votes) | Favored player actually lost |
|---|---|---|
| Serve & Return | 1619 | 35.1% |
| Active Segment Specialist | 394 | 34.8% |
| Head-to-Head | 628 | 34.4% |
| General Ensemble | 1634 | 34.1% |
| Surface Elo | 2086 | 33.4% |
| Recent Form | 174 | 32.8% |
| Fatigue | 0 | n/a |
| Availability (rest/travel/injury) | 0 | n/a |

### Which model's confidence is systematically miscalibrated relative to its real hit rate?
| Model | n | Avg. stated confidence | Observed hit rate | Overconfidence |
|---|---|---|---|---|
| Active Segment Specialist | 2036 | 60.1% | 56.8% | +3.3pt |
| Surface Elo | 13066 | 57.3% | 55.8% | +1.5pt |
| General Ensemble | 13052 | 58.1% | 57.3% | +0.8pt |
| Head-to-Head | 13066 | 52.2% | 51.6% | +0.6pt |
| Serve & Return | 13066 | 57.5% | 57.1% | +0.4pt |
| Recent Form | 13066 | 54.6% | 54.2% | +0.4pt |
| Availability (rest/travel/injury) | 13066 | 50.1% | 50.8% | -0.7pt |
| Fatigue | 13066 | 50.0% | 50.9% | -0.9pt |

_Positive overconfidence means the model states more confidence than its real hit rate supports._

### Which model most often disagrees with the final blended prediction, and how often would that dissent have been correct?
| Model | Dissent rate (of all matches) | n dissents | Dissent would have been correct |
|---|---|---|---|
| Active Segment Specialist | 2.3% | 417 | 56.6% |
| Serve & Return | 3.8% | 699 | 48.1% |
| Surface Elo | 20.0% | 3657 | 47.2% |
| Head-to-Head | 34.8% | 6358 | 44.1% |
| Fatigue | 35.6% | 6513 | 43.6% |
| Availability (rest/travel/injury) | 35.6% | 6513 | 43.5% |
| Recent Form | 16.5% | 3009 | 43.3% |
| General Ensemble | 0.0% | 0 | n/a |
