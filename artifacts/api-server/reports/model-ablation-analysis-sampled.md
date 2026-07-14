# Model Ablation Analysis for the Prediction Engine

Generated 2026-07-14T06:55:15.297Z against 4,001 real, graded historical matches.

## Caveats
- This run scored a REPRESENTATIVE SAMPLE of 4001 matches (requested 4000), stratified proportionally by surface and calendar year, out of 18242 eligible matches in the full corpus -- not the full corpus. Match-history/Elo context was still built from the full corpus, so each sampled match's reconstructed history is accurate; only which matches were SCORED was reduced.
- This report replays the historical backtest corpus (frozen pre-match snapshots, no hindsight leakage) through the exact live ensemble engine, using the CURRENTLY ACTIVE calibration and segment-specialist models. Those were themselves fit on walk-forward folds of this same corpus, so this is a diagnostic on the current production configuration, not a fresh out-of-sample benchmark.
- "Active Segment Specialist" ablation only changes matches whose tour/surface is an actual candidate segment (ATP/WTA on Hard/Clay/Grass/IndoorHard) with an active specialist that has cleared its data threshold -- it is a true no-op on every other match, which is expected, not a bug.
- "Favorite vs. underdog" segments compare each variant's own pick against the BASELINE (full-engine) run's pick for the same match -- there is no independent market-odds favorite in this historical corpus, so the full engine's own pick is used as the reference favorite.
- No engine code, weights, or active models were changed by generating this report -- it is evidence and recommendations only.

## Baseline (everything active)
Overall accuracy: **57.3%** (n=2820)

## Leave-one-out ranking (Most Valuable → Harmful)

| Model | Baseline acc. | With model removed | Δ (removed − baseline) | Rank | Recommendation |
|---|---|---|---|---|---|
| Surface Elo | 57.3% | 57.1% | -0.2pt | Neutral | Review |
| Serve & Return | 57.3% | 56.4% | -0.9pt | Neutral | Review |
| Recent Form | 57.3% | 56.8% | -0.5pt | Neutral | Review |
| Fatigue | 57.3% | 57.3% | 0.0pt | Neutral | Review |
| Availability (rest/travel/injury) | 57.3% | 57.3% | 0.0pt | Neutral | Review |
| Head-to-Head | 57.3% | 57.2% | -0.1pt | Neutral | Review |
| Match Load Recovery | 57.3% | 57.3% | 0.0pt | Neutral | Review |
| General Ensemble | 57.3% | 57.3% | 0.0pt | Neutral | Review |
| Active Segment Specialist | 57.3% | 57.1% | -0.2pt | Neutral | Review |

_Reading this table: a **negative** delta means removing the model made accuracy WORSE -- the model is earning its place. A **positive** delta means removing it made accuracy BETTER -- the model may be actively hurting predictions._

## Leave-one-out detail by segment

### Surface Elo (Neutral, Review)
Overall: 57.3% → 57.1% (-0.2pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: WTA | 56.5% (n=248) | 57.3% (n=248) | +0.8pt |
| Tour: Challenger | 52.6% (n=576) | 52.1% (n=576) | -0.5pt |
| Tour: ITF | 58.9% (n=1710) | 58.5% (n=1710) | -0.4pt |
| Tour: ATP | 55.7% (n=255) | 56.9% (n=255) | +1.2pt |
| Tour: Junior | 74.1% (n=27) | 70.4% (n=27) | -3.7pt |
| Tour: Mixed Doubles | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Surface: Hard | 58.1% (n=1738) | 58.1% (n=1738) | 0.0pt |
| Surface: Clay | 56.0% (n=820) | 55.2% (n=820) | -0.8pt |
| Surface: IndoorHard | 55.5% (n=227) | 55.9% (n=227) | +0.4pt |
| Surface: Grass | 60.0% (n=35) | 57.1% (n=35) | -2.9pt |
| High Data Quality (≥65) | 54.7% (n=707) | 55.0% (n=857) | +0.3pt |
| Low Data Quality (<65) | 58.1% (n=2113) | 58.0% (n=1963) | -0.1pt |
| Picks that flipped away from the full-engine favorite | n/a | 46.0% (n=63) | -- |

### Serve & Return (Neutral, Review)
Overall: 57.3% → 56.4% (-0.9pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: WTA | 56.5% (n=248) | 56.9% (n=248) | +0.4pt |
| Tour: Challenger | 52.6% (n=576) | 51.0% (n=576) | -1.6pt |
| Tour: ITF | 58.9% (n=1710) | 58.1% (n=1710) | -0.8pt |
| Tour: ATP | 55.7% (n=255) | 54.5% (n=255) | -1.2pt |
| Tour: Junior | 74.1% (n=27) | 74.1% (n=27) | 0.0pt |
| Tour: Mixed Doubles | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Surface: Hard | 58.1% (n=1738) | 57.5% (n=1738) | -0.6pt |
| Surface: Clay | 56.0% (n=820) | 54.5% (n=820) | -1.5pt |
| Surface: IndoorHard | 55.5% (n=227) | 54.6% (n=227) | -0.9pt |
| Surface: Grass | 60.0% (n=35) | 57.1% (n=35) | -2.9pt |
| High Data Quality (≥65) | 54.7% (n=707) | 56.9% (n=705) | +2.2pt |
| Low Data Quality (<65) | 58.1% (n=2113) | 56.2% (n=2115) | -1.9pt |
| Picks that flipped away from the full-engine favorite | n/a | 42.2% (n=161) | -- |

### Recent Form (Neutral, Review)
Overall: 57.3% → 56.8% (-0.5pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: WTA | 56.5% (n=248) | 56.5% (n=248) | 0.0pt |
| Tour: Challenger | 52.6% (n=576) | 51.9% (n=576) | -0.7pt |
| Tour: ITF | 58.9% (n=1710) | 58.4% (n=1710) | -0.5pt |
| Tour: ATP | 55.7% (n=255) | 55.7% (n=255) | 0.0pt |
| Tour: Junior | 74.1% (n=27) | 74.1% (n=27) | 0.0pt |
| Tour: Mixed Doubles | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Surface: Hard | 58.1% (n=1738) | 57.5% (n=1738) | -0.6pt |
| Surface: Clay | 56.0% (n=820) | 55.5% (n=820) | -0.5pt |
| Surface: IndoorHard | 55.5% (n=227) | 55.9% (n=227) | +0.4pt |
| Surface: Grass | 60.0% (n=35) | 60.0% (n=35) | 0.0pt |
| High Data Quality (≥65) | 54.7% (n=707) | 53.1% (n=493) | -1.6pt |
| Low Data Quality (<65) | 58.1% (n=2113) | 57.6% (n=2327) | -0.5pt |
| Picks that flipped away from the full-engine favorite | n/a | 40.6% (n=69) | -- |

### Fatigue (Neutral, Review)
Overall: 57.3% → 57.3% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: WTA | 56.5% (n=248) | 56.5% (n=248) | 0.0pt |
| Tour: Challenger | 52.6% (n=576) | 52.6% (n=576) | 0.0pt |
| Tour: ITF | 58.9% (n=1710) | 58.9% (n=1710) | 0.0pt |
| Tour: ATP | 55.7% (n=255) | 55.7% (n=255) | 0.0pt |
| Tour: Junior | 74.1% (n=27) | 74.1% (n=27) | 0.0pt |
| Tour: Mixed Doubles | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Surface: Hard | 58.1% (n=1738) | 58.1% (n=1738) | 0.0pt |
| Surface: Clay | 56.0% (n=820) | 56.0% (n=820) | 0.0pt |
| Surface: IndoorHard | 55.5% (n=227) | 55.5% (n=227) | 0.0pt |
| Surface: Grass | 60.0% (n=35) | 60.0% (n=35) | 0.0pt |
| High Data Quality (≥65) | 54.7% (n=707) | 54.7% (n=707) | 0.0pt |
| Low Data Quality (<65) | 58.1% (n=2113) | 58.1% (n=2113) | 0.0pt |
| Picks that flipped away from the full-engine favorite | n/a | n/a (n=0) | -- |

### Availability (rest/travel/injury) (Neutral, Review)
Overall: 57.3% → 57.3% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: WTA | 56.5% (n=248) | 56.5% (n=248) | 0.0pt |
| Tour: Challenger | 52.6% (n=576) | 52.6% (n=576) | 0.0pt |
| Tour: ITF | 58.9% (n=1710) | 58.9% (n=1710) | 0.0pt |
| Tour: ATP | 55.7% (n=255) | 55.7% (n=255) | 0.0pt |
| Tour: Junior | 74.1% (n=27) | 74.1% (n=27) | 0.0pt |
| Tour: Mixed Doubles | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Surface: Hard | 58.1% (n=1738) | 58.1% (n=1738) | 0.0pt |
| Surface: Clay | 56.0% (n=820) | 56.0% (n=820) | 0.0pt |
| Surface: IndoorHard | 55.5% (n=227) | 55.5% (n=227) | 0.0pt |
| Surface: Grass | 60.0% (n=35) | 60.0% (n=35) | 0.0pt |
| High Data Quality (≥65) | 54.7% (n=707) | 54.7% (n=707) | 0.0pt |
| Low Data Quality (<65) | 58.1% (n=2113) | 58.1% (n=2113) | 0.0pt |
| Picks that flipped away from the full-engine favorite | n/a | n/a (n=0) | -- |

### Head-to-Head (Neutral, Review)
Overall: 57.3% → 57.2% (-0.1pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: WTA | 56.5% (n=248) | 56.5% (n=248) | 0.0pt |
| Tour: Challenger | 52.6% (n=576) | 52.6% (n=576) | 0.0pt |
| Tour: ITF | 58.9% (n=1710) | 58.8% (n=1710) | -0.1pt |
| Tour: ATP | 55.7% (n=255) | 55.3% (n=255) | -0.4pt |
| Tour: Junior | 74.1% (n=27) | 74.1% (n=27) | 0.0pt |
| Tour: Mixed Doubles | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Surface: Hard | 58.1% (n=1738) | 58.1% (n=1738) | 0.0pt |
| Surface: Clay | 56.0% (n=820) | 55.7% (n=820) | -0.3pt |
| Surface: IndoorHard | 55.5% (n=227) | 55.1% (n=227) | -0.4pt |
| Surface: Grass | 60.0% (n=35) | 60.0% (n=35) | 0.0pt |
| High Data Quality (≥65) | 54.7% (n=707) | 54.6% (n=707) | -0.1pt |
| Low Data Quality (<65) | 58.1% (n=2113) | 58.0% (n=2113) | -0.1pt |
| Picks that flipped away from the full-engine favorite | n/a | 20.0% (n=5) | -- |

### Match Load Recovery (Neutral, Review)
Overall: 57.3% → 57.3% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: WTA | 56.5% (n=248) | 57.7% (n=248) | +1.2pt |
| Tour: Challenger | 52.6% (n=576) | 52.8% (n=576) | +0.2pt |
| Tour: ITF | 58.9% (n=1710) | 58.8% (n=1710) | -0.1pt |
| Tour: ATP | 55.7% (n=255) | 55.7% (n=255) | 0.0pt |
| Tour: Junior | 74.1% (n=27) | 70.4% (n=27) | -3.7pt |
| Tour: Mixed Doubles | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Surface: Hard | 58.1% (n=1738) | 58.2% (n=1738) | +0.1pt |
| Surface: Clay | 56.0% (n=820) | 56.0% (n=820) | 0.0pt |
| Surface: IndoorHard | 55.5% (n=227) | 54.2% (n=227) | -1.3pt |
| Surface: Grass | 60.0% (n=35) | 65.7% (n=35) | +5.7pt |
| High Data Quality (≥65) | 54.7% (n=707) | 54.3% (n=668) | -0.4pt |
| Low Data Quality (<65) | 58.1% (n=2113) | 58.2% (n=2152) | +0.1pt |
| Picks that flipped away from the full-engine favorite | n/a | 50.6% (n=83) | -- |

### General Ensemble (Neutral, Review)
Overall: 57.3% → 57.3% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: WTA | 56.5% (n=248) | 56.5% (n=248) | 0.0pt |
| Tour: Challenger | 52.6% (n=576) | 52.6% (n=576) | 0.0pt |
| Tour: ITF | 58.9% (n=1710) | 58.9% (n=1710) | 0.0pt |
| Tour: ATP | 55.7% (n=255) | 55.7% (n=255) | 0.0pt |
| Tour: Junior | 74.1% (n=27) | 74.1% (n=27) | 0.0pt |
| Tour: Mixed Doubles | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Surface: Hard | 58.1% (n=1738) | 58.1% (n=1738) | 0.0pt |
| Surface: Clay | 56.0% (n=820) | 56.0% (n=820) | 0.0pt |
| Surface: IndoorHard | 55.5% (n=227) | 55.5% (n=227) | 0.0pt |
| Surface: Grass | 60.0% (n=35) | 60.0% (n=35) | 0.0pt |
| High Data Quality (≥65) | 54.7% (n=707) | 54.7% (n=707) | 0.0pt |
| Low Data Quality (<65) | 58.1% (n=2113) | 58.1% (n=2113) | 0.0pt |
| Picks that flipped away from the full-engine favorite | n/a | n/a (n=0) | -- |

### Active Segment Specialist (Neutral, Review)
Overall: 57.3% → 57.1% (-0.2pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: WTA | 56.5% (n=248) | 56.5% (n=248) | 0.0pt |
| Tour: Challenger | 52.6% (n=576) | 52.6% (n=576) | 0.0pt |
| Tour: ITF | 58.9% (n=1710) | 58.9% (n=1710) | 0.0pt |
| Tour: ATP | 55.7% (n=255) | 54.1% (n=255) | -1.6pt |
| Tour: Junior | 74.1% (n=27) | 74.1% (n=27) | 0.0pt |
| Tour: Mixed Doubles | 75.0% (n=4) | 75.0% (n=4) | 0.0pt |
| Surface: Hard | 58.1% (n=1738) | 58.1% (n=1738) | 0.0pt |
| Surface: Clay | 56.0% (n=820) | 55.5% (n=820) | -0.5pt |
| Surface: IndoorHard | 55.5% (n=227) | 55.5% (n=227) | 0.0pt |
| Surface: Grass | 60.0% (n=35) | 60.0% (n=35) | 0.0pt |
| High Data Quality (≥65) | 54.7% (n=707) | 54.6% (n=707) | -0.1pt |
| Low Data Quality (<65) | 58.1% (n=2113) | 58.0% (n=2113) | -0.1pt |
| Picks that flipped away from the full-engine favorite | n/a | 25.0% (n=8) | -- |

## Multi-model combinations

| Combination | Overall accuracy | n |
|---|---|---|
| Everything active | 57.3% | 2820 |
| Core signals only (Surface Elo, Serve & Return, Recent Form) | 57.2% | 2820 |
| Segment specialists off | 57.1% | 2820 |
| General calibration + specialists off (raw ensemble only) | 57.1% | 2820 |

**Best overall win rate:** Everything active (57.3%)
**Worst overall win rate:** General calibration + specialists off (raw ensemble only) (57.1%)

## Diagnostic questions

### Which model's vote most often coincides with a losing final prediction?
| Model | n (losses where this model voted) | Coincided with the losing pick |
|---|---|---|
| General Ensemble | 1205 | 99.8% |
| Serve & Return | 1205 | 94.4% |
| Active Segment Specialist | 185 | 87.0% |
| Recent Form | 1205 | 75.2% |
| Surface Elo | 1205 | 69.1% |
| Match Load Recovery | 1205 | 54.3% |
| Head-to-Head | 1205 | 48.9% |
| Fatigue | 0 | n/a |
| Availability (rest/travel/injury) | 0 | n/a |

### Which model is most often wrong specifically when it strongly favors a player (≥65% confidence)?
| Model | n (strong votes) | Favored player actually lost |
|---|---|---|
| Match Load Recovery | 1204 | 47.1% |
| Surface Elo | 109 | 38.5% |
| Serve & Return | 992 | 36.6% |
| Active Segment Specialist | 96 | 35.4% |
| Head-to-Head | 133 | 34.6% |
| General Ensemble | 30 | 26.7% |
| Recent Form | 1 | 0.0% |
| Fatigue | 0 | n/a |
| Availability (rest/travel/injury) | 0 | n/a |

### Which model's confidence is systematically miscalibrated relative to its real hit rate?
| Model | n | Avg. stated confidence | Observed hit rate | Overconfidence |
|---|---|---|---|---|
| Match Load Recovery | 2820 | 58.4% | 51.7% | +6.7pt |
| Active Segment Specialist | 426 | 61.1% | 56.1% | +5.0pt |
| Serve & Return | 2820 | 61.5% | 57.0% | +4.5pt |
| Head-to-Head | 2820 | 52.2% | 52.1% | +0.1pt |
| General Ensemble | 2820 | 55.6% | 57.1% | -1.5pt |
| Recent Form | 2820 | 52.4% | 54.8% | -2.4pt |
| Surface Elo | 2810 | 53.6% | 56.8% | -3.2pt |
| Fatigue | 0 | n/a | n/a | n/a |
| Availability (rest/travel/injury) | 0 | n/a | n/a | n/a |

_Positive overconfidence means the model states more confidence than its real hit rate supports._

### Which model most often disagrees with the final blended prediction, and how often would that dissent have been correct?
| Model | Dissent rate (of all matches) | n dissents | Dissent would have been correct |
|---|---|---|---|
| Surface Elo | 18.9% | 755 | 49.3% |
| Active Segment Specialist | 1.2% | 50 | 48.0% |
| Serve & Return | 3.5% | 141 | 47.5% |
| Recent Form | 16.7% | 669 | 44.7% |
| Head-to-Head | 34.4% | 1378 | 44.7% |
| Match Load Recovery | 31.5% | 1260 | 43.7% |
| General Ensemble | 0.2% | 8 | 25.0% |
| Fatigue | 0.0% | 0 | n/a |
| Availability (rest/travel/injury) | 0.0% | 0 | n/a |
