// Regression test for the exact bug caught by code review: `runPaperTradingJob.ts`'s
// isMainModule guard must actually fire when invoked the way it is documented to run (via the
// `job:paper-trading` npm script -> `node --enable-source-maps ./dist/jobs/runPaperTradingJob.mjs`
// with a relative path in argv[1]). A naive `import.meta.url === file://${process.argv[1]}`
// string comparison silently no-ops in exactly that case -- the process exits 0 having done
// nothing and written nothing, which looks identical to success from the outside. This test
// spawns the REAL built script as a subprocess (not an in-process import) so it can't be fooled
// by the guard being skipped, and asserts a durable job_runs row actually landed.
//
// Requires `pnpm --filter @workspace/api-server run build` to have produced
// dist/jobs/runPaperTradingJob.mjs first (same precondition as running the job for real).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { db, jobRunsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { PAPER_TRADING_JOB_NAME } from "./paperTradingJobName";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const builtJobPath = "./dist/jobs/runPaperTradingJob.mjs";

test("job:paper-trading script actually runs the job and writes a durable job_runs row", { skip: !existsSync(path.join(artifactDir, builtJobPath)) && "dist/jobs/runPaperTradingJob.mjs not built -- run `pnpm run build` first" }, async () => {
  const before = new Date();

  const result = spawnSync("node", ["--enable-source-maps", builtJobPath], {
    cwd: artifactDir,
    encoding: "utf8",
    env: { ...process.env, PAPER_TRADING_JOB_STANDALONE: "1" },
  });

  assert.equal(result.status, 0, `job process should exit 0 on success; stderr: ${result.stderr}`);

  const [latest] = await db
    .select()
    .from(jobRunsTable)
    .where(eq(jobRunsTable.jobName, PAPER_TRADING_JOB_NAME))
    .orderBy(desc(jobRunsTable.startedAt))
    .limit(1);

  assert.ok(latest, "the job must write a job_runs row when actually invoked");
  assert.ok(latest.startedAt.getTime() >= before.getTime(), "the job_runs row must be from this invocation, not a stale one");
  assert.equal(latest.status, "success");
});
