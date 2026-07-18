import type { Surface } from "../tennisData/types";

/**
 * Phase 6 specialist segments: the tour/surface splits Phase 3's coverage volume might justify a
 * dedicated calibration for. Only ATP/WTA are candidates -- Challenger/ITF/Exhibition/Junior
 * matches never accumulate enough real volume per surface to responsibly train anything
 * segment-specific, so they (and any tour we don't recognize) always resolve to the general
 * model. `IndoorHard` is kept distinct from `Hard` here because indoor/outdoor courts play
 * differently enough that pooling them would blur a real signal, on the rare segments with
 * enough indoor-hard volume to matter.
 */
const CANDIDATE_TOURS = ["ATP", "WTA"] as const;
const CANDIDATE_SURFACES: Surface[] = ["Hard", "Clay", "Grass", "IndoorHard"];

/**
 * The DB stores two distinct tour-related columns on `historical_matches`:
 *   - `tour`             — the generic tour type: 'ATP', 'WTA', 'Challenger', 'ITF', etc.
 *   - `tournament_level` — the specific tier:     'ATP250', 'Masters1000', 'WTA250', etc.
 *
 * All specialist segment queries filter by `historical_matches.tour` (the generic column), so
 * `eq(col, 'ATP')` is the correct clause — NOT `inArray(col, ['ATP250', 'Masters1000', ...])`.
 *
 * `resolveSegment` accepts both forms as input to remain robust against providers that supply
 * the granular level instead of the generic tour. The reverse map below normalises those inputs.
 */

/**
 * Maps the granular provider-supplied tournament_level values to the canonical tour group used
 * by this module, so `resolveSegment` can accept either 'ATP' or 'ATP250' as the tour argument.
 * Keyed in uppercase so the lookup is case-insensitive.
 */
const TOUR_LEVEL_TO_GROUP: Partial<Record<string, CandidateTour>> = {
  ATP250: "ATP",
  ATP500: "ATP",
  MASTERS1000: "ATP",
  WTA250: "WTA",
  WTA500: "WTA",
  WTA1000: "WTA",
};

export type CandidateTour = (typeof CANDIDATE_TOURS)[number];

export interface SegmentDefinition {
  segmentKey: string;
  tour: CandidateTour;
  surface: Surface;
  label: string;
}

/** Every tour/surface combination Phase 6 will ever consider fitting a specialist for. */
export function listCandidateSegments(): SegmentDefinition[] {
  const segments: SegmentDefinition[] = [];
  for (const tour of CANDIDATE_TOURS) {
    for (const surface of CANDIDATE_SURFACES) {
      segments.push({ segmentKey: segmentKey(tour, surface), tour, surface, label: `${tour} \u2014 ${surface}` });
    }
  }
  return segments;
}

export function segmentKey(tour: string, surface: string): string {
  return `${tour}-${surface}`;
}

/**
 * Resolves the tour/surface segment for a live or historical match, or null when the match's
 * tour isn't one of the candidates (Challenger/ITF/Exhibition/Junior/unknown) -- those always run
 * the general model, never a "segment" of one.
 *
 * Accepts both canonical group names ('ATP', 'WTA') and the granular DB-level names the
 * historical_matches and live-fixture feeds store ('ATP250', 'Masters1000', 'WTA1000', etc.).
 * The latter are normalised via `TOUR_LEVEL_TO_GROUP` so a caller doesn't need to know which
 * form the incoming tour string uses -- both produce the same specialist segment.
 */
export function resolveSegment(tour: string | null | undefined, surface: Surface | null | undefined): SegmentDefinition | null {
  if (!tour || !surface) return null;
  if (!CANDIDATE_SURFACES.includes(surface)) return null;
  const upperTour = tour.toUpperCase();
  // Accept canonical group name ('ATP') or a granular DB level name ('ATP250', 'MASTERS1000')
  const canonicalTour: CandidateTour | undefined =
    CANDIDATE_TOURS.includes(upperTour as CandidateTour)
      ? (upperTour as CandidateTour)
      : TOUR_LEVEL_TO_GROUP[upperTour];
  if (!canonicalTour) return null;
  return { segmentKey: segmentKey(canonicalTour, surface), tour: canonicalTour, surface, label: `${canonicalTour} \u2014 ${surface}` };
}
