---
name: Ablation leave-one-out is a no-op for already-excluded modules
description: Why re-validating an ensemble module that is already in EXCLUDED_FROM_ENSEMBLE requires a second ablation run with the exclusion temporarily lifted, not just re-running the standard leave-one-out ablation.
---

The ablation harness (`artifacts/api-server/src/services/evaluation/ablation.ts`, via
`POST /api/evaluation/ablation/run`) computes leave-one-out deltas *against the current live
baseline configuration*. If a module is already in `EXCLUDED_FROM_ENSEMBLE`
(`dataQuality.ts`), its "removed" variant is mathematically identical to the baseline —
delta = 0.0 — which looks like "no measurable effect" but actually just means "it was already
off." This produced a misleading first read during Task 45's Availability revalidation.

**Why:** the harness was designed to answer "does removing an active module hurt," not "would
adding an inactive module help" — those are different questions requiring different baselines.

**How to apply:** to measure whether a currently-excluded module should be re-included, you must
temporarily clear it from `EXCLUDED_FROM_ENSEMBLE`, rebuild, and rerun the ablation so the new
baseline actually has it active — then its leave-one-out delta on *that* run tells you the real
inclusion effect. Revert the exclusion-set change afterward based on the measured result.

Also: the full 13-variant ablation over the real historical corpus (~18k matches) takes
~1–1.5 hours running inside the live workflow process (triggered via HTTP, not a background shell
job — shell-backed jobs die when the tool call ends, per the sandbox background-process-limit
note). It is vulnerable to being silently wiped if any concurrent process restarts that workflow
mid-run (state is in-memory, not persisted) — poll `GET /api/evaluation/ablation/status` and be
ready to restart the job if `state` unexpectedly reverts to `"idle"` before a `report` appears.
