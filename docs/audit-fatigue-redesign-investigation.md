# Fatigue redesign investigation (Task #91)

**Date:** 2026-07-14
**Trigger:** Task #89 found the existing Fatigue module's 3/7/14-day recency-weighted match-COUNT
windows are a mislabeled, inverted proxy for tournament-survivorship/winning-momentum, not
physical tiredness (see `docs/audit-fatigue-window-logic-investigation.md`), and was permanently
excluded from the ensemble. This task investigates whether a structurally different fatigue
signal — one that measures genuine per-match physical load instead of recency-weighted match
count — can be built and validated well enough to replace it.

## Why match count is the wrong shape of signal

The old Fatigue module's core confound: a player who has played *more* matches in the last 3/7/14
days is, overwhelmingly, a player who keeps *winning* and advancing through a draw — not a player
accumulating physical tiredness independent of outcome. Any signal built the same way (counting
matches, or summing total games/load over a window) inherits the same confound, because more
matches played always means more total load, which is still tied to survivorship.

This investigation instead tests signals built from a player's **single most recent prior match**
only — never a window count — on the theory that "how much rest did you get, and did your last
match go the distance" is a real, acute physical-load mechanism that can occur regardless of
whether the player is on a winning or losing run.

## Methodology

Per Task #91's scope, this used a standalone analysis script
(`src/scripts/analyzeFatigueRecoveryCandidates.ts`) against the full historical corpus (18,640
matches, 17,482 after filtering to clean/determinate/surface-known results), reconstructing each
player's leak-proof prior match history with `reconstructPlayerMatchHistory` (the same
`cutoffAt`-bounded builder real walk-forward backtests use) — **not** a re-run of the destructive
`runWalkForwardEvaluation` pipeline, which wipes and refits the live calibration model as a side
effect and isn't needed to measure a standalone candidate's own directional accuracy against real
recorded outcomes.

- **As-of-date discipline**: every candidate is computed against each match's own frozen
  `cutoffAt`, never `Date.now()` — the same fix already applied to the live Fatigue module.
- **Decorrelation check**: each candidate's "more at-risk" pick is compared against an
  independently, freshly computed Recent Form value (`computeRecentFormModule`, not reused from
  any stored run) for the same two players. **≥55% directional agreement is a rejection signal**
  (redundant with an existing module), matching Task #89's own methodology.
  Total-agreement sample per candidate is well above the 200-sample floor (3,126–6,197 matches).
- **Accuracy check**: "meaningfully above coin-flip" is judged as statistically significant
  above 50% given the segment's sample size (z-test on a binomial proportion), not just numerically
  above 50%. Any segment below 200 matches is reported as inconclusive rather than decision-grade.
- Because none of these candidates are wired into the live ensemble, there's no real calibration
  band to segment by; segments here are by candidate score-gap magnitude and by surface instead
  (the same secondary breakdown Task #89's audit used).

### Data quirk found and fixed during this investigation

`MatchRecord.setGameMargins` (and the underlying `historical_matches.game_margins_player1`
column) is a **fixed-length 5-slot array**, with unplayed trailing sets padded as
`{playerGames: 0, opponentGames: 0}` — not trimmed to the real set count. A naive
`setGameMargins.length` check for "how many sets were played" is always 5 regardless of the real
match length. Both `matchLoadRecovery.ts` and the analysis script count only sets with at least
one game won by either side (`realSetsPlayed`) — worth flagging for any future module reading
`setGameMargins`.

## Candidates tested

Implemented in `src/services/predictionEngine/matchLoadRecovery.ts`
(`computeMatchLoadRecoveryModule`), not wired into the live ensemble.

| # | Candidate | Description |
|---|---|---|
| A | Rest-days-only | Score from days since the player's single most recent prior match (short rest = higher risk); ignores whether that match went the distance. |
| B | Went-distance-only | Score is a flat +20 if the most recent match went the distance (3+ real sets in a BestOf3, 4+ in a BestOf5), 0 otherwise; ignores rest days entirely. |
| C | Combined | A + B added together (rest-days penalty, plus +20 if that match also went the distance). |

## Results

### Candidate A: rest-days-only — REJECTED

- Overall accuracy predicting the *lower*-risk (more-rested) player wins: **49.71%** (n=3,766) —
  not meaningfully above coin-flip; if anything on the wrong side.
- Directional agreement with independently-computed Recent Form: **60.59%** (n=3,126) — **above
  the 55% high-overlap threshold.**
- **Verdict:** rejected on both bars. Rest days since a player's last match is, itself, still
  largely a function of how far they've advanced in the current event (a first-round loser has
  had a long rest; a player who just won a tight match yesterday is, on average, winning and
  advancing) — the same tournament-survivorship confound Task #89 found in the old module, just
  measured a different way. This is an important negative result: naive "recency since last
  match" alone does **not** escape the confound that sank the original Fatigue module.

### Candidate B: went-distance-only — VALIDATES

- Overall accuracy: **52.54%** (n=5,411). z = 3.74 vs. 50% baseline (p ≈ 0.0002) — statistically
  significant given the sample size.
- By surface (all segments ≥200 except Grass, which stays inconclusive):
  - Hard: 51.95% (n=3,334), z=2.25, significant
  - Clay: 52.67% (n=1,555), z=2.11, significant
  - IndoorHard: 55.92% (n=456), z=2.53, significant
  - Grass: 56.06% (n=66) — **inconclusive, n<200**
- Directional agreement with independently-computed Recent Form: **49.14%** (n=4,558) — **well
  below the 55% high-overlap threshold.** This is the key result: whether a player's last match
  went the distance is essentially uncorrelated with whether they're on a form hot streak, unlike
  match-count-based signals.
- **Verdict:** clears both bars. A real, decorrelated, if modest, signal — a player whose most
  recent match went the distance is measurably more likely to lose their next match, independent
  of their recent form.

### Candidate C: combined (A + B) — not adopted

- Overall accuracy: **51.73%** (n=7,383), z=2.97, significant, but weaker than B alone in
  aggregate and every mid-range gap bucket.
- Directional agreement with Recent Form: **54.80%** (n=6,197) — just under the 55% threshold, but
  close enough to call it a borderline case, consistent with rest-days (A) pulling the combined
  signal back toward the redundant-with-Recent-Form territory it lives in on its own.
- Its only advantage over B alone is in the widest-gap tail (54.5–54.9% at gap≥30/40), which is
  driven by the same large-rest-day cases Candidate A itself showed are unreliable.
- **Verdict:** not adopted. Blending in the rejected rest-days component doesn't improve on the
  simpler, cleaner Candidate B, and pushes overlap with Recent Form uncomfortably close to the
  rejection threshold.

## Decision

**Candidate B (went-distance-only) is the surviving, validated design.** It has been implemented
as `computeMatchLoadRecoveryModule` in `src/services/predictionEngine/matchLoadRecovery.ts`, with
its score formula restricted to this validated signal alone (rest days are still computed and
returned for transparency, but no longer feed the risk score, since Candidate A independently
showed that component is redundant/wrong).

The module is **not yet wired into the live ensemble, Data Quality blend, or any UI surface** —
this task's scope is the investigation, candidate build, and validated recommendation. Actually
enabling it live is a separate, deliberate decision (same pattern as Availability's rework, which
was validated first and flipped live in its own follow-up).

### Proposed ensemble inclusion, if/when adopted

Proposed constants (not yet applied to `dataQuality.ts`):

```
MODULE_IMPORTANCE.matchLoadRecovery = 0.4       // fixed reliability=70, thin single-bit signal -- same tier as headToHead
ENSEMBLE_WEIGHT_PRIOR.matchLoadRecovery = 0.3   // below headToHead (0.4) -- weakest validated signal, newly introduced
```

**Renormalization impact statement.** Ensemble voting weight is `reliability * weightPrior`,
normalized across all active (non-excluded) modules. Currently active weight priors: Surface Elo
1.5, Serve & Return 1.5, Recent Form 1.3, Head-to-Head 0.4 (Fatigue and Availability excluded) —
prior total 4.7. Adding `matchLoadRecovery` at 0.3 brings the total to 5.0. Assuming each
module's own reliability stays roughly unchanged, each existing module's *effective share* of the
ensemble vote would shift as follows:

| Module | Share before (of 4.7) | Share after (of 5.0) | Change |
|---|---|---|---|
| Surface Elo | 31.9% | 30.0% | −1.9pp |
| Serve & Return | 31.9% | 30.0% | −1.9pp |
| Recent Form | 27.7% | 26.0% | −1.7pp |
| Head-to-Head | 8.5% | 8.0% | −0.5pp |
| Match Load Recovery (new) | — | 6.0% | +6.0% |

This is a small, evenly-distributed dilution of every existing module's vote, proportional to its
current share — no single existing module absorbs a disproportionate cut. Given the modest but
real effect size measured above (2–6pp above coin-flip depending on surface), this weight sits
appropriately below Head-to-Head's, matching the precedent that new/thin signals start low and
only earn more weight after a real live ablation re-validation (the same bar Availability was
held to).

**Outcome (2026-07-14, Task #96):** the live ablation re-validation gated on above was run
(4,001-match representative sample) and found removing `matchLoadRecovery` from the ensemble vote
moves overall accuracy by exactly 0.0pp -- it does not clear the bar to vote. The renormalization
table above was never applied to the live ensemble; `matchLoadRecovery` remains computed/displayed
but excluded from voting. See `docs/audit-matchloadrecovery-live-revalidation.md` for the full
measured result.

## Follow-up if adopted

Wiring `computeMatchLoadRecoveryModule` into `runPredictionEngine`'s `moduleEdges`, the
`EngineBreakdown` type, the Data Quality blend, and the prediction UI is intentionally left as a
distinct future task, gated on an explicit decision to move forward with a live ablation
re-validation (mirroring `docs/audit-phase45-availability-revalidation.md`'s process) before it
ever affects a real prediction or paper-trading run.
