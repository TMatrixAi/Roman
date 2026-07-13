# Why the Monte Carlo simulator and the card's ensemble probability can disagree sharply

Investigated 2026-07-13, before any consideration of letting the simulator vote. The simulator is
currently display-only (see `resolveSimulatorAdoption` in `simulatorValidation.ts`); this document
explains WHY its number can land far from, and even on the opposite side of, the card's final
probability -- so a future decision to enable voting is made with eyes open, not surprised by
disagreements that are structural, not bugs.

## Reproduced case: prediction id 90 (A. Panagiotidou vs A. Kulikova, WTA, Hard)

- Card's final probability (`calibratedProbability`): **80.4%** for Panagiotidou (player1).
- Monte Carlo simulator (`engine.simulation.player1WinProbability`): **40.9%** -- favors the
  *other* player, and with a wide, honestly-flagged uncertainty range (5-86%, `inputReliability: 5`).
- Surface Elo alone: 42.9% (agrees with the simulator's direction).
- Serve/Return ratings: 50 vs 52, essentially even (mild lean toward Kulikova, agrees with the simulator).

So on the two signals the simulator actually sees, the two systems roughly agree (~41-43% either
way). The 40-point swing comes entirely from signals the simulator structurally cannot see:

- **Fatigue**: 95.6% for Panagiotidou, at ensemble weight **0.583** (the largest weight of any
  module in this prediction) because its measured reliability (70) vastly outranked Surface Elo's
  and Serve & Return's reliability of **5** each (player1 had zero recorded matches at all, let
  alone on this surface).
- **Segment Specialist (WTA — Hard)**: 90.3% at weight 0.528 (`specialistApplied: true`), which
  further pulls the ensemble toward Panagiotidou.
- **General Model**: 69.3% at weight 0.472, same direction again.

A second, independently-confirmed example (prediction id 244, R. Saigo vs N. Eto): the ensemble
gave 58.8% (moderate), the simulator gave 89.9% (strong) -- the opposite failure mode. There,
Serve & Return scored 98.5% at weight 0.22 (reliability 65) and Recent Form scored 81.1% at weight
0.339 (reliability 100), both far more confident and far more heavily weighted than Surface Elo's
64.2% at weight 0.017 (reliability only 5). Again, the simulator's two inputs alone don't carry the
same story the full ensemble tells.

## Root cause #1 -- the simulator sees a strict subset of the ensemble's signals, by design

`deriveServicePointEstimate` (`simulator.ts`) computes its per-player service-point probability
from exactly two module outputs: Surface Elo's `eloWinProbabilityPlayer1` and the Serve & Return
proxy ratings. It never looks at Recent Form, Fatigue, Availability, Head-to-Head, or the
Segment Specialist / General Model blend -- all of which the ensemble (`runPredictionEngine` /
`buildEnsemble`) weighs by measured reliability. This is documented as intentional in the module's
own header comment ("the two signals that ARE real"), not an oversight.

The practical consequence: whenever a match's Surface Elo and Serve & Return reliability are
*low* relative to Fatigue's, Recent Form's, or the Specialist's reliability (which happens
routinely for players with thin surface-specific history but a decent recent schedule/record --
exactly the profile of both reproduced cases above), the ensemble's vote is dominated by signals
the simulator cannot see at all. A large, even opposite-direction, disagreement is the *expected*
outcome of that reliability-weighted architecture, not evidence of a defect in either system.

## Root cause #2 -- even on the two shared signals, the two systems transform them differently

The ensemble converts a module's raw "edge" into a probability via a single shared logistic,
`edgeToProbability` (`ensemble.ts`): `1 / (1 + exp(-edge/12))`, with Surface Elo's edge being
`eloDifference / 8` and Serve & Return's edge being the raw sum of rating differences (no extra
damping). That logistic is tuned to translate module confidence into a *match-win* probability,
and can swing to very confident territory (e.g. 98.5% in the case above) from what looks like a
modest rating gap once reliability-weighted through to the final vote.

The simulator instead converts the *same* Surface Elo and Serve & Return outputs into a
*single-point*-win probability via a deliberately heavy compression (`simulator.ts`,
`deriveServicePointEstimate`): the Elo edge is divided by 8 again after already being converted
from probability space (`(eloWinProbabilityPlayer1/100 - 0.5)/8`), and the serve rating gap is
scaled by `/10/100*1.5` -- because real tennis service-point win rates cluster tightly around 55-70%
even between very mismatched players, and match-level point-by-point simulation is what's supposed
to *produce* the large match-probability swings from small, realistic per-point edges, not have
them pre-baked into its point-probability inputs. So even restricted to the two shared signals,
the two systems are not mathematically equivalent, and a moderate rating gap can imply a much more
confident match probability through the ensemble's direct logistic than through the simulator's
point-by-point compression-then-simulation path.

## Conclusion

The disagreement is not a bug in either the ensemble or the simulator. It is the combined effect
of (1) the simulator's deliberately narrow input scope (2 of ~7 ensemble signals) combined with
reliability-weighting that can let the *other* 5 signals dominate the ensemble's vote when Surface
Elo/Serve & Return are thin, and (2) different, independently-reasonable edge-to-probability
transforms applied to the shared signals themselves. Both are legitimate, separately-justified
design choices; neither was fabricated or miscalibrated by accident.

This means: before the simulator is ever allowed to vote, its narrow input scope needs to be an
explicit part of that decision (e.g. should voting weight be reduced further, or scoped only to
matches where Surface Elo/Serve & Return reliability is *not* dominated by other signals?) rather
than assumed away. No change to the simulator's or ensemble's math was made as part of this
investigation -- see `simulatorValidation.ts` for how adoption is currently (and will continue to
be) gated purely on measured logLoss performance, independent of this scope difference.
