---
name: Retroactive tier reconstruction from stored engine breakdowns
description: How to add a new classification/tier over already-graded prediction rows without touching the live scoring path, and why a structural gate can require a distinct backtest-only relaxed variant.
---

Every graded `evaluation_predictions` row's `featureSnapshot` embeds the full engine breakdown
(model votes, agreement/conflict flags, specialist-applied flag, upset risk, denormalized data
quality) at the time it was scored. This means a brand-new classification of "was this row X" can
be computed **retroactively, purely from already-stored data**, by re-deriving the classifier's
inputs from the stored breakdown and re-running the current gating function -- no changes needed
to the scoring pipelines (historical walk-forward or live) that originally produced the rows.

**Why:** This satisfies "don't change what's already shown to users unless a backtest justifies
it" for free (zero production-path changes), and keeps the classification correct even if the
gating logic itself changes later, since the raw inputs are still there.

**How to apply:** When one of the classifier's real gates is structurally unsatisfiable in a given
scoring context (e.g. a "specialist applied" gate that's always false during historical scoring
because segment specialists are themselves fit FROM that same historical output -- feeding one
back in would be circular), don't weaken the real classifier. Instead add a second, explicitly
backtest-only variant that relaxes just that one gate, to measure "how good would this cohort be
if the missing input were available" without ever using that relaxed variant for real/live
labeling. Always type-guard the stored snapshot for the specific fields the classifier needs (they
get added over the engine's lifetime) and exclude rows missing them, rather than trusting an
exact model-version string match or a denormalized boolean already baked into the row.
