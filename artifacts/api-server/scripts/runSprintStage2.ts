#!/usr/bin/env node
/**
 * Sprint Stage 2 runner: inserts all candidate_configs rows for the three tracks.
 * Run with: pnpm exec tsx scripts/runSprintStage2.ts
 */
import { buildSprintStage2Candidates } from "../src/services/evaluation/sprintStage2Candidates.js";

const result = await buildSprintStage2Candidates();
console.log("Sprint Stage 2 complete:");
console.log(JSON.stringify(result, null, 2));
process.exit(0);
