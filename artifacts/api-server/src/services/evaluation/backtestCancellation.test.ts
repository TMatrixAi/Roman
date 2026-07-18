/**
 * Cooperative cancellation tests for runEvaluationBacktest.
 *
 * These tests call the REAL runEvaluationBacktest function with injected
 * BacktestTestHooks so that:
 *   - matchesForTest bypasses DB historical-match queries (deterministic corpus)
 *   - getCancellationStatus controls exactly when the cancellation fires
 *   - onPredictionInserted counts how many matches were scored before stopping
 *   - onRunUpdated captures what terminal status was written (bypasses real DB writes)
 *
 * The real scoring loop, cancellation throw/catch logic, and final-write guard
 * are all exercised by these tests.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runEvaluationBacktest, type BacktestMatchLike, type BacktestTestHooks } from "./backtestService";

// ─── Fake match factory ───────────────────────────────────────────────────────

function fakeMatch(i: number): BacktestMatchLike {
  return {
    id: i,
    player1Id: `p${i}a`,
    player1Name: `Player ${i}A`,
    player2Id: `p${i}b`,
    player2Name: `Player ${i}B`,
    winnerId: i % 2 === 0 ? `p${i}a` : `p${i}b`,
    cancelled: false,
    walkover: false,
    retired: false,
    surface: "Hard",
    matchFormat: "best_of_3",
    tournamentLevel: "ATP 250",
    tournamentName: "Test Tournament",
    scheduledStartAt: new Date(`2024-06-${String((i % 28) + 1).padStart(2, "0")}T12:00:00Z`),
  };
}

function makeMatches(n: number): BacktestMatchLike[] {
  return Array.from({ length: n }, (_, i) => fakeMatch(i + 1));
}

/** Build hooks that fire cancellation after `cancelAfterInserts` insertions. */
function makeCancellationHooks(cancelAfterInserts: number): {
  hooks: BacktestTestHooks;
  insertedCount: () => number;
  finalStatusWrites: () => string[];
} {
  let inserted = 0;
  const statusWrites: string[] = [];

  const hooks: BacktestTestHooks = {
    matchesForTest: makeMatches(50),
    getCancellationStatus: async (_runId: number) => {
      // Return 'cancelled' once we've passed the cancellation threshold
      return inserted >= cancelAfterInserts ? "cancelled" : "running";
    },
    onPredictionInserted: (count: number) => {
      inserted = count;
    },
    onRunUpdated: async (data: Record<string, unknown>) => {
      if (typeof data.status === "string") {
        statusWrites.push(data.status);
      }
    },
  };

  return {
    hooks,
    insertedCount: () => inserted,
    finalStatusWrites: () => statusWrites,
  };
}

const STUB_OPTIONS = {
  runId: 999_999_999, // sentinel value — no real DB row
  dateRange: { start: "2024-01-01", end: "2024-12-31" },
  filters: {},
  mode: "evaluation" as const,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runEvaluationBacktest — cooperative cancellation", () => {
  it("stops scoring within one progress interval after cancellation fires at match 25", async () => {
    const CANCEL_AFTER = 25;
    const PROGRESS_INTERVAL = 10; // must match the const in backtestService.ts

    const { hooks, insertedCount, finalStatusWrites } = makeCancellationHooks(CANCEL_AFTER);

    await runEvaluationBacktest(STUB_OPTIONS, hooks);

    // Should have stopped at the next checkpoint after insert 25 (i.e. ≤ 30)
    assert.ok(
      insertedCount() <= CANCEL_AFTER + PROGRESS_INTERVAL,
      `Expected ≤${CANCEL_AFTER + PROGRESS_INTERVAL} inserts but got ${insertedCount()}`,
    );
    assert.ok(
      insertedCount() < 50,
      `Expected early stop but all 50 matches were processed (insertedCount=${insertedCount()})`,
    );

    // The final write guard must have prevented a 'completed' write
    assert.ok(
      !finalStatusWrites().includes("completed"),
      `Status 'completed' was written after cancellation: ${JSON.stringify(finalStatusWrites())}`,
    );
    assert.ok(
      !finalStatusWrites().includes("completed-with-warnings"),
      `Status 'completed-with-warnings' was written after cancellation: ${JSON.stringify(finalStatusWrites())}`,
    );
  });

  it("completes normally and writes 'completed' when not cancelled", async () => {
    const { hooks, insertedCount, finalStatusWrites } = makeCancellationHooks(9999); // never fires

    await runEvaluationBacktest(STUB_OPTIONS, hooks);

    // All 50 loop iterations ran (even if scoring returned null — the hook fires after each attempt)
    assert.equal(insertedCount(), 50, `Expected 50 loop iterations, got ${insertedCount()}`);

    // Final status is 'completed' (no errors, so no warnings)
    assert.ok(
      finalStatusWrites().includes("completed") || finalStatusWrites().includes("completed-with-warnings"),
      `Expected a completed status write, got: ${JSON.stringify(finalStatusWrites())}`,
    );
    assert.ok(
      !finalStatusWrites().includes("failed"),
      `Unexpected 'failed' status: ${JSON.stringify(finalStatusWrites())}`,
    );
  });

  it("stops immediately (within one interval) when cancelled before the loop starts", async () => {
    // cancelAfterInserts=0 → getCancellationStatus returns 'cancelled' from the very first check
    const { hooks, insertedCount, finalStatusWrites } = makeCancellationHooks(0);

    await runEvaluationBacktest(STUB_OPTIONS, hooks);

    // The pre-loop assertNotCancelled fires before any inserts, so insertedCount is 0
    assert.equal(insertedCount(), 0, `Expected 0 inserts when cancelled before loop, got ${insertedCount()}`);
    assert.ok(
      !finalStatusWrites().includes("completed"),
      `'completed' was written even though cancelled before loop`,
    );
  });

  it("final-write guard prevents completed when cancelled during metrics phase", async () => {
    // Cancellation fires after all 50 inserts but before the final status write.
    // Simulate this by returning 'cancelled' only on the final guard call (after all inserts).
    let insertedCountInternal = 0;
    let statusWrites: string[] = [];

    const hooks: BacktestTestHooks = {
      matchesForTest: makeMatches(50),
      getCancellationStatus: async (_runId: number) => {
        // Return 'running' during the loop (all 50 finish), 'cancelled' on the final guard
        return insertedCountInternal >= 50 ? "cancelled" : "running";
      },
      onPredictionInserted: (count: number) => {
        insertedCountInternal = count;
      },
      onRunUpdated: async (data: Record<string, unknown>) => {
        if (typeof data.status === "string") statusWrites.push(data.status);
      },
    };

    await runEvaluationBacktest(STUB_OPTIONS, hooks);

    // All 50 were processed (cancellation arrived during metrics, not the loop)
    assert.equal(insertedCountInternal, 50);

    // The final guard must have blocked the 'completed' write
    assert.ok(
      !statusWrites.includes("completed"),
      `'completed' was written despite cancellation during metrics phase: ${JSON.stringify(statusWrites)}`,
    );
  });
});
