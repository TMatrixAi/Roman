import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(THIS_DIR, "..", "..");

async function read(relativePath: string): Promise<string> {
  return readFile(join(SRC_ROOT, relativePath), "utf8");
}

/**
 * CI guardrail for Phase 10-14: live search and paper trading must route through the same
 * snapshot scorer so they cannot drift due to duplicate feature-assembly code paths.
 */
test("live-search and paper-trading paths use predictFromSnapshot", async () => {
  const [predictionsRoute, paperTradingService] = await Promise.all([
    read("routes/predictions.ts"),
    read("services/evaluation/paperTrading.ts"),
  ]);

  assert.match(predictionsRoute, /predictFromSnapshot\(/, "predictions route must use predictFromSnapshot");
  assert.match(paperTradingService, /predictFromSnapshot\(/, "paper trading must use predictFromSnapshot");

  // Ensure neither path reintroduces a direct engine call bypassing the shared snapshot layer.
  assert.doesNotMatch(predictionsRoute, /runPredictionEngine\(/, "predictions route should not call runPredictionEngine directly");
  assert.doesNotMatch(paperTradingService, /runPredictionEngine\(/, "paper trading should not call runPredictionEngine directly");
});
