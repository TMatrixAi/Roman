---
name: Tailwind grid without base grid-cols-N overflows on mobile
description: Bare `grid md:grid-cols-2` (no base grid-cols-1) can silently overflow the viewport on mobile when a descendant contains an unwrapped flex row or long word.
---

## The bug
`className="grid md:grid-cols-2 gap-X"` with no explicit base `grid-cols-N` produces
`grid-template-columns: none`. Below the `md` breakpoint this *looks* like a single-column
stack (items render one per row, as expected), but the implicit single track is **not**
constrained to `minmax(0, 1fr)` the way `grid-cols-1` would be — it's sized like `auto`,
which lets a descendant's max-content width (e.g. a `flex flex-wrap` row with two
sibling badges, or an unbreakable long word in a heading) blow the track wider than the
actual available space. The overflow then bleeds past the card/container edge and is
invisible (clipped by an ancestor's `overflow-hidden`/`overflow-x-hidden`), reading to
the user as content "shifted right" or cut off — not as an obvious horizontal scrollbar.

**Why:** `flex-wrap` only wraps once the flex container has a *definite/constrained*
width to wrap against; if the grid track that contains it is itself sized to
max-content, there's nothing to wrap against and the row renders at full unwrapped width.

**How to apply:** Any responsive grid (`grid sm:grid-cols-N` / `md:grid-cols-N` /
`lg:grid-cols-N`) must also declare the base case explicitly, e.g.
`grid grid-cols-1 md:grid-cols-2` — never bare `grid md:grid-cols-2`. When diagnosing an
"off-center on mobile" or "content shifted right" report, don't trust static code
reading alone (the JSX looks fine) — confirm on a real mobile-viewport screenshot, and if
suspicious, inject a temporary `useEffect` that logs `getBoundingClientRect()` for the
suspect container (grid tracks, flex rows) after data has actually loaded — a `[]`-dep
effect fired during a loading-skeleton early return will read a still-empty DOM and give
a false negative. This project's tennis-predictor had this bug in `PredictionResult.tsx`
(hero grid) and the `Home.tsx` hero `<h1>` (oversized unbreakable word, same overflow
symptom, different mechanism — needed a smaller mobile font size instead of a grid fix).
</content>
