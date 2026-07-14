/**
 * Shared scale-branded number types for display code, mirroring the same convention on the
 * backend (`artifacts/api-server/src/services/predictionEngine/units.ts` -- read that file for
 * the full rationale).
 *
 * Why this exists: the WIN PROB (ELO) display bug happened because a field the API already
 * returns on the 0-100 scale (`engine.surfaceElo.eloWinProbabilityPlayer1`) was multiplied by
 * 100 again here on the frontend, which assumed it was a 0-1 decimal. The API boundary is plain
 * JSON, so brands from the backend's `units.ts` don't survive the trip -- every field arrives as
 * an untyped `number` no matter its real scale. This module re-establishes the same distinction
 * on the display side: `formatPercentage` only accepts the branded `Percentage` type, so any new
 * call site must explicitly choose `asPercentage` (value is already 0-100 -- render as-is) or
 * `fractionToPercentage` (value is 0-1 -- multiply by 100) before it compiles. That explicit
 * choice is exactly what was missing when the WIN PROB (ELO) bug shipped -- there was no
 * decision point that would have forced someone to check which scale the field actually used.
 */

declare const PercentageBrand: unique symbol;
declare const FractionBrand: unique symbol;

/** A value on the 0-100 scale, e.g. a win probability already expressed as a percentage (72.4 means 72.4%). Render directly -- never multiply by 100 again. */
export type Percentage = number & { readonly [PercentageBrand]: true };

/** A value on the 0-1 scale, e.g. a raw probability or blend weight expressed as a decimal fraction (0.724 means 72.4%). Must go through `fractionToPercentage` before display. */
export type Fraction = number & { readonly [FractionBrand]: true };

/**
 * Assert that a raw number from the API is already on the 0-100 scale. Use at the one place a
 * field is read off the API response -- check the backend field's doc comment (in
 * `predictionEngine/units.ts`-annotated modules like `surfaceElo.ts`) for which scale it uses
 * before picking this over `fractionToPercentage`.
 */
export function asPercentage(value0to100: number): Percentage {
  return value0to100 as Percentage;
}

/** Assert that a raw number from the API is already on the 0-1 scale. */
export function asFraction(value0to1: number): Fraction {
  return value0to1 as Fraction;
}

/** Convert a 0-1 fraction to the 0-100 percentage scale used for display. */
export function fractionToPercentage(value: Fraction): Percentage {
  return (value * 100) as Percentage;
}

/** Formats a branded Percentage (0-100) for display, e.g. "72%". Takes the branded type, not a plain `number`, so a value that hasn't been explicitly scale-asserted (via `asPercentage`/`fractionToPercentage`) can't be passed in by accident. */
export function formatPercentage(value: Percentage, decimals = 0): string {
  return `${value.toFixed(decimals)}%`
}
