import { pgTable, serial, text, integer, real, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const predictionsTable = pgTable(
  "predictions",
  {
    id: serial("id").primaryKey(),

    player1Id: text("player1_id").notNull(),
    player1Name: text("player1_name").notNull(),
    player2Id: text("player2_id").notNull(),
    player2Name: text("player2_name").notNull(),

    surface: text("surface").notNull(),
    matchFormat: text("match_format").notNull(),
    tournamentLevel: text("tournament_level"),
    tournamentName: text("tournament_name"),

    predictedWinnerId: text("predicted_winner_id").notNull(),
    predictedWinnerName: text("predicted_winner_name").notNull(),
    calibratedProbability: real("calibrated_probability").notNull(),
    // The predicted winner's own win probability (mirrored from calibratedProbability when
    // player 2 is the pick) -- always >= 50, so display surfaces never show a sub-50% number
    // next to the player the engine named the favorite. calibratedProbability itself stays
    // player-1-relative because calibration fitting/evaluation depend on that fixed orientation.
    predictedWinnerProbability: real("predicted_winner_probability").notNull(),
    dataQuality: integer("data_quality").notNull(),
    dataQualityLabel: text("data_quality_label").notNull(),
    upsetRisk: text("upset_risk").notNull(),
    recommendation: text("recommendation").notNull(),
    predictedSetScore: text("predicted_set_score").notNull(),

    // Full module-by-module engine output (EngineBreakdown shape), stored as-is for the detail view.
    engine: jsonb("engine").notNull(),

    actualWinnerId: text("actual_winner_id"),
    actualWinnerName: text("actual_winner_name"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    // Backs the Ledger/History page's `ORDER BY created_at DESC LIMIT n` query, and the
    // `/predictions/stats` aggregation's full-table scan avoidance as row counts grow.
    index("predictions_created_at_idx").on(table.createdAt),
    index("predictions_recommendation_idx").on(table.recommendation),
  ],
);

export const insertPredictionSchema = createInsertSchema(predictionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPrediction = z.infer<typeof insertPredictionSchema>;
export type PredictionRow = typeof predictionsTable.$inferSelect;
