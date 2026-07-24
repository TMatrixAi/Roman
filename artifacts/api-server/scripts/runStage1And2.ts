#!/usr/bin/env node
/**
 * Replit-safe sequential runner for Stage 1 execution + Stage 2 candidate generation.
 *
 * This script runs:
 *  1) scripts/runCompleteWalkForward.ts
 *  2) scripts/buildStage2Candidates.ts
 *
 * It exits non-zero if either step fails.
 *
 * Usage:
 *   npx tsx scripts/runStage1And2.ts
 */

import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";

function parseDbHost(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
}

async function runPreflight(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Set it before running this pipeline (Replit sets this automatically).",
    );
  }

  const host = parseDbHost(databaseUrl);
  try {
    await lookup(host);
  } catch (err) {
    const e = err as { code?: string };
    if (e?.code === "ENOTFOUND") {
      if (host === "helium") {
        throw new Error(
          "Database host 'helium' is not resolvable in this environment. Run this script in Replit shell where helium is reachable.",
        );
      }
      throw new Error(`Database host '${host}' is not resolvable (ENOTFOUND).`);
    }
    throw err;
  }

  console.log(`Preflight OK: DATABASE_URL host '${host}' is resolvable.`);
}

function runStep(label: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${label} ===`);
    console.log(`$ npx ${args.join(" ")}`);

    const child = spawn("npx", args, {
      stdio: "inherit",
      shell: false,
      env: process.env,
    });

    child.on("error", (err) => {
      reject(new Error(`${label} failed to start: ${err.message}`));
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${label} terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${label} exited with code ${code ?? "unknown"}`));
        return;
      }
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const start = Date.now();

  try {
    await runPreflight();
    await runStep("Stage 1 execution: walk-forward + post-fit", ["tsx", "scripts/runCompleteWalkForward.ts"]);
    await runStep("Stage 2 execution: build candidate configs", ["tsx", "scripts/buildStage2Candidates.ts"]);

    const elapsedSec = Math.round((Date.now() - start) / 1000);
    console.log(`\nAll stages completed successfully in ${elapsedSec}s.`);
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nPipeline failed: ${message}`);
    process.exit(1);
  }
}

void main();
