// Regression test mirroring `runPaperTradingJob.smoke.test.ts`: spawns the REAL built script as a
// subprocess (not an in-process import) so the `isMainModule` guard is exercised exactly the way
// the `job:calibration-refit` npm script invokes it, and asserts a durable job_runs row lands.
//
// Requires `pnpm --filter @workspace/api-server run build` to have produced
// dist/jobs/runCalibrationRefitJob.mjs first (same precondition as running the job for real).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { db, jobRunsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { CALIBRATION_REFIT_JOB_NAME } from "./calibrationRefitJobName";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const builtJobPath = "./dist/jobs/runCalibrationRefitJob.mjs";

test("job:calibration-refit script actually runs the job and writes a durable job_runs row", { skip: !existsSync(path.join(artifactDir, builtJobPath)) && "dist/jobs/runCalibrationRefitJob.mjs not built -- run `pnpm run build` first" }, async () => {
  const before = new Date();

  const result = spawnSync("node", ["--enable-source-maps", builtJobPath], {
    cwd: artifactDir,
    encoding: "utf8",
    env: { ...process.env, CALIBRATION_REFIT_JOB_STANDALONE: "1" },
  });

  assert.equal(result.status, 0, `job process should exit 0 on success; stderr: ${result.stderr}`);

  const [latest] = await db
    .select()
    .from(jobRunsTable)
    .where(eq(jobRunsTable.jobName, CALIBRATION_REFIT_JOB_NAME))
    .orderBy(desc(jobRunsTable.startedAt))
    .limit(1);

  assert.ok(latest, "the job must write a job_runs row when actually invoked");
  assert.ok(latest.startedAt.getTime() >= before.getTime(), "the job_runs row must be from this invocation, not a stale one");
  assert.equal(latest.status, "success");
});
