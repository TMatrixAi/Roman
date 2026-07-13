---
name: Recent Form trend-label validation
description: Why raw win/loss streak deltas are a weak trend signal, and what to check before shipping any "improving/stable/declining" style label.
---

A trend label built from a **plain win-rate delta** (newer-half win rate minus older-half win rate, no opponent adjustment) showed essentially **zero real predictive power** on this project's full historical corpus (7.5k+ players): "improving" and "declining" buckets had future-win-rate spreads of ~0.1-0.2pts regardless of threshold or minimum-sample-size tried — indistinguishable from noise. This was true even though the label had shipped and looked plausible in the UI.

Switching the delta to an **opponent-adjusted performance signal** (actual score minus Elo-implied expected score vs. that specific opponent, using the same real `eloOverall` history the engine's opponent-adjustment already relies on) and requiring both a wider delta threshold and a minimum sample size produced a real, if modest, separation (~2.6pt spread in subsequent win rate between "improving" and "declining").

**Why:** a raw win-rate streak conflates "played better" with "faced weaker opponents recently" — those are very different signals, and only the former should drive a trend label callers may act on.

**How to apply:** before shipping (or re-tuning) any streak/trend/momentum-style label in this project, write a one-off analysis script (pattern: `scripts/analyzeRecentFormTrendValidity.ts`) that buckets the label against players' REAL subsequent outcomes over the corpus, and only ship thresholds that show genuine separation — don't assume a plausible-looking heuristic is real without checking. Reuse `matchFeatureSnapshotsTable`'s `eloOverall` history (already indexed by `buildEloHistoryIndex`) for the opponent adjustment rather than plain win/loss.
