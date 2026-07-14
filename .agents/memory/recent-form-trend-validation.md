---
name: Recent Form trend-label validation
description: Why raw win/loss streak deltas are a weak trend signal, and what to check before shipping any "improving/stable/declining" style label.
---

A trend label built from a **plain win-rate delta** (newer-half win rate minus older-half win rate, no opponent adjustment) showed essentially **zero real predictive power** on this project's full historical corpus (7.5k+ players): "improving" and "declining" buckets had future-win-rate spreads of ~0.1-0.2pts regardless of threshold or minimum-sample-size tried — indistinguishable from noise. This was true even though the label had shipped and looked plausible in the UI.

Switching the delta to an **opponent-adjusted performance signal** (actual score minus Elo-implied expected score vs. that specific opponent, using the same real `eloOverall` history the engine's opponent-adjustment already relies on) and requiring both a wider delta threshold and a minimum sample size produced a real, if modest, separation (~2.6pt spread in subsequent win rate between "improving" and "declining").

**Why:** a raw win-rate streak conflates "played better" with "faced weaker opponents recently" — those are very different signals, and only the former should drive a trend label callers may act on.

**How to apply:** before shipping (or re-tuning) any streak/trend/momentum-style label in this project, write a one-off analysis script (pattern: `scripts/analyzeRecentFormTrendValidity.ts`) that buckets the label against players' REAL subsequent outcomes over the corpus, and only ship thresholds that show genuine separation — don't assume a plausible-looking heuristic is real without checking. Reuse `matchFeatureSnapshotsTable`'s `eloOverall` history (already indexed by `buildEloHistoryIndex`) for the opponent adjustment rather than plain win/loss.

**2026-07-14 re-check:** layering a real serve/return-quality blend on top of the opponent-adjusted delta (same blend the live module already applies to its form score) widened the separation further at the same thresholds (0.25 delta / min 6 sample: ~1.5pt -> ~2.2pt improving-vs-declining spread) — the existing thresholds already happened to be the best config for the richer signal too, so no retuning was needed. Point-stat coverage in the historical corpus is real but partial (~35% of appearances); a re-check step like this is worth repeating whenever a new real signal gets blended into an already-validated label, since a validated signal is not guaranteed to still be the best choice once its own inputs change — it just happened to hold up this time.

**Correctness pitfall hit during the re-check (caught in code review, not by me):** a backtest that claims to validate a live per-match trend/weighting formula must replicate the FULL weight stack the live code applies (recency decay, tournament-level weight, surface-mismatch deweight, retired/walkover deweight) -- reproducing only the recency-decay term and calling it "the same as production" produces numbers from a materially different formula and an unreliable conclusion, even if the delta/threshold plumbing around it is otherwise correct.
