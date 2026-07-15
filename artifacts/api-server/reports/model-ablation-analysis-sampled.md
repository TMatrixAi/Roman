# Model Ablation Analysis for the Prediction Engine

Generated 2026-07-15T00:38:11.865Z against 4,000 real, graded historical matches.

## Caveats
- This run scored a REPRESENTATIVE SAMPLE of 4000 matches (requested 4000), stratified proportionally by surface and calendar year, out of 130304 eligible matches in the full corpus -- not the full corpus. Match-history/Elo context was still built from the full corpus, so each sampled match's reconstructed history is accurate; only which matches were SCORED was reduced.
- This report replays the historical backtest corpus (frozen pre-match snapshots, no hindsight leakage) through the exact live ensemble engine, using the CURRENTLY ACTIVE calibration and segment-specialist models. Those were themselves fit on walk-forward folds of this same corpus, so this is a diagnostic on the current production configuration, not a fresh out-of-sample benchmark.
- "Active Segment Specialist" ablation only changes matches whose tour/surface is an actual candidate segment (ATP/WTA on Hard/Clay/Grass/IndoorHard) with an active specialist that has cleared its data threshold -- it is a true no-op on every other match, which is expected, not a bug.
- "Favorite vs. underdog" segments compare each variant's own pick against the BASELINE (full-engine) run's pick for the same match -- there is no independent market-odds favorite in this historical corpus, so the full engine's own pick is used as the reference favorite.
- No engine code, weights, or active models were changed by generating this report -- it is evidence and recommendations only.

## Baseline (everything active)
Overall accuracy: **61.6%** (n=3191)

## Leave-one-out ranking (Most Valuable → Harmful)

| Model | Baseline acc. | With model removed | Δ (removed − baseline) | Rank | Recommendation |
|---|---|---|---|---|---|
| Surface Elo | 61.6% | 61.0% | -0.6pt | Neutral | Review |
| Serve & Return | 61.6% | 62.5% | +0.9pt | Neutral | Review |
| Recent Form | 61.6% | 61.8% | +0.2pt | Neutral | Review |
| Fatigue | 61.6% | 61.6% | 0.0pt | Neutral | Review |
| Availability (rest/travel/injury) | 61.6% | 61.6% | 0.0pt | Neutral | Review |
| Head-to-Head | 61.6% | 61.6% | 0.0pt | Neutral | Review |
| Match Load Recovery | 61.6% | 61.6% | 0.0pt | Neutral | Review |
| General Ensemble | 61.6% | 61.6% | 0.0pt | Neutral | Review |
| Active Segment Specialist | 61.6% | 61.6% | 0.0pt | Neutral | Review |

_Reading this table: a **negative** delta means removing the model made accuracy WORSE -- the model is earning its place. A **positive** delta means removing it made accuracy BETTER -- the model may be actively hurting predictions._

## Leave-one-out detail by segment

### Surface Elo (Neutral, Review)
Overall: 61.6% → 61.0% (-0.6pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 59.1% (n=702) | 57.7% (n=702) | -1.4pt |
| Tour: WTA | 59.1% (n=215) | 57.2% (n=215) | -1.9pt |
| Tour: ATP | 58.0% (n=231) | 57.1% (n=231) | -0.9pt |
| Tour: ITF | 63.1% (n=2007) | 62.9% (n=2007) | -0.2pt |
| Tour: Junior | 66.7% (n=33) | 66.7% (n=33) | 0.0pt |
| Tour: Mixed Doubles | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Tour: Exhibition | 100.0% (n=1) | 100.0% (n=1) | 0.0pt |
| Surface: Hard | 62.4% (n=1562) | 61.8% (n=1562) | -0.6pt |
| Surface: IndoorHard | 61.4% (n=140) | 60.7% (n=140) | -0.7pt |
| Surface: Clay | 61.2% (n=1370) | 60.4% (n=1370) | -0.8pt |
| Surface: Grass | 56.3% (n=119) | 56.3% (n=119) | 0.0pt |
| High Data Quality (≥65) | 62.5% (n=1987) | 62.1% (n=2123) | -0.4pt |
| Low Data Quality (<65) | 60.1% (n=1204) | 58.8% (n=1068) | -1.3pt |
| Picks that flipped away from the full-engine favorite | n/a | 28.3% (n=46) | -- |

### Serve & Return (Neutral, Review)
Overall: 61.6% → 62.5% (+0.9pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 59.1% (n=702) | 60.5% (n=702) | +1.4pt |
| Tour: WTA | 59.1% (n=215) | 60.5% (n=215) | +1.4pt |
| Tour: ATP | 58.0% (n=231) | 58.4% (n=231) | +0.4pt |
| Tour: ITF | 63.1% (n=2007) | 63.8% (n=2007) | +0.7pt |
| Tour: Junior | 66.7% (n=33) | 69.7% (n=33) | +3.0pt |
| Tour: Mixed Doubles | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Tour: Exhibition | 100.0% (n=1) | 100.0% (n=1) | 0.0pt |
| Surface: Hard | 62.4% (n=1562) | 63.4% (n=1562) | +1.0pt |
| Surface: IndoorHard | 61.4% (n=140) | 64.3% (n=140) | +2.9pt |
| Surface: Clay | 61.2% (n=1370) | 61.8% (n=1370) | +0.6pt |
| Surface: Grass | 56.3% (n=119) | 57.1% (n=119) | +0.8pt |
| High Data Quality (≥65) | 62.5% (n=1987) | 64.6% (n=2004) | +2.1pt |
| Low Data Quality (<65) | 60.1% (n=1204) | 59.1% (n=1187) | -1.0pt |
| Picks that flipped away from the full-engine favorite | n/a | 59.6% (n=151) | -- |

### Recent Form (Neutral, Review)
Overall: 61.6% → 61.8% (+0.2pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 59.1% (n=702) | 59.0% (n=702) | -0.1pt |
| Tour: WTA | 59.1% (n=215) | 60.5% (n=215) | +1.4pt |
| Tour: ATP | 58.0% (n=231) | 58.4% (n=231) | +0.4pt |
| Tour: ITF | 63.1% (n=2007) | 63.2% (n=2007) | +0.1pt |
| Tour: Junior | 66.7% (n=33) | 66.7% (n=33) | 0.0pt |
| Tour: Mixed Doubles | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Tour: Exhibition | 100.0% (n=1) | 100.0% (n=1) | 0.0pt |
| Surface: Hard | 62.4% (n=1562) | 62.7% (n=1562) | +0.3pt |
| Surface: IndoorHard | 61.4% (n=140) | 61.4% (n=140) | 0.0pt |
| Surface: Clay | 61.2% (n=1370) | 61.3% (n=1370) | +0.1pt |
| Surface: Grass | 56.3% (n=119) | 55.5% (n=119) | -0.8pt |
| High Data Quality (≥65) | 62.5% (n=1987) | 62.7% (n=1769) | +0.2pt |
| Low Data Quality (<65) | 60.1% (n=1204) | 60.6% (n=1422) | +0.5pt |
| Picks that flipped away from the full-engine favorite | n/a | 59.3% (n=27) | -- |

### Fatigue (Neutral, Review)
Overall: 61.6% → 61.6% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 59.1% (n=702) | 59.1% (n=702) | 0.0pt |
| Tour: WTA | 59.1% (n=215) | 59.1% (n=215) | 0.0pt |
| Tour: ATP | 58.0% (n=231) | 58.0% (n=231) | 0.0pt |
| Tour: ITF | 63.1% (n=2007) | 63.1% (n=2007) | 0.0pt |
| Tour: Junior | 66.7% (n=33) | 66.7% (n=33) | 0.0pt |
| Tour: Mixed Doubles | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Tour: Exhibition | 100.0% (n=1) | 100.0% (n=1) | 0.0pt |
| Surface: Hard | 62.4% (n=1562) | 62.4% (n=1562) | 0.0pt |
| Surface: IndoorHard | 61.4% (n=140) | 61.4% (n=140) | 0.0pt |
| Surface: Clay | 61.2% (n=1370) | 61.2% (n=1370) | 0.0pt |
| Surface: Grass | 56.3% (n=119) | 56.3% (n=119) | 0.0pt |
| High Data Quality (≥65) | 62.5% (n=1987) | 62.3% (n=1970) | -0.2pt |
| Low Data Quality (<65) | 60.1% (n=1204) | 60.4% (n=1221) | +0.3pt |
| Picks that flipped away from the full-engine favorite | n/a | n/a (n=0) | -- |

### Availability (rest/travel/injury) (Neutral, Review)
Overall: 61.6% → 61.6% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 59.1% (n=702) | 59.1% (n=702) | 0.0pt |
| Tour: WTA | 59.1% (n=215) | 59.1% (n=215) | 0.0pt |
| Tour: ATP | 58.0% (n=231) | 58.0% (n=231) | 0.0pt |
| Tour: ITF | 63.1% (n=2007) | 63.1% (n=2007) | 0.0pt |
| Tour: Junior | 66.7% (n=33) | 66.7% (n=33) | 0.0pt |
| Tour: Mixed Doubles | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Tour: Exhibition | 100.0% (n=1) | 100.0% (n=1) | 0.0pt |
| Surface: Hard | 62.4% (n=1562) | 62.4% (n=1562) | 0.0pt |
| Surface: IndoorHard | 61.4% (n=140) | 61.4% (n=140) | 0.0pt |
| Surface: Clay | 61.2% (n=1370) | 61.2% (n=1370) | 0.0pt |
| Surface: Grass | 56.3% (n=119) | 56.3% (n=119) | 0.0pt |
| High Data Quality (≥65) | 62.5% (n=1987) | 62.7% (n=1905) | +0.2pt |
| Low Data Quality (<65) | 60.1% (n=1204) | 60.0% (n=1286) | -0.1pt |
| Picks that flipped away from the full-engine favorite | n/a | n/a (n=0) | -- |

### Head-to-Head (Neutral, Review)
Overall: 61.6% → 61.6% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 59.1% (n=702) | 59.1% (n=702) | 0.0pt |
| Tour: WTA | 59.1% (n=215) | 59.5% (n=215) | +0.4pt |
| Tour: ATP | 58.0% (n=231) | 57.6% (n=231) | -0.4pt |
| Tour: ITF | 63.1% (n=2007) | 63.1% (n=2007) | 0.0pt |
| Tour: Junior | 66.7% (n=33) | 66.7% (n=33) | 0.0pt |
| Tour: Mixed Doubles | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Tour: Exhibition | 100.0% (n=1) | 100.0% (n=1) | 0.0pt |
| Surface: Hard | 62.4% (n=1562) | 62.4% (n=1562) | 0.0pt |
| Surface: IndoorHard | 61.4% (n=140) | 62.1% (n=140) | +0.7pt |
| Surface: Clay | 61.2% (n=1370) | 61.2% (n=1370) | 0.0pt |
| Surface: Grass | 56.3% (n=119) | 56.3% (n=119) | 0.0pt |
| High Data Quality (≥65) | 62.5% (n=1987) | 62.6% (n=1987) | +0.1pt |
| Low Data Quality (<65) | 60.1% (n=1204) | 60.1% (n=1204) | 0.0pt |
| Picks that flipped away from the full-engine favorite | n/a | 66.7% (n=3) | -- |

### Match Load Recovery (Neutral, Review)
Overall: 61.6% → 61.6% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 59.1% (n=702) | 59.1% (n=702) | 0.0pt |
| Tour: WTA | 59.1% (n=215) | 59.1% (n=215) | 0.0pt |
| Tour: ATP | 58.0% (n=231) | 58.0% (n=231) | 0.0pt |
| Tour: ITF | 63.1% (n=2007) | 63.1% (n=2007) | 0.0pt |
| Tour: Junior | 66.7% (n=33) | 66.7% (n=33) | 0.0pt |
| Tour: Mixed Doubles | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Tour: Exhibition | 100.0% (n=1) | 100.0% (n=1) | 0.0pt |
| Surface: Hard | 62.4% (n=1562) | 62.4% (n=1562) | 0.0pt |
| Surface: IndoorHard | 61.4% (n=140) | 61.4% (n=140) | 0.0pt |
| Surface: Clay | 61.2% (n=1370) | 61.2% (n=1370) | 0.0pt |
| Surface: Grass | 56.3% (n=119) | 56.3% (n=119) | 0.0pt |
| High Data Quality (≥65) | 62.5% (n=1987) | 62.4% (n=1976) | -0.1pt |
| Low Data Quality (<65) | 60.1% (n=1204) | 60.2% (n=1215) | +0.1pt |
| Picks that flipped away from the full-engine favorite | n/a | n/a (n=0) | -- |

### General Ensemble (Neutral, Review)
Overall: 61.6% → 61.6% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 59.1% (n=702) | 59.1% (n=702) | 0.0pt |
| Tour: WTA | 59.1% (n=215) | 59.1% (n=215) | 0.0pt |
| Tour: ATP | 58.0% (n=231) | 58.0% (n=231) | 0.0pt |
| Tour: ITF | 63.1% (n=2007) | 63.1% (n=2007) | 0.0pt |
| Tour: Junior | 66.7% (n=33) | 66.7% (n=33) | 0.0pt |
| Tour: Mixed Doubles | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Tour: Exhibition | 100.0% (n=1) | 100.0% (n=1) | 0.0pt |
| Surface: Hard | 62.4% (n=1562) | 62.4% (n=1562) | 0.0pt |
| Surface: IndoorHard | 61.4% (n=140) | 61.4% (n=140) | 0.0pt |
| Surface: Clay | 61.2% (n=1370) | 61.2% (n=1370) | 0.0pt |
| Surface: Grass | 56.3% (n=119) | 56.3% (n=119) | 0.0pt |
| High Data Quality (≥65) | 62.5% (n=1987) | 62.5% (n=1987) | 0.0pt |
| Low Data Quality (<65) | 60.1% (n=1204) | 60.1% (n=1204) | 0.0pt |
| Picks that flipped away from the full-engine favorite | n/a | n/a (n=0) | -- |

### Active Segment Specialist (Neutral, Review)
Overall: 61.6% → 61.6% (0.0pt)

| Segment | Baseline acc. | Ablated acc. | Δ |
|---|---|---|---|
| Tour: Challenger | 59.1% (n=702) | 59.1% (n=702) | 0.0pt |
| Tour: WTA | 59.1% (n=215) | 59.1% (n=215) | 0.0pt |
| Tour: ATP | 58.0% (n=231) | 58.0% (n=231) | 0.0pt |
| Tour: ITF | 63.1% (n=2007) | 63.1% (n=2007) | 0.0pt |
| Tour: Junior | 66.7% (n=33) | 66.7% (n=33) | 0.0pt |
| Tour: Mixed Doubles | 50.0% (n=2) | 50.0% (n=2) | 0.0pt |
| Tour: Exhibition | 100.0% (n=1) | 100.0% (n=1) | 0.0pt |
| Surface: Hard | 62.4% (n=1562) | 62.4% (n=1562) | 0.0pt |
| Surface: IndoorHard | 61.4% (n=140) | 61.4% (n=140) | 0.0pt |
| Surface: Clay | 61.2% (n=1370) | 61.2% (n=1370) | 0.0pt |
| Surface: Grass | 56.3% (n=119) | 56.3% (n=119) | 0.0pt |
| High Data Quality (≥65) | 62.5% (n=1987) | 62.5% (n=1987) | 0.0pt |
| Low Data Quality (<65) | 60.1% (n=1204) | 60.1% (n=1204) | 0.0pt |
| Picks that flipped away from the full-engine favorite | n/a | n/a (n=0) | -- |

## Multi-model combinations

| Combination | Overall accuracy | n |
|---|---|---|
| Everything active | 61.6% | 3191 |
| Core signals only (Surface Elo, Serve & Return, Recent Form) | 61.6% | 3191 |
| Segment specialists off | 61.6% | 3191 |
| General calibration + specialists off (raw ensemble only) | 61.6% | 3191 |

**Best overall win rate:** Everything active (61.6%)
**Worst overall win rate:** General calibration + specialists off (raw ensemble only) (61.6%)

## Diagnostic questions

### Which model's vote most often coincides with a losing final prediction?
| Model | n (losses where this model voted) | Coincided with the losing pick |
|---|---|---|
| General Ensemble | 1225 | 100.0% |
| Serve & Return | 1225 | 96.2% |
| Recent Form | 1225 | 70.3% |
| Surface Elo | 1225 | 65.6% |
| Head-to-Head | 1225 | 48.2% |
| Fatigue | 0 | n/a |
| Availability (rest/travel/injury) | 0 | n/a |
| Match Load Recovery | 0 | n/a |
| Active Segment Specialist | 0 | n/a |

### Which model is most often wrong specifically when it strongly favors a player (≥65% confidence)?
| Model | n (strong votes) | Favored player actually lost |
|---|---|---|
| Head-to-Head | 305 | 35.1% |
| Serve & Return | 888 | 31.4% |
| Surface Elo | 221 | 29.0% |
| General Ensemble | 474 | 26.8% |
| Recent Form | 0 | n/a |
| Fatigue | 0 | n/a |
| Availability (rest/travel/injury) | 0 | n/a |
| Match Load Recovery | 0 | n/a |
| Active Segment Specialist | 0 | n/a |

### Which model's confidence is systematically miscalibrated relative to its real hit rate?
| Model | n | Avg. stated confidence | Observed hit rate | Overconfidence |
|---|---|---|---|---|
| Head-to-Head | 3185 | 54.4% | 52.3% | +2.1pt |
| Serve & Return | 3191 | 60.3% | 60.8% | -0.5pt |
| General Ensemble | 3183 | 59.2% | 61.5% | -2.3pt |
| Surface Elo | 3191 | 55.5% | 61.7% | -6.2pt |
| Recent Form | 3178 | 51.8% | 58.2% | -6.4pt |
| Fatigue | 0 | n/a | n/a | n/a |
| Availability (rest/travel/injury) | 0 | n/a | n/a | n/a |
| Match Load Recovery | 0 | n/a | n/a | n/a |
| Active Segment Specialist | 0 | n/a | n/a | n/a |

_Positive overconfidence means the model states more confidence than its real hit rate supports._

### Which model most often disagrees with the final blended prediction, and how often would that dissent have been correct?
| Model | Dissent rate (of all matches) | n dissents | Dissent would have been correct |
|---|---|---|---|
| Surface Elo | 21.0% | 840 | 50.1% |
| Recent Form | 20.9% | 836 | 43.5% |
| Head-to-Head | 39.1% | 1565 | 40.5% |
| Serve & Return | 3.0% | 119 | 39.5% |
| Fatigue | 0.0% | 0 | n/a |
| Availability (rest/travel/injury) | 0.0% | 0 | n/a |
| Match Load Recovery | 0.0% | 0 | n/a |
| General Ensemble | 0.0% | 0 | n/a |
| Active Segment Specialist | 0.0% | 0 | n/a |
