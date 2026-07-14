---
name: Shared filtered-array reuse silently drops blend inputs
description: A single upstream array filtered once for consumer A, then reused as-is for consumer B, can silently starve B of inputs its own documentation says it receives.
---

Building one "module edges" (or similar per-feature) array, filtering it once for one consumer
(e.g. ensemble voting), and then passing that *same already-filtered* array into a second, logically
independent consumer (e.g. a data-quality/confidence blend) silently drops inputs from the second
consumer -- even when that consumer's own weight/importance table documents real weights and
rationale for the dropped inputs, as if they were included.

**Why:** the two consumers had genuinely independent exclusion rules (one about "should this signal
vote," the other about "should this signal count toward a trust score"), but sharing the filtered
array collapsed them into one rule. The bug was invisible in code review because each consumer's own
constants/tests looked correct in isolation; only recomputing the second consumer's output directly
from raw per-input values (bypassing the shared array) revealed the mismatch.

**How to apply:** when a codebase builds one shared per-item array and then filters it for a
specific downstream use (voting, scoring, display, etc.), check every OTHER place that array feeds
into before trusting that a later `.filter()` step for use A hasn't already narrowed what use B ever
sees. If a weight/importance table documents an input as included, verify with a real
recompute-from-raw-data check that it actually reaches that computation at runtime -- don't assume
the call site's filtering matches the table's intent.
