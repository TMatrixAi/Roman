/**
 * Task #8 — isPointInTimeReplay coverage
 *
 * Verifies the walk-forward vs shadow-replay specialist-suppression contract in
 * `scoreHistoricalMatch`:
 *
 *  • isPointInTimeReplay = undefined / false  (walk-forward path)
 *    → specialist calibration IS applied; undefined and false are byte-for-byte
 *      identical (the field defaults to the same no-suppression path).
 *
 *  • isPointInTimeReplay = true  (shadow-replay path)
 *    → specialist calibration is SUPPRESSED; calibratedProbability must equal
 *      the no-specialist baseline.
 *
 * Run with: pnpm --filter @workspace/api-server run test:evaluation
 */
import test from "node:test";
import assert from "node:assert/strict";
import { db, historicalMatchesTable, type HistoricalMatchRow } from "@workspace/db";
import { asc, lt, sql } from "drizzle-orm";
import { scoreHistoricalMatch, type HistoricalScoringContext } from "./historicalScoring";
import { buildMatchHistoryIndex } from "../historicalData/matchRecordReconstruction";
import { buildEloHistoryIndex } from "../predictionEngine/opponentStrength";
import { buildPlayerIdentityIndex } from "../tennisData/playerIdentity";
import type { SpecialistModelRow } from "@workspace/db";

// ── Synthetic specialist ───────────────────────────────────────────────────────
//
// Calibration mapping for ATP-Hard that strongly biases toward the favourite:
//   raw 50 % → calibrated 75 %  (large shift, clearly visible in assertion output)
//
// The knot scale (0–1, matching the generalMapping format in specialistWeights.test.ts):
//   x = raw ensemble probability as a fraction, y = target calibrated fraction.
const BIASED_ATP_HARD_SPECIALIST: SpecialistModelRow = {
  id: -999,
  computedAt: new Date("2026-01-01T00:00:00.000Z"),
  segmentKey: "ATP-Hard",
  tour: "ATP",
  surface: "Hard",
  label: "ATP-Hard (synthetic test specialist)",
  meetsThreshold: true,
  weight: 0.8,
  historicalMatchCount: 1000,
  validationSampleSize: 500,
  accuracy: null,
  logLoss: 0.60,
  brier: null,
  generalAccuracy: null,
  generalLogLoss: 0.65,
  generalBrier: null,
  // x=0 → y=0, x=0.5 → y=0.75, x=1 → y=1
  // resolveSegmentSpecialistInputSync feeds this to applyCalibration which interpolates linearly
  // between knots; the 0.5 → 0.75 knot creates a measurable upward shift near 50 % raw probability.
  calibrationMapping: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.75 },
    { x: 1, y: 1 },
  ] as unknown as SpecialistModelRow["calibrationMapping"],
};

const SPECIALIST_MAP = new Map([
  ["ATP-Hard", BIASED_ATP_HARD_SPECIALIST],
]) as ReadonlyMap<string, SpecialistModelRow>;

const EMPTY_SPECIALIST_MAP = new Map() as ReadonlyMap<string, SpecialistModelRow>;

// ── Test ───────────────────────────────────────────────────────────────────────

// Node.js test() signature: test(name, options?, fn)  — options before fn.
test(
  "isPointInTimeReplay=true suppresses specialist; false/undefined applies it identically (walk-forward path byte-for-byte unchanged)",
  { timeout: 180_000 }, // allow up to 3 min for Elo index build + pre-cutoff match load
  async (t) => {
    // ── Step 1: pick a real ATP-Hard match where both players have ≥10 prior matches ──
    const { rows } = await db.execute(sql`
      SELECT hm.*
      FROM historical_matches hm
      WHERE hm.surface = 'Hard'
        AND hm.tour    = 'ATP'
        AND hm.match_format IS NOT NULL
        AND hm.cancelled = false
        AND hm.scheduled_start_at > '2022-01-01'::timestamptz
        AND hm.scheduled_start_at < '2024-01-01'::timestamptz
        AND (
          SELECT count(*) FROM historical_matches p
          WHERE (p.player1_id = hm.player1_id OR p.player2_id = hm.player1_id)
            AND p.scheduled_start_at < hm.scheduled_start_at
            AND p.cancelled = false
        ) >= 10
        AND (
          SELECT count(*) FROM historical_matches p
          WHERE (p.player1_id = hm.player2_id OR p.player2_id = hm.player2_id)
            AND p.scheduled_start_at < hm.scheduled_start_at
            AND p.cancelled = false
        ) >= 10
      ORDER BY hm.id ASC
      LIMIT 1
    `);

    if (rows.length === 0) {
      t.skip("No suitable ATP-Hard match (both players ≥10 prior matches) found — DB too sparse");
      return;
    }

    const targetMatch = rows[0] as unknown as HistoricalMatchRow;
    t.diagnostic(
      `Target match: ${targetMatch.player1Name} vs ${targetMatch.player2Name} ` +
      `(${(targetMatch.scheduledStartAt as Date).toISOString?.() ?? "??"})`,
    );

    // ── Step 2: build scoring context from all matches before the cutoff ──────────
    //
    // buildEloHistoryIndex reads from the full historical_matches table internally.
    // buildMatchHistoryIndex takes the preloaded array so we can scope it to pre-cutoff matches.
    t.diagnostic("Building identity index and Elo history (reads full DB — may take a few seconds)…");
    const identityIndex = await buildPlayerIdentityIndex();
    const eloHistory    = await buildEloHistoryIndex(identityIndex);
    t.diagnostic("Elo history ready.");

    const allBeforeCutoff = await db
      .select()
      .from(historicalMatchesTable)
      .where(lt(historicalMatchesTable.scheduledStartAt, targetMatch.scheduledStartAt as Date))
      .orderBy(asc(historicalMatchesTable.scheduledStartAt));

    const matchHistory = buildMatchHistoryIndex(allBeforeCutoff);

    const baseCtx: HistoricalScoringContext = {
      matchHistory,
      eloHistory,
      identityIndex,
      specialistRowsBySegmentKey: EMPTY_SPECIALIST_MAP,
    };

    // ── Step 3: baseline — no specialist, isPointInTimeReplay = undefined ─────────
    const baseline = scoreHistoricalMatch(targetMatch, { ...baseCtx, isPointInTimeReplay: undefined });
    if (!baseline) {
      t.skip(
        "scoreHistoricalMatch returned null for the target match " +
        "(insufficient pre-cutoff history for one or both players) — pick a later match",
      );
      return;
    }
    t.diagnostic(`Baseline: raw=${baseline.rawProbability} calibrated=${baseline.calibratedProbability}`);

    // ── Step 4: shadow-replay path (isPointInTimeReplay = true) ──────────────────
    const replay = scoreHistoricalMatch(
      targetMatch,
      { ...baseCtx, specialistRowsBySegmentKey: SPECIALIST_MAP, isPointInTimeReplay: true },
    );
    assert.ok(replay !== null, "isPointInTimeReplay=true path must return non-null for a match that baseline handled");

    // ── Step 5: walk-forward path, explicit false ─────────────────────────────────
    const wfFalse = scoreHistoricalMatch(
      targetMatch,
      { ...baseCtx, specialistRowsBySegmentKey: SPECIALIST_MAP, isPointInTimeReplay: false },
    );
    assert.ok(wfFalse !== null, "isPointInTimeReplay=false path must return non-null");

    // ── Step 6: walk-forward path, undefined (the actual default) ─────────────────
    const wfUndefined = scoreHistoricalMatch(
      targetMatch,
      { ...baseCtx, specialistRowsBySegmentKey: SPECIALIST_MAP, isPointInTimeReplay: undefined },
    );
    assert.ok(wfUndefined !== null, "isPointInTimeReplay=undefined path must return non-null");

    // ── Assertion A: rawProbability is identical across all paths ─────────────────
    // The specialist only affects CALIBRATION — the raw ensemble output must be the same.
    assert.strictEqual(
      replay!.rawProbability,
      baseline.rawProbability,
      "rawProbability must be identical between replay and no-specialist baseline",
    );
    assert.strictEqual(
      wfFalse!.rawProbability,
      baseline.rawProbability,
      "rawProbability must be identical between walk-forward (false) and baseline",
    );
    assert.strictEqual(
      wfUndefined!.rawProbability,
      baseline.rawProbability,
      "rawProbability must be identical between walk-forward (undefined) and baseline",
    );

    // ── Assertion B: shadow-replay suppresses specialist (calibration = baseline) ──
    assert.strictEqual(
      replay!.calibratedProbability,
      baseline.calibratedProbability,
      "isPointInTimeReplay=true must suppress specialist: calibratedProbability must equal the no-specialist baseline",
    );

    // ── Assertion C: undefined and false are byte-for-byte identical ──────────────
    // This is the "walk-forward path is unchanged by the default" guarantee.
    assert.strictEqual(
      wfUndefined!.calibratedProbability,
      wfFalse!.calibratedProbability,
      "isPointInTimeReplay=undefined must produce the same calibratedProbability as isPointInTimeReplay=false",
    );

    // ── Assertion D: specialist DID shift calibration in the walk-forward path ────
    // When raw probability is in the sensitive [30, 70] range, the biased knot
    // (raw 0.5 → calibrated 0.75) must produce a measurable shift.
    // This confirms the specialist was actually applied — not silently swallowed.
    const raw = baseline.rawProbability;
    t.diagnostic(`walk-forward calibrated=${wfFalse!.calibratedProbability} (raw=${raw})`);
    if (raw >= 30 && raw <= 70) {
      assert.notStrictEqual(
        wfFalse!.calibratedProbability,
        baseline.calibratedProbability,
        `Specialist must shift calibratedProbability when raw=${raw} is in [30, 70] ` +
        `(got wf=${wfFalse!.calibratedProbability}, baseline=${baseline.calibratedProbability})`,
      );
    } else {
      t.diagnostic(`raw=${raw} is outside [30, 70] — specialist shift may not be visible at extremes; B and C still hold`);
    }
  },
); // timeout set via test.setDefaultTimeout or via the options arg below
