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
 */
export function resolveSegment(tour: string | null | undefined, surface: Surface | null | undefined): SegmentDefinition | null {
  if (!tour || !surface) return null;
  const normalizedTour = tour.toUpperCase();
  if (!CANDIDATE_TOURS.includes(normalizedTour as CandidateTour)) return null;
  if (!CANDIDATE_SURFACES.includes(surface)) return null;
  return { segmentKey: segmentKey(normalizedTour, surface), tour: normalizedTour as CandidateTour, surface, label: `${normalizedTour} \u2014 ${surface}` };
}
