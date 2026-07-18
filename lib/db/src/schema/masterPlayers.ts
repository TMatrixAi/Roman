import { pgTable, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Master player registry — stable internal IDs that survive provider changes and key
 * fragmentation. Each row represents one real person; the two provider-key columns link
 * to whatever external keys each provider has assigned to that person.
 *
 * Cross-provider linking is done by normalized-name match at first encounter and kept in
 * sync by the MatchStat provider's linking step. A row may have only one key set (e.g. a
 * player the old API-Tennis provider knows about but MatchStat hasn't surfaced yet, or vice
 * versa) — null is explicit "not yet linked", never "doesn't exist".
 */
export const masterPlayersTable = pgTable(
  "master_players",
  {
    /** Stable internal ID. Assigned at first insert; never changes even if provider keys change. */
    id: text("id").primaryKey(),

    displayName: text("display_name").notNull(),

    /**
     * Unicode-folded, lowercase, punctuation-stripped form of `displayName` — used for
     * name-based cross-provider matching. Computed at insert/update time by the same
     * `normalizePlayerName()` function used everywhere else; stored so cross-provider
     * lookups never require an in-process full-table scan.
     */
    normalizedName: text("normalized_name").notNull(),

    /** Player key as assigned by the API-Tennis (api.api-tennis.com) provider. Null if not yet linked. */
    apiTennisKey: text("api_tennis_key"),

    /** Player key as assigned by the tennisapi1 (RapidAPI) provider. Null if not yet linked. */
    matchstatKey: text("matchstat_key"),

    countryCode: text("country_code"),
    /** ATP / WTA / Challenger / ITF / etc. — last known tour, may lag live standings. */
    tour: text("tour"),
    currentRank: integer("current_rank"),

    lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("master_players_api_tennis_key_idx").on(table.apiTennisKey),
    uniqueIndex("master_players_matchstat_key_idx").on(table.matchstatKey),
    index("master_players_normalized_name_idx").on(table.normalizedName),
  ],
);

export const insertMasterPlayerSchema = createInsertSchema(masterPlayersTable).omit({ createdAt: true, lastUpdated: true });
export type InsertMasterPlayer = z.infer<typeof insertMasterPlayerSchema>;
export type MasterPlayerRow = typeof masterPlayersTable.$inferSelect;
