---
name: Name/id opponent identity resolution ceiling
description: Normalized-name + id cross-reference identity resolution has a real, structural yield ceiling against a corpus dominated by single-appearance players.
---

Building a player identity index (normalize name, group by id/name, canonicalize aliases) genuinely
recovers cases where the same player is recorded under slightly different spellings/ids across
rows. But it can only merge a player who appears **more than once** under different
name/id variants -- it has nothing to cross-reference for a player who appears exactly once in the
whole corpus, which is common for lower-tier (ITF) opponents who play a single recorded match.

**Why this matters:** on a real ~18k-match tennis corpus, this ceiling was measured directly:
~3,480 distinct identities, only ~51 were alias-merges (~1.5%), while the overall opponent-Elo
fallback rate stayed ~18% even after identity resolution. Don't expect an aggregate accuracy/Brier
backtest to move measurably from this kind of fix alone -- validate it with targeted resolution
unit tests (does a known-alias pair resolve? does a genuinely-unique opponent still honestly
fall back?) instead of an aggregate before/after metric, which will legitimately look like ~0
effect even when the fix is completely correct.

**How to apply:** before promising an aggregate accuracy improvement from an identity/resolution
fix, estimate what fraction of the corpus the fix can even touch (distinct aliases found / total
distinct identities). A low percentage is not a sign the fix failed -- it's the honest ceiling of
name/id-only resolution. A genuinely more impactful fix would require a new external identifier
(e.g. DOB, provider cross-ID) that this environment did not have in schema/provider payloads as of
2026-07-13.
