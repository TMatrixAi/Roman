import { pgTable, serial, text, integer, real, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const predictionsTable = pgTable("predictions", {
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
});

export const insertPredictionSchema = createInsertSchema(predictionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPrediction = z.infer<typeof insertPredictionSchema>;
export type PredictionRow = typeof predictionsTable.$inferSelect;
