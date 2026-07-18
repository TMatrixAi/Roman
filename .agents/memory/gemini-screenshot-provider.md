---
name: Gemini screenshot provider setup
description: How the Gemini vision fallback works, which models/auth methods work, and what causes limit:0 quota errors.
---

## Working configuration

- **Key env var**: `GEMINI_API_KEY`
- **Auth method**: `?key=<value>` URL parameter (correct for all AI Studio key formats, including `AQ.*` prefix)
- **Working models** (try in order): `gemini-flash-latest`, `gemini-flash-lite-latest` — these work even when `gemini-2.0-flash` / `gemini-2.5-flash` show `limit: 0`
- The `gemini-flash-latest` alias resolves to the current stable flash model and has a separate quota bucket from the numbered versions

## Pitfalls encountered

### AQ.* prefix is NOT an OAuth token
Google AI Studio can issue API keys starting with `AQ.` — not just `AIza`. These keys still use `?key=` URL param auth, NOT `Authorization: Bearer`. Using Bearer on an `AQ.*` key returns 401. Do not detect provider by key prefix; detect by which env var the key is stored in.

### limit: 0 on gemini-2.0-flash free tier
If a project has billing set up in a certain way (billing linked but free tier disabled for specific models), `gemini-2.0-flash` and `gemini-2.5-flash` return RESOURCE_EXHAUSTED with `limit: 0`. The `gemini-flash-latest` alias is unaffected and should be tried first.

### RESOURCE_EXHAUSTED retry classification
Gemini 429 errors carry a `retryDelay` field in the error details (e.g. "29s"). A short delay (< 30s) = transient RPM rate limit → retryable. No delay or long delay = daily quota → try next model in chain. The model chain sets `code = "quota_exhausted"` when all models fail, which `isPermanentProviderError` recognizes as skip-to-next-provider.

**Why:** `gemini-flash-latest` worked for this project; numbered model variants had quota = 0.

**How to apply:** Always put `gemini-flash-latest` at the top of `GEMINI_MODELS` array in `callGemini()`.
