/**
 * React-Query hook for the player stats cache endpoint — mirrors the pattern of the Orval-
 * generated hooks in `generated/api.ts` but hand-written so we don't need to regenerate the
 * full client just to add one new endpoint.
 *
 * Types are defined inline (no @workspace/api-zod import) to avoid adding a dependency that
 * isn't in this package's package.json. The shape must stay in sync with `GetPlayerStatsResponse`
 * in `lib/api-zod/src/generated/api.ts`.
 */
import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { ErrorType } from "./custom-fetch";

// ─── Inline type (mirrors GetPlayerStatsResponse from api-zod) ───────────────

export interface PlayerSurfaceRecord {
  wins: number;
  losses: number;
}

/**
 * Cached aggregate performance stats for one player, as returned by GET /players/:id/stats.
 * Null fields are genuinely absent (not fabricated), e.g. a player with no Grass-court matches
 * has a null `eloGrass`. `undefined` is never returned — every field is present or null.
 */
export interface PlayerStats {
  playerId: string;
  computedAt: Date;
  overallElo: number | null;
  eloHard: number | null;
  eloClay: number | null;
  eloGrass: number | null;
  eloIndoorHard: number | null;
  matchesPlayed: number;
  /** Win rate (0-1) over the most recent 100 matches. */
  winRateLast100: number | null;
  /** Average share of games won (0-1) over the most recent 100 matches. */
  gameShareLast100: number | null;
  /** Serve dominance proxy (0-100, 50 = tour average). */
  serveRatingProxy: number | null;
  /** Return dominance proxy (0-100, same as serveRatingProxy until point-level data exists). */
  returnRatingProxy: number | null;
  /** Win/loss counts by surface. */
  surfaceStats: Record<string, PlayerSurfaceRecord> | null;
  /** Average opponent Elo over last 50 matches (from pre-match snapshots). */
  opponentStrengthAvg: number | null;
}

// ─── Raw API response shape (dates arrive as ISO strings from JSON) ───────────

interface RawPlayerStats extends Omit<PlayerStats, "computedAt"> {
  computedAt: string;
}

function parseStats(raw: RawPlayerStats): PlayerStats {
  return { ...raw, computedAt: new Date(raw.computedAt) };
}

// ─── Query key factory ────────────────────────────────────────────────────────

export const getGetPlayerStatsQueryKey = (playerId: string) =>
  ["players", playerId, "stats"] as const;

type GetPlayerStatsQueryKey = ReturnType<typeof getGetPlayerStatsQueryKey>;

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function fetchPlayerStats(playerId: string): Promise<PlayerStats | undefined> {
  try {
    const raw = await customFetch<RawPlayerStats>(
      `/players/${encodeURIComponent(playerId)}/stats`,
    );
    return parseStats(raw);
  } catch (err) {
    // A 404 is the expected "not computed yet" state, not a failure. Return undefined
    // so the UI can show a graceful empty state instead of an error banner.
    if (err && typeof err === "object" && "status" in err && err.status === 404) {
      return undefined;
    }
    throw err;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetches the cached aggregate performance stats for a player.
 *
 * Returns `data: undefined` (not an error) when the server responds 404 — this is the normal
 * state before the backfill pipeline has run for this player. `isError` is only set for genuine
 * network/server errors.
 *
 * Pass `enabled: false` or omit `playerId` to skip the fetch.
 */
export function useGetPlayerStats(
  playerId: string,
  options?: Omit<
    UseQueryOptions<PlayerStats | undefined, ErrorType<unknown>, PlayerStats | undefined, GetPlayerStatsQueryKey>,
    "queryKey" | "queryFn"
  >,
): UseQueryResult<PlayerStats | undefined, ErrorType<unknown>> {
  return useQuery({
    ...options,
    queryKey: getGetPlayerStatsQueryKey(playerId),
    queryFn: () => fetchPlayerStats(playerId),
    enabled: !!playerId && (options?.enabled ?? true),
  });
}
