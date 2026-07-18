import { pgTable, text, real, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Per-player aggregate statistics cache — one row per canonical player ID, updated by the
 * backfill pipeline (after each incremental run) and by the ledger grading cycle (when a
 * player's match is newly settled). Stats are derived entirely from `historical_matches` and
 * `match_feature_snapshots` — never from live provider calls at read time, so predictions load
 * fast regardless of provider availability.
 *
 * `computed_at` is the source of truth for staleness: a row older than 48 hours should be treated
 * as stale by callers who need fresh data, and as background context by callers for whom a
 * day-old aggregate is still meaningful (e.g. UI player profile cards).
 */

export interface PlayerSurfaceBreakdown {
  wins: number;
  losses: number;
}

/** Win/loss counts per surface. Only surfaces with at least one match appear as keys. */
export type PlayerSurfaceStatsJson = Partial<
  Record<"Hard" | "Clay" | "Grass" | "IndoorHard", PlayerSurfaceBreakdown>
>;

export const playerStatsTable = pgTable(
  "player_stats",
  {
    /** Canonical player ID — matches `master_players.id` when the player is in that table. */
    playerId: text("player_id").primaryKey(),

    /** UTC timestamp when these stats were last computed from the full historical match store. */
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),

    // ─── Elo ratings (from chronological replay of historical_matches) ─────────────
    // Same K-factor (32) and starting Elo (1500) as the backfill pipeline's PlayerState.
    // Computed by replaying every non-cancelled match in chronological order.

    /** Overall (cross-surface) Elo after replaying all historical matches. */
    overallElo: real("overall_elo"),
    /** Surface-specific Elo for Hard courts. Null when the player has no Hard matches on record. */
    eloHard: real("elo_hard"),
    /** Surface-specific Elo for Clay courts. */
    eloClay: real("elo_clay"),
    /** Surface-specific Elo for Grass courts. */
    eloGrass: real("elo_grass"),
    /** Surface-specific Elo for Indoor Hard courts. */
    eloIndoorHard: real("elo_indoor_hard"),

    // ─── Recent performance ────────────────────────────────────────────────────────

    /** Total non-cancelled historical matches played and stored. */
    matchesPlayed: integer("matches_played").notNull().default(0),

    /**
     * Win rate over the most recent 100 matches (0-1). Null when no matches are on record.
     * Uses the chronological ordering of `historical_matches.scheduled_start_at`.
     */
    winRateLast100: real("win_rate_last_100"),

    /**
     * Average game share (games won / total games in match) across the most recent 100 matches,
     * from the player's own perspective. Null when no set/game margin data is stored.
     * Derived from `historical_matches.game_margins_player1`.
     */
    gameShareLast100: real("game_share_last_100"),

    // ─── Serve/return proxy ────────────────────────────────────────────────────────
    // Derived from real set/game score margins in `historical_matches.game_margins_player1`;
    // never from fabricated point-level stats. Formula: 50 + avgGameMarginPerSet * 6, capped
    // to [5, 95] -- same proxy as `serveReturn.ts`'s `ratingsFromMargins` fallback.
    // Both serve and return proxy are the same value: the margin-based dominance score does
    // not distinguish between serve- and return-game origins without point-level data.
    // Null when fewer than MIN_MARGIN_SAMPLE sets (5) have real score data.

    /** Serve dominance proxy (0-100, 50 = tour average). */
    serveRatingProxy: real("serve_rating_proxy"),
    /** Return dominance proxy (0-100, 50 = tour average). Same as serveRatingProxy for now. */
    returnRatingProxy: real("return_rating_proxy"),

    // ─── Surface breakdown ─────────────────────────────────────────────────────────

    /**
     * Win/loss count by surface. JSONB keyed by surface name (Hard/Clay/Grass/IndoorHard).
     * Null when no matches with a resolved surface are on record.
     * Example: { "Hard": { "wins": 45, "losses": 23 }, "Clay": { "wins": 12, "losses": 8 } }
     */
    surfaceStats: jsonb("surface_stats").$type<PlayerSurfaceStatsJson>(),

    // ─── Opponent strength ─────────────────────────────────────────────────────────

    /**
     * Average Elo of opponents over the most recent 50 matches, read from
     * `match_feature_snapshots.eloOverall` at each match's own pre-match cutoff. A higher value
     * means this player tends to face stronger competition. Null when no opponent Elo data is
     * available in the historical store (e.g. the player is very new or all opponents lack history).
     */
    opponentStrengthAvg: real("opponent_strength_avg"),
  },
  (table) => [
    index("player_stats_computed_at_idx").on(table.computedAt),
  ],
);

export const insertPlayerStatsSchema = createInsertSchema(playerStatsTable);
export type InsertPlayerStats = z.infer<typeof insertPlayerStatsSchema>;
export type PlayerStatsRow = typeof playerStatsTable.$inferSelect;
