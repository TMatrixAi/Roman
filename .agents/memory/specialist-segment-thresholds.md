---
name: Specialist segment sufficiency thresholds and honest fallback pattern
description: How Phase 6 decides whether a tour/surface segment gets its own specialist model vs. falls back to the general model, and why the disclaimer distinguishes "not a candidate" from "under threshold".
---

Tour×surface specialist models (built on top of the existing Phase 4 isotonic calibration
infra, not a new model family) only apply when a segment clears TWO distinct thresholds:
raw historical-match coverage (`MIN_HISTORICAL_MATCHES_FOR_SEGMENT`) and validation-sample
size (`MIN_VALIDATION_SAMPLES_FOR_SEGMENT`), both checked and reported separately.

**Why:** a segment can have plenty of historical matches but few validation-segment
predictions (or vice versa), and a single merged threshold would hide which one was the
actual blocker — the user-facing disclaimer needs exact counts against exact minimums to be
genuinely non-silent.

**How to apply:** when adding any new per-segment gating logic, keep "this dimension isn't a
candidate at all" (e.g. tour is Challenger/ITF/unknown) strictly distinct from "resolved to a
real segment but under threshold" — both need their own disclaimer copy, never a shared vague
one. Blend weight is derived only from measured validation-period logLoss improvement of the
segment's own fit vs. the general model on the SAME points, clamped to [0.1, 0.85] — never
hand-tuned. New API-facing engine fields added after a feature has shipped real historical
data (e.g. `segmentNote`) must stay optional in the OpenAPI schema, or GetPredictionResponse
validation breaks on every pre-existing row whose stored `engine` JSON predates the field.
