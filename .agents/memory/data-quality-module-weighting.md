---
name: Data Quality module weighting
description: Why the overall Data Quality score is an importance-weighted blend of module reliabilities, not a flat average.
---

`computeDataQuality` blends the six prediction-engine module reliabilities (Surface Elo, Serve &
Return, Recent Form, Fatigue, Availability, Head-to-Head) using a fixed per-module `importance`
weight (see `MODULE_IMPORTANCE` in `dataQuality.ts`), not a flat average.

**Why:** A flat average let structurally-rare-but-real gaps drag down otherwise strong
predictions. Head-to-Head reliability collapses to its floor whenever two players simply haven't
met — the normal case for most real matchups, not a fixable data gap — and Availability's
reliability drops whenever travel distance can't be resolved (still limited to a small known-venue
list). Both were getting the same 1/6 share of the average as the core signals (Elo, Recent Form,
Serve & Return) whose reliability genuinely tracks real per-match data richness. Fatigue's
reliability is also a fixed constant (always 70, see `fatigue.ts`) rather than a real signal, so an
equal-weight scheme let it dilute genuine weakness elsewhere too.

**How to apply:** When adding or changing a prediction-engine module that feeds Data Quality, give
it an importance weight that reflects (a) how much it actually drives the ensemble edge and (b)
whether its reliability is a genuine per-match data-richness signal or a structurally-rare/fixed
value. Don't revert to a flat average — re-validate `calibration.ts`'s dataQuality-based shrink
curve and `recommendation.ts`'s dataQuality thresholds against the walk-forward evaluation suite
(`test:evaluation`) whenever the blend's typical output range shifts.

**Update (2026-07-13):** a low-but-nonzero importance weight still wasn't enough for Head-to-Head —
because "no prior meetings" is the NORMAL case for most real matchups (first rounds, lower tiers),
even a small weight visibly dragged down an otherwise strong score across the whole corpus. Fully
excluded it from the blend via `EXCLUDED_FROM_DATA_QUALITY` (mirrors the existing
`EXCLUDED_FROM_ENSEMBLE` pattern) rather than just down-weighting further. It still votes in the
ensemble (`ENSEMBLE_WEIGHT_PRIOR.headToHead` unaffected) — only its effect on the *score* is gone.
Same audit also stopped Availability's and Style-Matchup's coverage-gap warnings (travel/venue
unresolved, thin surface sample) from feeding the Upset Risk `uncertainty` component, and moved
"no head-to-head" / "not enough matches for a specialist tag" out of risk-styled UI into a new
neutral `EngineBreakdown.disclosures` field — a structurally-common absence of data is real
information worth showing, but isn't evidence a specific match is riskier or lower-quality, so it
shouldn't be scored or styled like one. Apply this same distinction (quality/risk-worthy vs.
merely-disclosable) whenever a new "gap" signal is added to either Data Quality or Upset Risk.
