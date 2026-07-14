// Regression test mirroring `runPaperTradingJob.smoke.test.ts`: confirms the standalone-invocation
// env-var guard actually fires when the job is run the way it's documented to run (via the
// `job:historical-backfill` npm script -> `node --enable-source-maps ./dist/jobs/runHistoricalBackfillJob.mjs`),
// and that a durable `job_runs` row lands. Spawns the REAL built script as a subprocess (not an
// in-process import) so a false-negative "guard silently skipped" bug can't hide.
//
// Requires `pnpm --filter @workspace/api-server run build` to have produced
// dist/jobs/runHistoricalBackfillJob.mjs first (same precondition as running the job for real).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { db, jobRunsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { HISTORICAL_BACKFILL_JOB_NAME } from "./historicalBackfillJobName";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const builtJobPath = "./dist/jobs/runHistoricalBackfillJob.mjs";

test("job:historical-backfill script actually runs the job and writes a durable job_runs row", { skip: !existsSync(path.join(artifactDir, builtJobPath)) && "dist/jobs/runHistoricalBackfillJob.mjs not built -- run `pnpm run build` first" }, async () => {
  const before = new Date();

  const result = spawnSync("node", ["--enable-source-maps", builtJobPath], {
    cwd: artifactDir,
    encoding: "utf8",
    env: { ...process.env, HISTORICAL_BACKFILL_JOB_STANDALONE: "1" },
  });

  assert.equal(result.status, 0, `job process should exit 0 on success (skipped-nothing-new is still success); stderr: ${result.stderr}`);

  const [latest] = await db
    .select()
    .from(jobRunsTable)
    .where(eq(jobRunsTable.jobName, HISTORICAL_BACKFILL_JOB_NAME))
    .orderBy(desc(jobRunsTable.startedAt))
    .limit(1);

  assert.ok(latest, "the job must write a job_runs row when actually invoked");
  assert.ok(latest.startedAt.getTime() >= before.getTime(), "the job_runs row must be from this invocation, not a stale one");
  assert.equal(latest.status, "success");
});
