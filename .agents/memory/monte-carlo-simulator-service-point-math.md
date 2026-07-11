---
name: Monte Carlo simulator service-point math
description: Tennis point-by-point sim bug pattern — "server win prob" vs "player1 win prob" framing are NOT interchangeable; a silent bias bug looked plausible until a symmetric-input unit test caught it.
---

When simulating point-by-point at the game/tiebreak level, be precise about which of two framings a probability variable represents, and never mix them:

1. **"Probability the SERVER wins the point"** — the natural framing for simulating a single game, since the same player serves every point in that game. Each player's own service-point-win rate applies directly regardless of who they're playing.
2. **"Probability player1 (a fixed player) wins the point"** — the natural framing for tallying a running score across two players with alternating serve (e.g. a tiebreak, where serve changes mid-sequence).

A bug that silently produces plausible-looking but wrong output: when player2 is serving, using `1 - player2ServicePointProb` (correct under framing 2) as the input to a function that expects framing 1. This computes "probability player1 wins" and feeds it somewhere expecting "probability the server wins" — the sign only cancels out correctly when the two players have different serve rates in one specific direction, so small asymmetric test cases can look fine while a symmetric-input case reveals a massive (~100% vs ~50%) bias.

**Why this matters:** the failure is not a crash or type error — the simulation runs, produces smooth-looking probabilities and set-score distributions, and only a targeted correctness test (e.g. "give both players identical inputs and assert the output is ~50/50") exposes it.

**How to apply:** whenever writing/reviewing point-by-point or turn-based simulation code with alternating roles (serve, initiative, etc.), write a symmetric-input unit test first — before performance/reliability tests — to catch this class of bug immediately.
