/**
 * 2026-07-14 Fatigue asOfDate fix -- verification report.
 *
 * Read-only. Measures Fatigue's own coverage (how often it expresses a genuine, non-tied vote)
 * and conditional accuracy (accuracy of the favored player, among matches where it does vote)
 * across the full graded historical corpus, comparing:
 *   - "before" = computeFatigueModule(p1Matches, p2Matches) with NO asOfDate, i.e. exactly the
 *     pre-fix call shape (measured against the real Date.now() at report-run time) -- this
 *     reproduces the historical bug for comparison purposes only, it is never used live.
 *   - "after"  = computeFatigueModule(p1Matches, p2Matches, match.cutoffAt), i.e. the fixed call
 *     shape now used by `historicalScoring.ts`.
 *
 * Does not call the full prediction engine or touch the database -- this isolates Fatigue's own
 * signal quality from the rest of the ensemble.
 */
import { db, historicalMatchesTable, pool } from "@workspace/db";
import { asc } from "drizzle-orm";
import { buildMatchHistoryIndex, reconstructPlayerMatchHistory } from "../services/historicalData/matchRecordReconstruction";
import { computeFatigueModule } from "../services/predictionEngine/fatigue";

interface Tally {
  total: number;
  votes: number; // non-tied (player1Edge !== 0)
  votesCorrect: number;
}

function edgeFor(fatigue: ReturnType<typeof computeFatigueModule>): number {
  return (fatigue.player2FatigueScore - fatigue.player1FatigueScore) / 2;
}

async function main() {
  const allMatches = await db.select().from(historicalMatchesTable).orderBy(asc(historicalMatchesTable.scheduledStartAt), asc(historicalMatchesTable.id));
  const matchHistory = buildMatchHistoryIndex(allMatches);

  const graded = allMatches.filter((m) => !m.cancelled && m.winnerId !== null);
  console.log(`Full historical corpus: ${allMatches.length} rows; graded (non-cancelled, winnerId set): ${graded.length}`);

  const before: Tally = { total: 0, votes: 0, votesCorrect: 0 };
  const after: Tally = { total: 0, votes: 0, votesCorrect: 0 };
  let skippedNoHistory = 0;

  for (const match of graded) {
    const p1Matches = reconstructPlayerMatchHistory(matchHistory, match.player1Id, match.cutoffAt);
    const p2Matches = reconstructPlayerMatchHistory(matchHistory, match.player2Id, match.cutoffAt);
    if (p1Matches.length === 0 || p2Matches.length === 0) {
      skippedNoHistory++;
      continue;
    }

    const fatigueBefore = computeFatigueModule(p1Matches, p2Matches); // no asOfDate: pre-fix call shape
    const fatigueAfter = computeFatigueModule(p1Matches, p2Matches, match.cutoffAt); // fixed call shape

    const player1Won = match.winnerId === match.player1Id;

    before.total++;
    const edgeBefore = edgeFor(fatigueBefore);
    if (edgeBefore !== 0) {
      before.votes++;
      const favoredPlayer1 = edgeBefore > 0;
      if (favoredPlayer1 === player1Won) before.votesCorrect++;
    }

    after.total++;
    const edgeAfter = edgeFor(fatigueAfter);
    if (edgeAfter !== 0) {
      after.votes++;
      const favoredPlayer1 = edgeAfter > 0;
      if (favoredPlayer1 === player1Won) after.votesCorrect++;
    }
  }

  function report(label: string, t: Tally) {
    const coverage = t.total > 0 ? ((t.votes / t.total) * 100).toFixed(1) : "0.0";
    const accuracy = t.votes > 0 ? ((t.votesCorrect / t.votes) * 100).toFixed(1) : "n/a";
    console.log(`\n${label}: total=${t.total} votes=${t.votes} coverage=${coverage}% conditionalAccuracy=${accuracy}${t.votes > 0 ? "%" : ""}`);
  }

  console.log(`Skipped (no prior match history for one or both players): ${skippedNoHistory}`);
  report("BEFORE fix (asOfDate omitted, replicating the pre-fix bug)", before);
  report("AFTER fix (asOfDate = match.cutoffAt, the real fix)", after);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
