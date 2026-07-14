import { db, predictionsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getTennisDataProvider } from "./src/services/tennisData";
import { resolvePlayerProfile } from "./src/services/tennisData/playerIdentity";
import { resolveOpponentStrength } from "./src/services/predictionEngine/opponentStrength";
import { runPredictionEngine } from "./src/services/predictionEngine/index";
import { computeMatchIdentityKey, computeInputSnapshotHash } from "./src/services/predictionEngine/predictionIdentity";

const provider = getTennisDataProvider();
const [player1, player2] = await Promise.all([
  resolvePlayerProfile(provider, "7637"),
  resolvePlayerProfile(provider, "17463"),
]);
const [player1Matches, player2Matches, headToHead] = await Promise.all([
  provider.getPlayerMatches("7637"),
  provider.getPlayerMatches("17463"),
  provider.getHeadToHead("7637", "17463"),
]);
const [player1OpponentStrength, player2OpponentStrength] = await Promise.all([
  resolveOpponentStrength(player1Matches),
  resolveOpponentStrength(player2Matches),
]);

const output = runPredictionEngine({
  player1, player2, player1Matches, player2Matches, headToHead,
  surface: "Grass", matchFormat: "BestOf3",
  player1OpponentElo: player1OpponentStrength.lookup,
  player2OpponentElo: player2OpponentStrength.lookup,
  activeCalibration: null, weather: null, tournamentName: null, tournamentLevel: null,
  segment: null, simulatorAdoption: null,
});

const matchIdentityKey = computeMatchIdentityKey(player1.id, player2.id, null, "Grass", "BestOf3");
const inputSnapshotHash = computeInputSnapshotHash({
  player1Id: player1.id, player2Id: player2.id, player1Matches, player2Matches, headToHead,
  player1OpponentElo: player1OpponentStrength.lookup, player2OpponentElo: player2OpponentStrength.lookup,
});

console.log("player1.name JSON:", JSON.stringify(player1.name));
console.log("player2.name JSON:", JSON.stringify(player2.name));
console.log("matchIdentityKey JSON:", JSON.stringify(matchIdentityKey));
console.log("has fatigue in models?:", output.engine.models.map((m:any)=>m.modelName));

const values: any = {
  player1Id: player1.id, player1Name: player1.name, player2Id: player2.id, player2Name: player2.name,
  surface: "Grass", matchFormat: "BestOf3", tournamentLevel: null, tournamentName: null,
  predictedWinnerId: output.predictedWinnerId, predictedWinnerName: output.predictedWinnerName,
  calibratedProbability: output.calibratedProbability, predictedWinnerProbability: output.predictedWinnerProbability,
  dataQuality: output.dataQuality, dataQualityLabel: output.dataQualityLabel, upsetRisk: output.upsetRisk,
  recommendation: output.recommendation, predictedSetScore: output.predictedSetScore, engine: output.engine,
  matchIdentityKey: matchIdentityKey + "-debugB", inputSnapshotHash,
};

try {
  const [saved] = await db.insert(predictionsTable).values(values).onConflictDoUpdate({
    target: [predictionsTable.matchIdentityKey, predictionsTable.inputSnapshotHash],
    set: { player1Name: values.player1Name },
    setWhere: sql`${predictionsTable.actualWinnerId} IS NULL AND ${predictionsTable.resolvedAt} IS NULL`,
  }).returning();
  console.log("SAVED id:", saved?.id);
} catch (err: any) {
  console.log("MESSAGE:", err.message?.slice(0,200));
  console.log("CAUSE MESSAGE:", err.cause?.message);
  console.log("CAUSE WHERE:", err.cause?.where);
  console.log("CODE:", err.cause?.code);
}
process.exit(0);
